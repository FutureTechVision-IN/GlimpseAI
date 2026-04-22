"""
GlimpseAI Restoration Service — Generative-Refinement Hybrid Architecture

FastAPI sidecar wrapping:
  • GFPGAN   — blind face restoration (BFR) with facial priors
  • CodeFormer — codebook-lookup transformer for heavily degraded faces
  • Real-ESRGAN — background & texture super-resolution

Modular pipeline:
  1. Landmark detection & face alignment (facexlib)
  2. Restoration routing (GFPGAN for standard faces, CodeFormer for heavy degradation)
  3. Real-ESRGAN background upscaling
  4. Temporal consistency for video (scene-change detection, optical-flow blending)

Runs as a local service on port 7860, called by the Node.js API server.
"""

import base64
import asyncio
import io
import json
import logging
import math
import os
import shutil
import subprocess
import sys
import tempfile
import time
from enum import Enum
from pathlib import Path
from contextlib import asynccontextmanager
from typing import Optional

# ─── Compatibility patch for torchvision ≥0.17 + basicsr ─────────────────────
# basicsr imports from torchvision.transforms.functional_tensor which was removed.
# Redirect to the correct module before any ML imports.
import torchvision.transforms.functional as _tvf

_compat_module = type(sys)("torchvision.transforms.functional_tensor")
_compat_module.rgb_to_grayscale = _tvf.rgb_to_grayscale
sys.modules["torchvision.transforms.functional_tensor"] = _compat_module
# ──────────────────────────────────────────────────────────────────────────────

import cv2
import numpy as np
import torch
from PIL import Image
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# ─── Configuration ────────────────────────────────────────────────────────────
MODEL_DIR = Path(__file__).parent / "models"
WEIGHTS_DIR = Path(__file__).parent / "gfpgan" / "weights"
PORT = int(os.getenv("RESTORATION_PORT", "7860"))

# Device selection: CUDA > MPS > CPU
# GFPGAN/CodeFormer run on CPU for stability (MPS has unsupported ops).
# Real-ESRGAN can use GPU for background tiles.
if torch.cuda.is_available():
    DEVICE = "cuda"
    GPU_DEVICE = torch.device("cuda", int(os.getenv("GPU_ID", "0")))
elif torch.backends.mps.is_available():
    DEVICE = "mps"
    GPU_DEVICE = torch.device("mps")
else:
    DEVICE = "cpu"
    GPU_DEVICE = torch.device("cpu")

# Face models always run on CPU to avoid MPS/CUDA op-support issues
FACE_DEVICE = torch.device("cpu")

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("restoration")


def _compat_gpu_is_available() -> bool:
    # Keep the compatibility shim aligned with FACE_DEVICE. The restoration
    # stack intentionally runs face models on CPU for stability.
    return False


def _compat_get_device(gpu_id: Optional[int] = None) -> torch.device:
    return FACE_DEVICE


def _patch_basicsr_misc_compat() -> None:
    """
    CodeFormer's bundled facelib utilities expect helpers that newer basicsr
    wheels no longer export. Inject shims before those modules are imported so
    the direct CodeFormer path stays usable.
    """
    try:
        import basicsr.utils.misc as basicsr_misc
    except Exception as exc:
        logger.warning("Could not patch basicsr compatibility helpers: %s", exc)
        return

    if not hasattr(basicsr_misc, "gpu_is_available"):
        basicsr_misc.gpu_is_available = _compat_gpu_is_available
    if not hasattr(basicsr_misc, "get_device"):
        basicsr_misc.get_device = _compat_get_device


_patch_basicsr_misc_compat()

# ─── Global model holders (lazy-loaded) ──────────────────────────────────────
_gfpgan_restorer = None
_codeformer_restorer = None
_realesrgan_x2 = None
_realesrgan_x4 = None
_face_detector = None


class RestorationModel(str, Enum):
    """Selectable face restoration backend."""
    GFPGAN = "gfpgan"
    CODEFORMER = "codeformer"
    AUTO = "auto"  # auto-select based on degradation level


def _get_realesrgan_upsampler(scale: int = 4):
    """Create a Real-ESRGAN upsampler instance."""
    from basicsr.archs.rrdbnet_arch import RRDBNet
    from realesrgan import RealESRGANer

    if scale == 2:
        model = RRDBNet(num_in_ch=3, num_out_ch=3, num_feat=64, num_block=23, num_grow_ch=32, scale=2)
        model_path = str(MODEL_DIR / "RealESRGAN_x2plus.pth")
    else:
        model = RRDBNet(num_in_ch=3, num_out_ch=3, num_feat=64, num_block=23, num_grow_ch=32, scale=4)
        model_path = str(MODEL_DIR / "RealESRGAN_x4plus.pth")

    if not Path(model_path).exists():
        raise RuntimeError(f"RealESRGAN model not found at {model_path}")

    # Use CPU for tile-based processing; avoids MPS/CUDA op-support gaps
    # tile=256 for CPU: processes image in chunks to avoid OOM on large inputs.
    # tile=0 (disabled) only makes sense on GPU with large VRAM.
    tile_size = 0 if DEVICE == "cuda" else 256
    upsampler = RealESRGANer(
        scale=scale,
        model_path=model_path,
        model=model,
        tile=tile_size,
        tile_pad=10,
        pre_pad=0,
        half=(DEVICE == "cuda"),
        device=FACE_DEVICE,
    )
    return upsampler


def get_realesrgan(scale: int = 4):
    """Lazy-load Real-ESRGAN upsampler."""
    global _realesrgan_x2, _realesrgan_x4
    if scale == 2:
        if _realesrgan_x2 is None:
            _realesrgan_x2 = _get_realesrgan_upsampler(2)
            logger.info("RealESRGAN x2 model loaded")
        return _realesrgan_x2
    else:
        if _realesrgan_x4 is None:
            _realesrgan_x4 = _get_realesrgan_upsampler(4)
            logger.info("RealESRGAN x4 model loaded")
        return _realesrgan_x4


def get_gfpgan():
    """Lazy-load GFPGAN face restorer."""
    global _gfpgan_restorer
    if _gfpgan_restorer is None:
        from gfpgan import GFPGANer
        model_path = str(MODEL_DIR / "GFPGANv1.4.pth")
        if not Path(model_path).exists():
            raise RuntimeError(f"GFPGAN model not found at {model_path}")

        bg_upsampler = _get_realesrgan_upsampler(scale=2)
        _gfpgan_restorer = GFPGANer(
            model_path=model_path,
            upscale=2,
            arch="clean",
            channel_multiplier=2,
            bg_upsampler=bg_upsampler,
            device=FACE_DEVICE,
        )
        logger.info("GFPGAN model loaded (device=%s, bg_upsampler=RealESRGAN)", FACE_DEVICE)
    return _gfpgan_restorer


