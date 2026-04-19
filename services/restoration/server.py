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
    """Lazy-load CodeFormer face restorer (superior for heavily degraded faces)."""
    global _codeformer_restorer
    if _codeformer_restorer is None:
        try:
            from codeformer import CodeFormer
            _codeformer_restorer = CodeFormer(upscale=2, device=str(FACE_DEVICE))
            logger.info("CodeFormer model loaded (device=%s)", FACE_DEVICE)
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
    mode: str = Field("face_restore", description="face_restore | face_restore_hd | codeformer | upscale_2x | upscale_4x | old_photo | auto_face")
    scale: int = Field(2, description="Upscale factor (1, 2, or 4)")
    face_enhance: bool = Field(True, description="Apply face enhancement on detected faces")
    restoration_model: str = Field("auto", description="gfpgan | codeformer | auto")
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


def restore_face_codeformer(img: np.ndarray, fidelity: float = 0.5) -> tuple[np.ndarray, int]:
    """
    Run CodeFormer face restoration (superior for heavily degraded/blurry faces).
    Fidelity: 0.0 = max quality (more hallucination), 1.0 = max fidelity (closer to input).
    Falls back to GFPGAN if CodeFormer is unavailable.
    """
    cf = get_codeformer()
    if cf == "unavailable" or cf is None:
        logger.info("CodeFormer unavailable, falling back to GFPGAN")
        return restore_face_gfpgan(img)

    try:
        from codeformer.app import inference_app
        # Save to temp, run inference, load result
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

        # inference_app returns the output path
        if result_path and Path(result_path).exists():
            result_img = cv2.imread(str(result_path), cv2.IMREAD_COLOR)
            # Clean up
            Path(tmp_in).unlink(missing_ok=True)
            Path(result_path).unlink(missing_ok=True)
            if result_img is not None:
                # Estimate face count from detection
                faces = detect_faces_with_landmarks(img)
                return result_img, len(faces)

        Path(tmp_in).unlink(missing_ok=True)
        logger.warning("CodeFormer produced no output — falling back to GFPGAN")
        return restore_face_gfpgan(img)

    except Exception as e:
        logger.warning("CodeFormer inference failed: %s — falling back to GFPGAN", e)
        return restore_face_gfpgan(img)


def restore_face_auto(img: np.ndarray, fidelity: float = 0.5) -> tuple[np.ndarray, int, str]:
    """
    Auto-select restoration model based on face degradation analysis.
    - Mild degradation: GFPGAN (faster, good for reasonable-quality faces)
    - Severe degradation: CodeFormer (better at hallucinating missing details)
    Returns (image, face_count, backend_used).
    """
    faces = detect_faces_with_landmarks(img)

    if not faces:
        # No faces detected — run GFPGAN anyway (it has its own detection)
        result, count = restore_face_gfpgan(img)
        return result, count, "gfpgan"

    # Check worst-case face degradation
    worst_degradation = "mild"
    for face in faces:
        level = estimate_degradation_level(face["blur_score"], face["area"])
        if level == "severe":
            worst_degradation = "severe"
            break
        elif level == "moderate" and worst_degradation == "mild":
            worst_degradation = "moderate"

    logger.info("Auto-select: %d faces, worst degradation=%s", len(faces), worst_degradation)

    if worst_degradation == "severe":
        result, count = restore_face_codeformer(img, fidelity=fidelity)
        return result, count, "codeformer"
    else:
        result, count = restore_face_gfpgan(img)
        return result, count, "gfpgan"


def upscale_image(img: np.ndarray, scale: int = 4) -> np.ndarray:
    """Run Real-ESRGAN upscaling."""
    upsampler = get_realesrgan(scale)
    output, _ = upsampler.enhance(img, outscale=scale)
    return output