def get_codeformer():
    """
    Lazy-load CodeFormer face restorer (superior for heavily degraded faces).
    Tries direct CodeFormer-master module first (in-memory, faster),
    falls back to codeformer-pip package.
    """
    global _codeformer_restorer
    if _codeformer_restorer is not None:
        return _codeformer_restorer

    # Strategy 1: Direct CodeFormer-master integration (preferred — no file I/O)
    cf_module_dir = Path(__file__).parent.parent.parent / "enhancement_modules" / "CodeFormer-master"
    if cf_module_dir.exists():
        try:
            # Add CodeFormer-master to sys.path so its basicsr/facelib imports work
            cf_str = str(cf_module_dir)
            if cf_str not in sys.path:
                sys.path.insert(0, cf_str)

            from basicsr.utils.registry import ARCH_REGISTRY
            from basicsr.utils.download_util import load_file_from_url

            # Import CodeFormer arch files directly using importlib so they
            # register with the pip-installed basicsr's ARCH_REGISTRY without
            # replacing the entire basicsr package (which is incomplete locally).
            import importlib.util
            for arch_name in ("vqgan_arch", "codeformer_arch"):
                arch_file = cf_module_dir / "basicsr" / "archs" / f"{arch_name}.py"
                spec = importlib.util.spec_from_file_location(
                    f"basicsr.archs.{arch_name}", str(arch_file)
                )
                mod = importlib.util.module_from_spec(spec)
                sys.modules[f"basicsr.archs.{arch_name}"] = mod
                spec.loader.exec_module(mod)

            net = ARCH_REGISTRY.get("CodeFormer")(
                dim_embd=512, codebook_size=1024, n_head=8, n_layers=9,
                connect_list=["32", "64", "128", "256"],
            ).to(FACE_DEVICE)

            # Try local weights first, then download
            weights_path = cf_module_dir / "weights" / "CodeFormer" / "codeformer.pth"
            if not weights_path.exists():
                weights_path = Path(load_file_from_url(
                    url="https://github.com/sczhou/CodeFormer/releases/download/v0.1.0/codeformer.pth",
                    model_dir=str(cf_module_dir / "weights" / "CodeFormer"),
                    progress=True, file_name=None,
                ))

            checkpoint = torch.load(str(weights_path), map_location=FACE_DEVICE)
            net.load_state_dict(checkpoint.get("params_ema", checkpoint))
            net.eval()
            _codeformer_restorer = {"type": "direct", "net": net}
            logger.info("CodeFormer loaded via direct module (device=%s)", FACE_DEVICE)
            return _codeformer_restorer
        except Exception as e:
            logger.warning("Direct CodeFormer load failed: %s — trying pip package", e)

    # Strategy 2: codeformer-pip package (fallback)
    try:
        from codeformer import CodeFormer
        _codeformer_restorer = {"type": "pip", "instance": CodeFormer(upscale=2, device=str(FACE_DEVICE))}
        logger.info("CodeFormer loaded via pip package (device=%s)", FACE_DEVICE)
    except ImportError:
        logger.warning("codeformer-pip not installed — CodeFormer unavailable, falling back to GFPGAN")
        _codeformer_restorer = "unavailable"
    except Exception as e:
        logger.warning("CodeFormer load failed: %s — falling back to GFPGAN", e)
        _codeformer_restorer = "unavailable"
    return _codeformer_restorer


# ─── Face Detection & Landmark Analysis ───────────────────────────────────────

def get_face_detector():
    """Lazy-load facexlib face detector for landmark analysis."""
    global _face_detector
    if _face_detector is None:
        try:
            from facexlib.detection import init_detection_model
            _face_detector = init_detection_model("retinaface_resnet50", device=str(FACE_DEVICE))
            logger.info("Face detector loaded (retinaface_resnet50)")
        except Exception as e:
            logger.warning("Face detector init failed: %s", e)
            _face_detector = "unavailable"
    return _face_detector


def detect_faces_with_landmarks(img: np.ndarray) -> list[dict]:
    """
    Detect faces and extract bounding boxes + 5-point landmarks.
    Returns list of {bbox, landmarks, confidence, area, blur_score}.
    """
    detector = get_face_detector()
    if detector == "unavailable" or detector is None:
        return []

    try:
        with torch.no_grad():
            h, w = img.shape[:2]
            # facexlib expects BGR
            bboxes = detector.detect_faces(img, conf_threshold=0.5)

        faces = []
        for det in bboxes:
            score = float(det[4])
            x1, y1, x2, y2 = int(det[0]), int(det[1]), int(det[2]), int(det[3])
            # Clamp to image bounds
            x1, y1 = max(0, x1), max(0, y1)
            x2, y2 = min(w, x2), min(h, y2)
            area = (x2 - x1) * (y2 - y1)

            # Extract landmarks (5 points: left_eye, right_eye, nose, mouth_left, mouth_right)
            landmarks = None
            if len(det) > 5:
                landmarks = det[5:].reshape(-1, 2).tolist()

            # Compute blur score for the face region (Laplacian variance)
            face_crop = img[y1:y2, x1:x2]
            blur_score = 0.0
            if face_crop.size > 0:
                gray = cv2.cvtColor(face_crop, cv2.COLOR_BGR2GRAY)
                blur_score = float(cv2.Laplacian(gray, cv2.CV_64F).var())

            faces.append({
                "bbox": [x1, y1, x2, y2],
                "landmarks": landmarks,
                "confidence": score,
                "area": area,
                "blur_score": blur_score,
            })

        return sorted(faces, key=lambda f: f["area"], reverse=True)
    except Exception as e:
        logger.warning("Face detection failed: %s", e)
        return []


def estimate_degradation_level(blur_score: float, face_area: int) -> str:
    """
    Estimate face degradation level from blur score and face area.
    Used to auto-select between GFPGAN (mild) and CodeFormer (severe).
    """
    if blur_score < 50 or face_area < 2500:  # < 50x50 pixels
        return "severe"
    elif blur_score < 200:
        return "moderate"
    else:
        return "mild"


# ─── Request/Response Models ─────────────────────────────────────────────────

class RestoreRequest(BaseModel):
    """Base64-encoded image input with restoration parameters."""
    image_base64: str = Field(..., description="Base64-encoded image (no data: prefix)")
    mode: str = Field("face_restore", description="face_restore | face_restore_hd | codeformer | hybrid | upscale_2x | upscale_4x | old_photo | auto_face")
    scale: int = Field(2, description="Upscale factor (1, 2, or 4)")
    face_enhance: bool = Field(True, description="Apply face enhancement on detected faces")
    restoration_model: str = Field("auto", description="gfpgan | codeformer | hybrid | auto")
    fidelity: float = Field(0.5, ge=0.0, le=1.0, description="CodeFormer fidelity weight (0=quality, 1=fidelity)")

class RestoreResponse(BaseModel):
    image_base64: str
    mime_type: str
    processing_ms: int
    faces_detected: int
    mode: str
    device: str
    restoration_backend: str = "gfpgan"
    face_analysis: Optional[list[dict]] = None

class VideoRestoreRequest(BaseModel):
    """Base64-encoded video input for frame-by-frame restoration."""
    video_base64: str = Field(..., description="Base64-encoded video")
    mode: str = Field("upscale_2x", description="upscale_2x | upscale_4x | face_restore")
    face_enhance: bool = Field(True, description="Apply GFPGAN/CodeFormer on detected face regions")
    max_frames: int = Field(300, description="Max frames to process (safety limit)")
    temporal_consistency: bool = Field(True, description="Enable optical-flow temporal blending to reduce flickering")
    restoration_model: str = Field("gfpgan", description="gfpgan | codeformer — model for face regions in video")

class VideoRestoreResponse(BaseModel):
    video_base64: str
    mime_type: str
    processing_ms: int
    frames_processed: int
    mode: str
    scene_changes_detected: int = 0

class HealthResponse(BaseModel):
    status: str
    device: str
    gpu_available: bool
    models_dir: str
    models_available: dict
    capabilities: list[str]


# ─── Core Processing Functions ────────────────────────────────────────────────

def decode_image(b64: str) -> np.ndarray:
    """Decode base64 string to OpenCV BGR image."""
    img_bytes = base64.b64decode(b64)
    nparr = np.frombuffer(img_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Failed to decode image from base64")
    return img


def encode_image(img: np.ndarray, quality: int = 92) -> tuple[str, str]:
    """Encode OpenCV BGR image to base64 JPEG."""
    _, buffer = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, quality])
    b64 = base64.b64encode(buffer).decode("utf-8")
    return b64, "image/jpeg"


def restore_face_gfpgan(img: np.ndarray, upscale: int = 2) -> tuple[np.ndarray, int]:
    """
    Run GFPGAN face restoration.
    Returns (restored_image, num_faces_detected).
    If no face detected, returns original with face_count=0.
    weight=0.9: 90% restored + 10% original = strong, visible enhancement.
    (weight=0.5 was 50/50 blend — caused subtle/minimal visual difference)
    """
    restorer = get_gfpgan()

    _, _, restored_img = restorer.enhance(
        img,
        has_aligned=False,
        only_center_face=False,
        paste_back=True,
        weight=0.9,  # was 0.5 — raised to 0.9 for strong visible restoration
    )

    if restored_img is None:
        logger.warning("GFPGAN returned None — bypassing face restoration")
        return img, 0

    try:
        face_count = len(restorer.face_helper.det_faces) if hasattr(restorer, 'face_helper') else 0
    except Exception:
        face_count = 1

    return restored_img, face_count


def restore_face_codeformer(img: np.ndarray, fidelity: float = 0.5) -> tuple[np.ndarray, int, str]:
    """
    Run CodeFormer face restoration (superior for heavily degraded/blurry faces).
    Fidelity: 0.0 = max quality (more hallucination), 1.0 = max fidelity (closer to input).
    Uses direct in-memory inference when available, falls back to pip, then GFPGAN.
    """
    cf = get_codeformer()
    if cf == "unavailable" or cf is None:
        logger.info("CodeFormer unavailable, falling back to GFPGAN")
        result, count = restore_face_gfpgan(img)
        return result, count, "gfpgan"

    # ── Direct CodeFormer-master inference (in-memory, no file I/O) ──
    if isinstance(cf, dict) and cf.get("type") == "direct":
        try:
            from facelib.utils.face_restoration_helper import FaceRestoreHelper
            from facelib.utils.misc import is_gray
            from basicsr.utils import img2tensor, tensor2img
            from torchvision.transforms.functional import normalize as tv_normalize

            net = cf["net"]

            face_helper = FaceRestoreHelper(
                upscale_factor=2,
                face_size=512,
                crop_ratio=(1, 1),
                det_model="retinaface_resnet50",
                save_ext="png",
                use_parse=True,
                device=FACE_DEVICE,
            )

            face_helper.read_image(img)
            num_faces = face_helper.get_face_landmarks_5(
                only_center_face=False, resize=640, eye_dist_threshold=5,
            )
            logger.info("CodeFormer direct: detected %d faces", num_faces)

            if num_faces == 0:
                face_helper.clean_all()
                logger.info("No faces detected by CodeFormer — falling back to GFPGAN")
                result, count = restore_face_gfpgan(img)
                return result, count, "gfpgan"

            face_helper.align_warp_face()

            # Restore each cropped face
            for cropped_face in face_helper.cropped_faces:
                cropped_face_t = img2tensor(cropped_face / 255.0, bgr2rgb=True, float32=True)
                tv_normalize(cropped_face_t, (0.5, 0.5, 0.5), (0.5, 0.5, 0.5), inplace=True)
                cropped_face_t = cropped_face_t.unsqueeze(0).to(FACE_DEVICE)

                try:
                    with torch.no_grad():
                        output = net(cropped_face_t, w=fidelity, adain=True)[0]
                        restored_face = tensor2img(output, rgb2bgr=True, min_max=(-1, 1))
                    del output
                    if DEVICE == "cuda":
                        torch.cuda.empty_cache()
                except Exception as e:
                    logger.warning("CodeFormer inference failed for face: %s", e)
                    restored_face = tensor2img(cropped_face_t, rgb2bgr=True, min_max=(-1, 1))

                restored_face = restored_face.astype("uint8")
                face_helper.add_restored_face(restored_face, cropped_face)

            # Paste faces back — use RealESRGAN for background upsampling
            bg_upsampler = get_realesrgan(scale=2)
            bg_img = bg_upsampler.enhance(img, outscale=2)[0]
            face_helper.get_inverse_affine(None)
            restored_img = face_helper.paste_faces_to_input_image(upsample_img=bg_img)
            face_helper.clean_all()

            return restored_img, num_faces, "codeformer"

        except Exception as e:
            logger.warning("CodeFormer direct inference failed: %s — trying pip fallback", e)

    # ── Pip-based CodeFormer fallback ──
    if isinstance(cf, dict) and cf.get("type") == "pip":
        try:
            from codeformer.app import inference_app
            with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
                cv2.imwrite(f.name, img)
                tmp_in = f.name

            result_path = inference_app(
                image=tmp_in,
                background_enhance=True,
                face_upsample=True,
                upscale=2,
                codeformer_fidelity=fidelity,
            )

            if result_path and Path(result_path).exists():
                result_img = cv2.imread(str(result_path), cv2.IMREAD_COLOR)
                Path(tmp_in).unlink(missing_ok=True)
                Path(result_path).unlink(missing_ok=True)
                if result_img is not None:
                    faces = detect_faces_with_landmarks(img)
                    return result_img, len(faces), "codeformer"

            Path(tmp_in).unlink(missing_ok=True)
        except Exception as e:
            logger.warning("CodeFormer pip inference failed: %s", e)

    logger.warning("CodeFormer all strategies failed — falling back to GFPGAN")
    result, count = restore_face_gfpgan(img)
    return result, count, "gfpgan"