def restore_old_photo(img: np.ndarray, restoration_model: str = "auto", fidelity: float = 0.5) -> tuple[np.ndarray, int, str]:
    """
    Old photo restoration pipeline:
    1. Denoise + scratch suppression (bilateral + median)
    2. Adaptive histogram equalization (CLAHE) — strong clipLimit for old photos
    3. Face restoration via GFPGAN (GFPGAN already runs RealESRGAN x2 on the
       background internally via its bg_upsampler — no separate pre-upscale needed).

    NOTE: Removed the ESRGAN pre-upscale step that was here previously.
    That step caused double background upscaling (ESRGAN ran on background twice:
    once explicitly before GFPGAN, then again inside GFPGAN's bg_upsampler).
    GFPGAN with bg_upsampler=RealESRGAN_x2 already handles the full pipeline.
    """
    # Step 1: Aggressive denoise — old photos have heavy grain and scratches
    denoised = cv2.bilateralFilter(img, 9, 100, 75)  # sigmaColor 75→100 for stronger smoothing
    denoised = cv2.medianBlur(denoised, 3)

    # Step 2: CLAHE — clipLimit 3.5 (was 2.0) for more visible contrast recovery
    lab = cv2.cvtColor(denoised, cv2.COLOR_BGR2LAB)
    l_channel, a_channel, b_channel = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=3.5, tileGridSize=(8, 8))  # was 2.0
    l_channel = clahe.apply(l_channel)
    enhanced = cv2.merge([l_channel, a_channel, b_channel])
    enhanced = cv2.cvtColor(enhanced, cv2.COLOR_LAB2BGR)

    # Step 3: Face restoration — GFPGAN internally applies RealESRGAN to background.
    # Output is 2x the original size with restored faces + enhanced background.
    if restoration_model == "codeformer":
        restored, face_count = restore_face_codeformer(enhanced, fidelity=fidelity)
        backend = "codeformer"
    elif restoration_model == "gfpgan":
        restored, face_count = restore_face_gfpgan(enhanced, upscale=2)
        backend = "gfpgan"
    else:
        restored, face_count, backend = restore_face_auto(enhanced, fidelity=fidelity)

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

        for i, frame_path in enumerate(frame_files):
            frame = cv2.imread(str(frame_path), cv2.IMREAD_COLOR)
            if frame is None:
                continue

            # Scene change detection
            is_scene_change = False
            if prev_input_frame is not None:
                is_scene_change = detect_scene_change(prev_input_frame, frame)
                if is_scene_change:
                    scene_changes += 1

            # Real-ESRGAN background enhancement
            if mode in ("upscale_2x", "upscale_4x"):
                frame = upscale_image(frame, scale=scale)

            # Face restoration on each frame
            if face_enhance:
                if restoration_model == "codeformer":
                    frame, _ = restore_face_codeformer(frame)
                else:
                    frame, _ = restore_face_gfpgan(frame)

            # Temporal blending (only within same scene)
            if temporal_consistency and prev_restored_frame is not None and not is_scene_change:
                frame = temporal_blend(prev_restored_frame, frame, alpha=0.15)

            prev_input_frame = cv2.imread(str(frame_path), cv2.IMREAD_COLOR)
            prev_restored_frame = frame.copy()

            out_path = os.path.join(out_dir, f"frame_{i:06d}.png")
            cv2.imwrite(out_path, frame)

            if (i + 1) % 10 == 0:
                logger.info("  Processed %d/%d frames", i + 1, len(frame_files))

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
    # CodeFormer is a pip package, check import
    try:
        import codeformer  # noqa: F401
        caps.append("codeformer")
    except ImportError:
        pass
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
            result, faces_detected = restore_face_codeformer(img, fidelity=req_fidelity)
            backend_used = "codeformer"
        elif req_restoration_model == "auto":
            result, faces_detected, backend_used = restore_face_auto(img, fidelity=req_fidelity)
        else:
            result, faces_detected = restore_face_gfpgan(img, upscale=2)

    elif req_mode == "face_restore_hd":
        # HD pipeline: GFPGAN face restore (2x) → ESRGAN 2x = 4x total output.
        # Previous pipeline was ESRGAN 4x → GFPGAN 2x = 8x (caused OOM + timeouts).
        if req_restoration_model == "codeformer":
            face_restored, faces_detected = restore_face_codeformer(img, fidelity=req_fidelity)
            backend_used = "codeformer"
        elif req_restoration_model == "auto":
            face_restored, faces_detected, backend_used = restore_face_auto(img, fidelity=req_fidelity)
        else:
            face_restored, faces_detected = restore_face_gfpgan(img, upscale=2)
            backend_used = "gfpgan"
        # Second pass: ESRGAN 2x for overall sharpness and texture on the face-restored image
        result = upscale_image(face_restored, scale=2)

    elif req_mode == "codeformer":
        result, faces_detected = restore_face_codeformer(img, fidelity=req_fidelity)
        backend_used = "codeformer"

    elif req_mode == "auto_face":
        faces_info = detect_faces_with_landmarks(img)
        face_analysis = [
            {**f, "degradation_level": estimate_degradation_level(f["blur_score"], f["area"])}
            for f in faces_info
        ]
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
    Modes: face_restore, face_restore_hd, codeformer, upscale_2x, upscale_4x, old_photo, auto_face

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