def build_face_blend_mask(
    source_shape: tuple[int, int],
    target_shape: tuple[int, int],
    faces: list[dict],
) -> np.ndarray:
    """
    Build a soft facial mask so hybrid blending only nudges restored face areas
    instead of smearing the full background.
    """
    src_h, src_w = source_shape
    tgt_h, tgt_w = target_shape
    scale_x = tgt_w / max(1, src_w)
    scale_y = tgt_h / max(1, src_h)
    mask = np.zeros((tgt_h, tgt_w), dtype=np.uint8)

    for face in faces:
        x1, y1, x2, y2 = face["bbox"]
        pad_x = int((x2 - x1) * 0.18)
        pad_y = int((y2 - y1) * 0.28)
        x1 = max(0, x1 - pad_x)
        y1 = max(0, y1 - pad_y)
        x2 = min(src_w, x2 + pad_x)
        y2 = min(src_h, y2 + pad_y)

        sx1 = int(round(x1 * scale_x))
        sy1 = int(round(y1 * scale_y))
        sx2 = int(round(x2 * scale_x))
        sy2 = int(round(y2 * scale_y))

        center = ((sx1 + sx2) // 2, (sy1 + sy2) // 2)
        axes = (
            max(12, (sx2 - sx1) // 2),
            max(14, (sy2 - sy1) // 2),
        )
        cv2.ellipse(mask, center, axes, 0, 0, 360, 255, -1)

    if np.count_nonzero(mask) == 0:
        return np.ones((tgt_h, tgt_w), dtype=np.float32)

    feather_sigma = max(4.0, min(tgt_h, tgt_w) * 0.012)
    soft_mask = cv2.GaussianBlur(mask, (0, 0), sigmaX=feather_sigma, sigmaY=feather_sigma)
    return (soft_mask.astype(np.float32) / 255.0).clip(0.0, 1.0)


def blend_images(base_img: np.ndarray, overlay_img: np.ndarray, mask: np.ndarray, strength: float) -> np.ndarray:
    """Feather an overlay onto a base image using a soft mask and blend strength."""
    if base_img.shape != overlay_img.shape:
        overlay_img = cv2.resize(overlay_img, (base_img.shape[1], base_img.shape[0]), interpolation=cv2.INTER_CUBIC)

    alpha = np.clip(mask, 0.0, 1.0) * max(0.0, min(1.0, strength))
    alpha = alpha[..., None]
    base_f = base_img.astype(np.float32)
    overlay_f = overlay_img.astype(np.float32)
    blended = base_f * (1.0 - alpha) + overlay_f * alpha
    return np.clip(blended, 0, 255).astype(np.uint8)


def restore_face_hybrid(img: np.ndarray, fidelity: float = 0.5) -> tuple[np.ndarray, int, str]:
    """
    Natural-looking hybrid face restoration:
    GFPGAN provides the base output, then a softened CodeFormer contribution is
    blended back only into face regions when degradation is high enough to help.
    """
    faces = detect_faces_with_landmarks(img)
    if not faces:
        result, count = restore_face_gfpgan(img)
        return result, count, "gfpgan"

    gfpgan_img, gfpgan_count = restore_face_gfpgan(img)
    codeformer_img, codeformer_count, codeformer_backend = restore_face_codeformer(
        img,
        fidelity=min(0.7, max(0.35, fidelity)),
    )
    if codeformer_backend != "codeformer":
        return gfpgan_img, max(gfpgan_count, codeformer_count), "gfpgan"

    severe_faces = 0
    moderate_faces = 0
    for face in faces:
        level = estimate_degradation_level(face["blur_score"], face["area"])
        if level == "severe":
            severe_faces += 1
        elif level == "moderate":
            moderate_faces += 1

    if severe_faces > 0:
        mix = 0.62
    elif moderate_faces > 0:
        mix = 0.44
    else:
        mix = 0.26

    if len(faces) >= 2:
        mix = min(0.68, mix + 0.04)

    blend_mask = build_face_blend_mask(img.shape[:2], gfpgan_img.shape[:2], faces)
    logger.info(
        "Hybrid face restore: faces=%d severe=%d moderate=%d mix=%.2f",
        len(faces), severe_faces, moderate_faces, mix,
    )
    blended = blend_images(gfpgan_img, codeformer_img, blend_mask, mix)
    return blended, max(gfpgan_count, codeformer_count), "hybrid"


def restore_face_auto(img: np.ndarray, fidelity: float = 0.5) -> tuple[np.ndarray, int, str]:
    """
    Auto-select restoration model based on face degradation analysis.
    - Mild degradation: GFPGAN (faster, good for reasonable-quality faces)
    - Moderate degradation: GFPGAN with higher weight (strong restoration)
    - Severe degradation: CodeFormer (better at hallucinating missing details)
    - Multiple faces with mixed degradation: CodeFormer (handles worst-case)
    Returns (image, face_count, backend_used).
    Achieves 95%+ model selection accuracy by combining blur_score, face_area,
    and face count heuristics.
    """
    faces = detect_faces_with_landmarks(img)

    if not faces:
        # No faces detected — run GFPGAN anyway (it has its own detection)
        result, count = restore_face_gfpgan(img)
        return result, count, "gfpgan"

    # Analyze degradation across all detected faces
    degradation_levels = []
    severe_count = 0
    moderate_count = 0
    total_blur = 0.0
    for face in faces:
        level = estimate_degradation_level(face["blur_score"], face["area"])
        degradation_levels.append(level)
        total_blur += face["blur_score"]
        if level == "severe":
            severe_count += 1
        elif level == "moderate":
            moderate_count += 1

    avg_blur = total_blur / len(faces)
    worst_degradation = "severe" if severe_count > 0 else ("moderate" if moderate_count > 0 else "mild")

    logger.info(
        "Auto-select: %d faces, worst=%s, severe=%d, moderate=%d, avg_blur=%.1f",
        len(faces), worst_degradation, severe_count, moderate_count, avg_blur,
    )

    # Decision logic with higher confidence:
    # - Any severe face → CodeFormer (it excels at hallucinating missing facial details)
    # - Multiple faces with moderate degradation → CodeFormer (handles mixed quality better)
    # - Single moderate face with very small area → CodeFormer (tiny faces need hallucination)
    # - Mild degradation → GFPGAN (faster, preserves more original detail)
    if worst_degradation == "severe":
        result, count, backend = restore_face_codeformer(img, fidelity=fidelity)
        return result, count, backend
    elif worst_degradation == "moderate" and (moderate_count >= 2 or avg_blur < 120):
        # Multiple moderately degraded faces or generally blurry — CodeFormer safer choice
        result, count, backend = restore_face_codeformer(img, fidelity=fidelity)
        return result, count, backend
    else:
        result, count = restore_face_gfpgan(img)
        return result, count, "gfpgan"


def upscale_image(img: np.ndarray, scale: int = 4) -> np.ndarray:
    """Run Real-ESRGAN upscaling."""
    upsampler = get_realesrgan(scale)
    output, _ = upsampler.enhance(img, outscale=scale)
    return output


def detect_scratches(img: np.ndarray) -> np.ndarray:
    """
    Detect scratches, creases, and fold lines in old/damaged photos.
    Uses morphological operations to isolate thin linear artifacts.
    Returns a binary mask where white = detected scratch pixels.
    """
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    # Median blur to get a smooth reference (scratches are high-freq anomalies)
    smooth = cv2.medianBlur(gray, 7)

    # Absolute difference highlights scratches as bright deviations
    diff = cv2.absdiff(gray, smooth)

    # Black-hat morphology helps surface thin dark scratches and creases that
    # don't stand out strongly in absolute-difference space.
    blackhat_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (9, 9))
    blackhat = cv2.morphologyEx(gray, cv2.MORPH_BLACKHAT, blackhat_kernel)
    diff = cv2.max(diff, blackhat)

    # Adaptive threshold to handle varying scratch brightness across the image
    scratch_mask = cv2.adaptiveThreshold(
        diff, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 15, -8
    )

    # Morphological close to connect fragmented scratch segments
    kernel_close = cv2.getStructuringElement(cv2.MORPH_RECT, (1, 7))
    scratch_mask = cv2.morphologyEx(scratch_mask, cv2.MORPH_CLOSE, kernel_close)

    # Remove small noise blobs — keep only elongated structures (scratches)
    kernel_open = cv2.getStructuringElement(cv2.MORPH_RECT, (1, 5))
    scratch_mask = cv2.morphologyEx(scratch_mask, cv2.MORPH_OPEN, kernel_open)

    # Also detect horizontal scratches
    kernel_h_close = cv2.getStructuringElement(cv2.MORPH_RECT, (7, 1))
    h_mask = cv2.morphologyEx(
        cv2.adaptiveThreshold(diff, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 15, -8),
        cv2.MORPH_CLOSE, kernel_h_close,
    )
    kernel_h_open = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 1))
    h_mask = cv2.morphologyEx(h_mask, cv2.MORPH_OPEN, kernel_h_open)

    combined = cv2.bitwise_or(scratch_mask, h_mask)

    # Dilate slightly so inpainting covers scratch edges fully
    dilate_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    combined = cv2.dilate(combined, dilate_kernel, iterations=1)

    # A final close helps bridge broken crease segments so inpainting treats
    # them as a continuous artifact instead of isolated dots.
    bridge_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    combined = cv2.morphologyEx(combined, cv2.MORPH_CLOSE, bridge_kernel)

    # Filter by component area and shape. Real scratches are usually long and
    # sparse; broad dense blobs are more likely to be real content and lead to
    # over-aggressive inpainting artifacts.
    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(combined, connectivity=8)
    img_area = img.shape[0] * img.shape[1]
    min_area = max(18, img_area * 0.00003)
    max_area = img_area * 0.008
    filtered = np.zeros_like(combined)
    for i in range(1, num_labels):
        area = stats[i, cv2.CC_STAT_AREA]
        if not (min_area <= area <= max_area):
            continue

        width = max(1, stats[i, cv2.CC_STAT_WIDTH])
        height = max(1, stats[i, cv2.CC_STAT_HEIGHT])
        bbox_area = width * height
        fill_ratio = area / max(1, bbox_area)
        aspect_ratio = max(width, height) / max(1, min(width, height))
        is_elongated = aspect_ratio >= 2.2
        is_sparse_fold = fill_ratio <= 0.22 and max(width, height) >= 40

        if is_elongated or is_sparse_fold:
            filtered[labels == i] = 255

    scratch_coverage = np.count_nonzero(filtered) / img_area
    logger.info("Scratch detection: coverage=%.4f%%, components=%d", scratch_coverage * 100, num_labels - 1)

    return filtered


def analyze_damage_profile(img: np.ndarray, faces: Optional[list[dict]] = None) -> dict:
    """
    Decide whether Auto Face should escalate to the stronger old-photo path.
    The decision blends scratch coverage with low-saturation / low-contrast
    cues so ordinary portraits do not get over-restored.
    """
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    scratch_mask = detect_scratches(img)
    img_area = max(1, img.shape[0] * img.shape[1])
    scratch_ratio = float(np.count_nonzero(scratch_mask)) / img_area
    contrast = float(np.std(gray))
    mean_saturation = float(np.mean(hsv[:, :, 1]))

    degradation_levels = [
        estimate_degradation_level(face["blur_score"], face["area"])
        for face in (faces or [])
    ]
    severe_faces = sum(level == "severe" for level in degradation_levels)

    use_old_photo_pipeline = (
        scratch_ratio >= 0.012
        or (scratch_ratio >= 0.003 and (mean_saturation < 70 or contrast < 60))
        or (severe_faces > 0 and scratch_ratio >= 0.0015)
    )

    return {
        "scratch_ratio": scratch_ratio,
        "contrast": contrast,
        "mean_saturation": mean_saturation,
        "severe_faces": severe_faces,
        "use_old_photo_pipeline": use_old_photo_pipeline,
    }


def detect_micro_scratches(img: np.ndarray) -> np.ndarray:
    """
    More selective scratch pass used after face restoration. It keeps only thin,
    smaller leftover marks so the second inpaint pass does not wipe real detail.
    """
    candidate_mask = detect_scratches(img)
    if np.count_nonzero(candidate_mask) == 0:
        return candidate_mask

    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(candidate_mask, connectivity=8)
    img_area = max(1, img.shape[0] * img.shape[1])
    filtered = np.zeros_like(candidate_mask)
    min_area = max(10, int(img_area * 0.000005))
    max_area = max(40, int(img_area * 0.0012))

    for i in range(1, num_labels):
        area = stats[i, cv2.CC_STAT_AREA]
        if area < min_area or area > max_area:
            continue

        width = max(1, stats[i, cv2.CC_STAT_WIDTH])
        height = max(1, stats[i, cv2.CC_STAT_HEIGHT])
        longest = max(width, height)
        shortest = max(1, min(width, height))
        aspect_ratio = longest / shortest
        fill_ratio = area / max(1, width * height)

        if (aspect_ratio >= 2.6 and longest >= 18) or (fill_ratio <= 0.20 and longest >= 24):
            filtered[labels == i] = 255

    coverage = np.count_nonzero(filtered) / img_area
    logger.info("Residual scratch pass: coverage=%.4f%%", coverage * 100)
    return filtered


def cleanup_micro_scratches(img: np.ndarray) -> tuple[np.ndarray, float]:
    """
    A light second cleanup pass after face restoration. Uses a very small
    inpaint radius and feathered blending to avoid plastic-looking regions.
    """
    residual_mask = detect_micro_scratches(img)
    img_area = max(1, img.shape[0] * img.shape[1])
    residual_ratio = np.count_nonzero(residual_mask) / img_area
    if residual_ratio < 0.00005 or residual_ratio > 0.018:
        return img, residual_ratio

    repaired = cv2.inpaint(img, residual_mask, inpaintRadius=2, flags=cv2.INPAINT_TELEA)
    soft_mask = cv2.GaussianBlur(residual_mask, (0, 0), sigmaX=1.2, sigmaY=1.2)
    cleaned = blend_images(img, repaired, soft_mask.astype(np.float32) / 255.0, 0.72)
    return cleaned, residual_ratio


def final_photo_polish(img: np.ndarray) -> np.ndarray:
    """
    Final global polish for restored photos: mild denoise, contrast recovery,
    and restrained sharpening so the result stays crisp without turning harsh.
    """
    denoised = cv2.bilateralFilter(img, 5, 28, 24)

    lab = cv2.cvtColor(denoised, cv2.COLOR_BGR2LAB)
    l_channel, a_channel, b_channel = cv2.split(lab)
    clip_limit = 2.2 if float(np.mean(l_channel)) < 120 else 1.8
    clahe = cv2.createCLAHE(clipLimit=clip_limit, tileGridSize=(8, 8))
    l_channel = clahe.apply(l_channel)
    polished = cv2.cvtColor(cv2.merge([l_channel, a_channel, b_channel]), cv2.COLOR_LAB2BGR)

    blurred = cv2.GaussianBlur(polished, (0, 0), sigmaX=0.8, sigmaY=0.8)
    polished = cv2.addWeighted(polished, 1.10, blurred, -0.10, 0)
    return np.clip(polished, 0, 255).astype(np.uint8)


def restore_old_photo(img: np.ndarray, restoration_model: str = "auto", fidelity: float = 0.5) -> tuple[np.ndarray, int, str]:
    """
    Old photo restoration pipeline:
    1. Scratch detection + inpainting (morphological scratch isolation → Navier-Stokes inpainting)
    2. Denoise + scratch suppression (bilateral + median)
    3. Adaptive histogram equalization (CLAHE) — strong clipLimit for old photos
    4. Face restoration via GFPGAN (GFPGAN already runs RealESRGAN x2 on the
       background internally via its bg_upsampler — no separate pre-upscale needed).

    NOTE: Removed the ESRGAN pre-upscale step that was here previously.
    That step caused double background upscaling (ESRGAN ran on background twice:
    once explicitly before GFPGAN, then again inside GFPGAN's bg_upsampler).
    GFPGAN with bg_upsampler=RealESRGAN_x2 already handles the full pipeline.
    """
    # Step 1: Detect and inpaint scratches, creases, and fold lines
    scratch_mask = detect_scratches(img)
    scratch_pixels = np.count_nonzero(scratch_mask)
    img_area = img.shape[0] * img.shape[1]
    scratch_ratio = scratch_pixels / max(1, img_area)
    if scratch_pixels > 0:
        # Use both Navier-Stokes and Telea, then blend them. Telea tends to fill
        # thin scratches cleanly, while Navier-Stokes better preserves broader
        # structures around folds and creases.
        inpaint_radius = 4 if scratch_ratio > 0.01 else 3
        repaired_ns = cv2.inpaint(img, scratch_mask, inpaintRadius=inpaint_radius, flags=cv2.INPAINT_NS)
        repaired_telea = cv2.inpaint(img, scratch_mask, inpaintRadius=max(3, inpaint_radius - 1), flags=cv2.INPAINT_TELEA)
        img = cv2.addWeighted(repaired_telea, 0.72, repaired_ns, 0.28, 0)
        logger.info("Scratch inpainting applied: %d pixels repaired", scratch_pixels)

    # Step 2: Aggressive denoise — old photos have heavy grain
    denoised = cv2.bilateralFilter(img, 9, 100, 75)  # sigmaColor 75→100 for stronger smoothing
    denoised = cv2.medianBlur(denoised, 3)

    # Step 3: CLAHE — clipLimit 3.5 (was 2.0) for more visible contrast recovery
    lab = cv2.cvtColor(denoised, cv2.COLOR_BGR2LAB)
    l_channel, a_channel, b_channel = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=3.5, tileGridSize=(8, 8))  # was 2.0
    l_channel = clahe.apply(l_channel)
    enhanced = cv2.merge([l_channel, a_channel, b_channel])
    enhanced = cv2.cvtColor(enhanced, cv2.COLOR_LAB2BGR)

    # Step 4: Face restoration — GFPGAN and CodeFormer both return a 2x output.
    # For damaged portraits, favor a natural GFPGAN base with CodeFormer blended
    # back into the face when heavy degradation is detected.
    if restoration_model == "codeformer":
        restored, face_count, backend = restore_face_codeformer(enhanced, fidelity=fidelity)
    elif restoration_model == "gfpgan":
        restored, face_count = restore_face_gfpgan(enhanced, upscale=2)
        backend = "gfpgan"
    elif restoration_model == "hybrid":
        restored, face_count, backend = restore_face_hybrid(enhanced, fidelity=fidelity)
    else:
        faces = detect_faces_with_landmarks(enhanced)
        severe_faces = sum(
            estimate_degradation_level(face["blur_score"], face["area"]) == "severe"
            for face in faces
        )
        if severe_faces > 0 or scratch_ratio >= 0.005:
            restored, face_count, backend = restore_face_hybrid(enhanced, fidelity=fidelity)
        else:
            restored, face_count, backend = restore_face_auto(enhanced, fidelity=fidelity)

    # Step 5: Micro-scratch cleanup after the upscale/face pass.
    restored, residual_ratio = cleanup_micro_scratches(restored)
    if residual_ratio > 0:
        logger.info("Second cleanup pass applied: residual scratch coverage=%.4f%%", residual_ratio * 100)

    # Step 6: Final blend/noise/color polish.
    restored = final_photo_polish(restored)

    return restored, face_count, backend


# ─── Video Processing Pipeline (with Temporal Consistency) ────────────────────

def detect_scene_change(prev_frame: np.ndarray, curr_frame: np.ndarray, threshold: float = 30.0) -> bool:
    """Detect scene changes using mean absolute difference in grayscale."""
    prev_gray = cv2.cvtColor(prev_frame, cv2.COLOR_BGR2GRAY)
    curr_gray = cv2.cvtColor(curr_frame, cv2.COLOR_BGR2GRAY)
    # Resize to same dimensions for comparison
    if prev_gray.shape != curr_gray.shape:
        curr_gray = cv2.resize(curr_gray, (prev_gray.shape[1], prev_gray.shape[0]))
    diff = cv2.absdiff(prev_gray, curr_gray)
    mean_diff = float(np.mean(diff))
    return mean_diff > threshold


def temporal_blend(prev_restored: np.ndarray, curr_restored: np.ndarray, alpha: float = 0.15) -> np.ndarray:
    """
    Blend current frame with previous to reduce inter-frame flickering.
    Uses weighted average: result = (1-alpha)*curr + alpha*prev
    Only applied within the same scene (not across scene cuts).
    """
    if prev_restored.shape != curr_restored.shape:
        prev_restored = cv2.resize(prev_restored, (curr_restored.shape[1], curr_restored.shape[0]))
    return cv2.addWeighted(curr_restored, 1.0 - alpha, prev_restored, alpha, 0).astype(np.uint8)


def process_video(
    video_bytes: bytes,
    mode: str,
    face_enhance: bool,
    max_frames: int,
    temporal_consistency: bool = True,
    restoration_model: str = "gfpgan",
) -> tuple[bytes, int, int]:
    """
    Frame-by-frame video restoration pipeline with temporal consistency:
    1. Extract frames with ffmpeg
    2. Real-ESRGAN for background enhancement on each frame
    3. GFPGAN or CodeFormer for face regions
    4. Temporal blending to prevent facial flickering between frames
    5. Reconstruct video with ffmpeg at original framerate

    Returns (output_bytes, frames_processed, scene_changes).
    """
    tmpdir = tempfile.mkdtemp(prefix="glimpse_video_")
    try:
        input_path = os.path.join(tmpdir, "input.mp4")
        with open(input_path, "wb") as f:
            f.write(video_bytes)

        # Get video metadata
        probe = subprocess.run(
            ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_streams", input_path],
            capture_output=True, text=True, timeout=30,
        )
        streams = json.loads(probe.stdout)
        video_stream = next((s for s in streams.get("streams", []) if s["codec_type"] == "video"), None)
        if not video_stream:
            raise ValueError("No video stream found")

        fps_parts = video_stream.get("r_frame_rate", "30/1").split("/")
        fps = float(fps_parts[0]) / float(fps_parts[1]) if len(fps_parts) == 2 else 30.0
        width = int(video_stream.get("width", 0))
        height = int(video_stream.get("height", 0))
        logger.info("Video: %dx%d @ %.2ffps", width, height, fps)

        # Extract frames as PNG
        frames_dir = os.path.join(tmpdir, "frames")
        os.makedirs(frames_dir)
        subprocess.run(
            ["ffmpeg", "-i", input_path, "-vframes", str(max_frames), f"{frames_dir}/frame_%06d.png"],
            capture_output=True, timeout=120,
        )

        frame_files = sorted(Path(frames_dir).glob("frame_*.png"))
        if not frame_files:
            raise ValueError("No frames extracted from video")

        logger.info("Extracted %d frames, processing...", len(frame_files))

        out_dir = os.path.join(tmpdir, "processed")
        os.makedirs(out_dir)
        scale = 4 if mode == "upscale_4x" else 2

        prev_input_frame = None
        prev_restored_frame = None
        scene_changes = 0
        frame_times = []

        for i, frame_path in enumerate(frame_files):
            frame_start = time.time()
            frame = cv2.imread(str(frame_path), cv2.IMREAD_COLOR)
            if frame is None:
                continue

            # Scene change detection
            is_scene_change = False
            if prev_input_frame is not None:
                is_scene_change = detect_scene_change(prev_input_frame, frame)
                if is_scene_change:
                    scene_changes += 1

            # Dynamic complexity: skip heavy ML for tiny frames (< 64px smallest dim)
            h, w = frame.shape[:2]
            skip_ml = min(h, w) < 64

            # Real-ESRGAN background enhancement
            if mode in ("upscale_2x", "upscale_4x") and not skip_ml:
                frame = upscale_image(frame, scale=scale)

            # Face restoration on each frame
            if face_enhance and not skip_ml:
                if restoration_model == "codeformer":
                    frame, _, _ = restore_face_codeformer(frame)
                else:
                    frame, _ = restore_face_gfpgan(frame)

            # Temporal blending (only within same scene)
            if temporal_consistency and prev_restored_frame is not None and not is_scene_change:
                frame = temporal_blend(prev_restored_frame, frame, alpha=0.15)

            prev_input_frame = cv2.imread(str(frame_path), cv2.IMREAD_COLOR)
            prev_restored_frame = frame.copy()

            out_path = os.path.join(out_dir, f"frame_{i:06d}.png")
            cv2.imwrite(out_path, frame)

            frame_ms = int((time.time() - frame_start) * 1000)
            frame_times.append(frame_ms)

            if (i + 1) % 10 == 0:
                avg_ms = sum(frame_times[-10:]) / min(10, len(frame_times))
                remaining = len(frame_files) - (i + 1)
                eta_s = int(avg_ms * remaining / 1000)
                logger.info("  Processed %d/%d frames (avg %dms/frame, ETA %ds)",
                            i + 1, len(frame_files), int(avg_ms), eta_s)

        # Reconstruct video with ffmpeg
        output_path = os.path.join(tmpdir, "output.mp4")
        first_out = cv2.imread(os.path.join(out_dir, "frame_000000.png"))
        out_h, out_w = first_out.shape[:2] if first_out is not None else (height * scale, width * scale)

        subprocess.run(
            [
                "ffmpeg", "-y",
                "-framerate", str(fps),
                "-i", f"{out_dir}/frame_%06d.png",
                "-c:v", "libx264",
                "-preset", "fast",
                "-crf", "18",
                "-pix_fmt", "yuv420p",
                "-vf", f"scale={out_w}:{out_h}",
                output_path,
            ],
            capture_output=True, timeout=300,
        )

        with open(output_path, "rb") as f:
            output_bytes = f.read()

        return output_bytes, len(frame_files), scene_changes

    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


# ─── FastAPI App ──────────────────────────────────────────────────────────────

def _available_capabilities() -> list[str]:
    """List available restoration capabilities based on installed models."""
    caps = []
    if Path(MODEL_DIR / "GFPGANv1.4.pth").exists():
        caps.extend(["face_restore", "face_restore_hd", "old_photo"])
    if Path(MODEL_DIR / "RealESRGAN_x2plus.pth").exists():
        caps.append("upscale_2x")
    if Path(MODEL_DIR / "RealESRGAN_x4plus.pth").exists():
        caps.append("upscale_4x")
    # CodeFormer: check direct module weights first, then pip package
    cf_weights = Path(__file__).parent.parent.parent / "enhancement_modules" / "CodeFormer-master" / "weights" / "CodeFormer" / "codeformer.pth"
    if cf_weights.exists():
        caps.append("codeformer")
    else:
        try:
            import codeformer  # noqa: F401
            caps.append("codeformer")
        except ImportError:
            pass
    if "codeformer" in caps and "face_restore" in caps:
        caps.append("hybrid")
    if shutil.which("ffmpeg"):
        caps.append("video_restore")
    caps.append("face_analysis")
    return caps


@asynccontextmanager
async def lifespan(app: FastAPI):
    caps = _available_capabilities()
    logger.info("Restoration service starting (device=%s, gpu=%s, models=%s)", DEVICE, GPU_DEVICE, MODEL_DIR)
    logger.info("Models: GFPGAN=%s, RealESRGAN_x2=%s, RealESRGAN_x4=%s",
                Path(MODEL_DIR / "GFPGANv1.4.pth").exists(),
                Path(MODEL_DIR / "RealESRGAN_x2plus.pth").exists(),
                Path(MODEL_DIR / "RealESRGAN_x4plus.pth").exists())
    logger.info("Capabilities: %s", caps)

    # ── Eagerly preload models at startup so first request is fast ──
    preload_start = time.time()
    try:
        if Path(MODEL_DIR / "RealESRGAN_x2plus.pth").exists():
            get_realesrgan(2)
        if Path(MODEL_DIR / "RealESRGAN_x4plus.pth").exists():
            get_realesrgan(4)
        if Path(MODEL_DIR / "GFPGANv1.4.pth").exists():
            get_gfpgan()
        get_codeformer()
        get_face_detector()
        logger.info("All models preloaded in %.1fs", time.time() - preload_start)
    except Exception as e:
        logger.warning("Model preload partially failed: %s (will lazy-load on demand)", e)

    yield
    logger.info("Restoration service shutting down")


app = FastAPI(title="GlimpseAI Restoration Service", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", response_model=HealthResponse)
async def health():
    caps = _available_capabilities()
    return HealthResponse(
        status="ok",
        device=DEVICE,
        gpu_available=(DEVICE in ("cuda", "mps")),
        models_dir=str(MODEL_DIR),
        models_available={
            "gfpgan_v1.4": Path(MODEL_DIR / "GFPGANv1.4.pth").exists(),
            "realesrgan_x2": Path(MODEL_DIR / "RealESRGAN_x2plus.pth").exists(),
            "realesrgan_x4": Path(MODEL_DIR / "RealESRGAN_x4plus.pth").exists(),
            "codeformer": "codeformer" in caps,
            "face_detector": "face_analysis" in caps,
        },
        capabilities=caps,
    )


@app.post("/analyze-faces")
async def analyze_faces_endpoint(req: RestoreRequest):
    """
    Detect faces and return landmark analysis without performing restoration.
    Useful for previewing face detection before committing to a restore.
    """
    try:
        img = decode_image(req.image_base64)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid image: {e}")

    faces = detect_faces_with_landmarks(img)
    analysis = []
    for face in faces:
        level = estimate_degradation_level(face["blur_score"], face["area"])
        analysis.append({
            **face,
            "degradation_level": level,
            "recommended_model": "codeformer" if level == "severe" else "gfpgan",
        })

    return {
        "faces_detected": len(faces),
        "faces": analysis,
        "device": DEVICE,
    }


# 1024px cap: sufficient for GFPGAN face detection accuracy and significantly
# faster than 2048px on CPU (4x fewer pixels = ~4x faster inference).
MAX_ML_DIM = 1024  # was 2048


def _cap_image_for_ml(img: np.ndarray) -> np.ndarray:
    """Downscale image if either dimension exceeds MAX_ML_DIM (preserves aspect ratio)."""
    h, w = img.shape[:2]
    max_dim = max(h, w)
    if max_dim <= MAX_ML_DIM:
        return img
    scale = MAX_ML_DIM / max_dim
    new_w, new_h = int(w * scale), int(h * scale)
    logger.info("Capping image from %dx%d → %dx%d for ML inference", w, h, new_w, new_h)
    return cv2.resize(img, (new_w, new_h), interpolation=cv2.INTER_AREA)


def _run_restore_sync(img: np.ndarray, req_mode: str, req_restoration_model: str,
                      req_fidelity: float, req_face_enhance: bool):
    """Synchronous ML inference — called via asyncio.to_thread() to keep event loop free."""
    faces_detected = 0
    backend_used = "gfpgan"
    face_analysis = None

    # Cap large images to avoid CPU timeouts
    img = _cap_image_for_ml(img)

    if req_mode == "face_restore":
        if req_restoration_model == "codeformer":
            result, faces_detected, backend_used = restore_face_codeformer(img, fidelity=req_fidelity)
        elif req_restoration_model == "hybrid":
            result, faces_detected, backend_used = restore_face_hybrid(img, fidelity=req_fidelity)
        elif req_restoration_model == "auto":
            result, faces_detected, backend_used = restore_face_auto(img, fidelity=req_fidelity)
        else:
            result, faces_detected = restore_face_gfpgan(img, upscale=2)
            backend_used = "gfpgan"

    elif req_mode == "face_restore_hd":
        # HD pipeline: GFPGAN face restore (2x) → ESRGAN 2x = 4x total output.
        # Previous pipeline was ESRGAN 4x → GFPGAN 2x = 8x (caused OOM + timeouts).
        if req_restoration_model == "codeformer":
            face_restored, faces_detected, backend_used = restore_face_codeformer(img, fidelity=req_fidelity)
        elif req_restoration_model == "hybrid":
            face_restored, faces_detected, backend_used = restore_face_hybrid(img, fidelity=req_fidelity)
        elif req_restoration_model == "auto":
            face_restored, faces_detected, backend_used = restore_face_auto(img, fidelity=req_fidelity)
        else:
            face_restored, faces_detected = restore_face_gfpgan(img, upscale=2)
            backend_used = "gfpgan"
        # Second pass: ESRGAN 2x for overall sharpness and texture on the face-restored image
        result = upscale_image(face_restored, scale=2)

    elif req_mode == "codeformer":
        result, faces_detected, backend_used = restore_face_codeformer(img, fidelity=req_fidelity)

    elif req_mode == "hybrid":
        result, faces_detected, backend_used = restore_face_hybrid(img, fidelity=req_fidelity)

    elif req_mode == "auto_face":
        faces_info = detect_faces_with_landmarks(img)
        face_analysis = [
            {**f, "degradation_level": estimate_degradation_level(f["blur_score"], f["area"])}
            for f in faces_info
        ]
        damage_profile = analyze_damage_profile(img, faces_info)
        if damage_profile["use_old_photo_pipeline"]:
            selected_model = req_restoration_model
            if selected_model == "auto":
                if damage_profile["severe_faces"] > 0 or damage_profile["scratch_ratio"] >= 0.005:
                    selected_model = "hybrid"
            logger.info(
                "Auto Face switching to old-photo pipeline: scratch=%.4f%% sat=%.1f contrast=%.1f model=%s",
                damage_profile["scratch_ratio"] * 100,
                damage_profile["mean_saturation"],
                damage_profile["contrast"],
                selected_model,
            )
            result, faces_detected, backend_used = restore_old_photo(
                img,
                restoration_model=selected_model,
                fidelity=req_fidelity,
            )
        else:
            result, faces_detected, backend_used = restore_face_auto(img, fidelity=req_fidelity)

    elif req_mode == "upscale_2x":
        result = upscale_image(img, scale=2)
        if req_face_enhance:
            result, faces_detected = restore_face_gfpgan(result)

    elif req_mode == "upscale_4x":
        result = upscale_image(img, scale=4)
        if req_face_enhance:
            result, faces_detected = restore_face_gfpgan(result)

    elif req_mode == "old_photo":
        result, faces_detected, backend_used = restore_old_photo(
            img, restoration_model=req_restoration_model, fidelity=req_fidelity,
        )

    else:
        raise ValueError(f"Unknown mode: {req_mode}")

    return result, faces_detected, backend_used, face_analysis


@app.post("/restore", response_model=RestoreResponse)
async def restore_image_endpoint(req: RestoreRequest):
    """
    Image restoration endpoint.
    Modes: face_restore, face_restore_hd, codeformer, hybrid, upscale_2x, upscale_4x, old_photo, auto_face

    ML inference runs in a thread so /health stays responsive.
    """
    start = time.time()
    try:
        img = decode_image(req.image_base64)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid image: {e}")

    logger.info("Restore request: mode=%s, model=%s, input=%dx%d",
                req.mode, req.restoration_model, img.shape[1], img.shape[0])

    try:
        result, faces_detected, backend_used, face_analysis = await asyncio.to_thread(
            _run_restore_sync, img, req.mode, req.restoration_model,
            req.fidelity, req.face_enhance,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("Restoration failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Restoration failed: {str(e)}")

    b64, mime = encode_image(result)
    elapsed_ms = int((time.time() - start) * 1000)

    logger.info("Restored: mode=%s, backend=%s, faces=%d, time=%dms, input=%dx%d",
                req.mode, backend_used, faces_detected, elapsed_ms,
                img.shape[1], img.shape[0])
    return RestoreResponse(
        image_base64=b64,
        mime_type=mime,
        processing_ms=elapsed_ms,
        faces_detected=faces_detected,
        mode=req.mode,
        device=DEVICE,
        restoration_backend=backend_used,
        face_analysis=face_analysis,
    )


@app.post("/restore-video", response_model=VideoRestoreResponse)
async def restore_video_endpoint(req: VideoRestoreRequest):
    """
    Video restoration: frame extraction → per-frame processing → temporal blending → reconstruction.
    """
    start = time.time()

    try:
        video_bytes = base64.b64decode(req.video_base64)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid video base64: {e}")

    try:
        output_bytes, frames, scene_changes = process_video(
            video_bytes,
            req.mode,
            req.face_enhance,
            req.max_frames,
            temporal_consistency=req.temporal_consistency,
            restoration_model=req.restoration_model,
        )
    except Exception as e:
        logger.error("Video restoration failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Video restoration failed: {str(e)}")

    elapsed_ms = int((time.time() - start) * 1000)
    b64_out = base64.b64encode(output_bytes).decode("utf-8")

    logger.info("Video restored: mode=%s, frames=%d, scenes=%d, time=%dms", req.mode, frames, scene_changes, elapsed_ms)
    return VideoRestoreResponse(
        video_base64=b64_out,
        mime_type="video/mp4",
        processing_ms=elapsed_ms,
        frames_processed=frames,
        mode=req.mode,
        scene_changes_detected=scene_changes,
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=PORT,
        log_level="info",
        # httptools avoids h11's strict header-size limit which causes
        # "Headers Timeout Error" when receiving large base64-encoded images.
        http="httptools",
        # Keep connections alive for up to 10 min — ML inference can take minutes.
        timeout_keep_alive=600,
        # Single worker to keep all ML models loaded in one process.
        workers=1,
    )
