"""
GlimpseAI Restoration Service
FastAPI sidecar wrapping GFPGAN + Real-ESRGAN for AI-powered image/video restoration.
Runs as a local service on port 7860, called by the Node.js API server.
"""

import base64
import io
import logging
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from contextlib import asynccontextmanager

# ─── Compatibility patch for torchvision ≥0.17 + basicsr ─────────────────────
# basicsr imports from torchvision.transforms.functional_tensor which was removed.
# Redirect to the correct module before any ML imports.
import importlib
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
PORT = int(os.getenv("RESTORATION_PORT", "7860"))

# Device selection: MPS (Apple Silicon) > CUDA > CPU
if torch.backends.mps.is_available():
    DEVICE = "mps"
elif torch.cuda.is_available():
    DEVICE = "cuda"
else:
    DEVICE = "cpu"

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("restoration")

# ─── Global model holders (lazy-loaded) ──────────────────────────────────────
_gfpgan_restorer = None
_realesrgan_x2 = None
_realesrgan_x4 = None


def get_gfpgan():
    """Lazy-load GFPGAN face restorer."""
    global _gfpgan_restorer
    if _gfpgan_restorer is None:
        from gfpgan import GFPGANer
        model_path = str(MODEL_DIR / "GFPGANv1.4.pth")
        if not Path(model_path).exists():
            raise RuntimeError(f"GFPGAN model not found at {model_path}")

        # Use CPU for GFPGAN if MPS (some ops not supported on MPS)
        bg_upsampler = _get_realesrgan_upsampler(scale=2)
        _gfpgan_restorer = GFPGANer(
            model_path=model_path,
            upscale=2,
            arch="clean",
            channel_multiplier=2,
            bg_upsampler=bg_upsampler,
            device=torch.device("cpu"),  # GFPGAN uses CPU for stability on MPS
        )
        logger.info("GFPGAN model loaded (device=cpu, bg_upsampler=RealESRGAN)")
    return _gfpgan_restorer


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

    # Use CPU for stability; MPS has sporadic issues with some ops
    upsampler = RealESRGANer(
        scale=scale,
        model_path=model_path,
        model=model,
        tile=0,
        tile_pad=10,
        pre_pad=0,
        half=False,
        device=torch.device("cpu"),
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


# ─── Request/Response Models ─────────────────────────────────────────────────

class RestoreRequest(BaseModel):
    """Base64-encoded image input with restoration parameters."""
    image_base64: str = Field(..., description="Base64-encoded image (no data: prefix)")
    mode: str = Field("face_restore", description="face_restore | upscale_2x | upscale_4x | old_photo | face_restore_hd")
    scale: int = Field(2, description="Upscale factor (1, 2, or 4)")
    face_enhance: bool = Field(True, description="Apply GFPGAN face enhancement")

class RestoreResponse(BaseModel):
    image_base64: str
    mime_type: str
    processing_ms: int
    faces_detected: int
    mode: str
    device: str

class VideoRestoreRequest(BaseModel):
    """Base64-encoded video input for frame-by-frame restoration."""
    video_base64: str = Field(..., description="Base64-encoded video")
    mode: str = Field("upscale_2x", description="upscale_2x | upscale_4x | face_restore")
    face_enhance: bool = Field(True, description="Apply GFPGAN on detected face regions")
    max_frames: int = Field(300, description="Max frames to process (safety limit)")

class VideoRestoreResponse(BaseModel):
    video_base64: str
    mime_type: str
    processing_ms: int
    frames_processed: int
    mode: str

class HealthResponse(BaseModel):
    status: str
    device: str
    models_dir: str
    models_available: dict


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


def restore_face(img: np.ndarray, upscale: int = 2) -> tuple[np.ndarray, int]:
    """
    Run GFPGAN face restoration.
    Returns (restored_image, num_faces_detected).
    If no face detected, returns original with face_count=0.
    """
    restorer = get_gfpgan()

    # GFPGAN expects BGR input (OpenCV format)
    _, _, restored_img = restorer.enhance(
        img,
        has_aligned=False,
        only_center_face=False,
        paste_back=True,
        weight=0.5,
    )

    if restored_img is None:
        logger.warning("GFPGAN returned None — bypassing face restoration")
        return img, 0

    # Count detected faces from the restorer's internal state
    try:
        face_count = len(restorer.face_helper.det_faces) if hasattr(restorer, 'face_helper') else 0
    except Exception:
        face_count = 1

    return restored_img, face_count


def upscale_image(img: np.ndarray, scale: int = 4) -> np.ndarray:
    """Run Real-ESRGAN upscaling."""
    upsampler = get_realesrgan(scale)
    output, _ = upsampler.enhance(img, outscale=scale)
    return output


def restore_old_photo(img: np.ndarray) -> tuple[np.ndarray, int]:
    """
    Old photo restoration pipeline:
    1. Denoise + adaptive histogram equalization
    2. Real-ESRGAN 2x upscale for texture recovery
    3. GFPGAN face restoration (if faces detected)
    """
    # Step 1: Denoise — bilateral filter preserves edges
    denoised = cv2.bilateralFilter(img, 9, 75, 75)

    # Step 2: CLAHE for adaptive contrast
    lab = cv2.cvtColor(denoised, cv2.COLOR_BGR2LAB)
    l_channel, a_channel, b_channel = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    l_channel = clahe.apply(l_channel)
    enhanced = cv2.merge([l_channel, a_channel, b_channel])
    enhanced = cv2.cvtColor(enhanced, cv2.COLOR_LAB2BGR)

    # Step 3: Real-ESRGAN 2x upscale for texture recovery
    upscaled = upscale_image(enhanced, scale=2)

    # Step 4: GFPGAN face restoration
    restored, face_count = restore_face(upscaled, upscale=2)

    return restored, face_count


# ─── Video Processing Pipeline ────────────────────────────────────────────────

def process_video(video_bytes: bytes, mode: str, face_enhance: bool, max_frames: int) -> tuple[bytes, int]:
    """
    Frame-by-frame video restoration pipeline:
    1. Extract frames with ffmpeg
    2. Process each frame (Real-ESRGAN + optional GFPGAN)
    3. Reconstruct video with ffmpeg at original framerate
    """
    tmpdir = tempfile.mkdtemp(prefix="glimpse_video_")
    try:
        # Write input video
        input_path = os.path.join(tmpdir, "input.mp4")
        with open(input_path, "wb") as f:
            f.write(video_bytes)

        # Get video metadata
        probe = subprocess.run(
            ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_streams", input_path],
            capture_output=True, text=True, timeout=30,
        )
        import json
        streams = json.loads(probe.stdout)
        video_stream = next((s for s in streams.get("streams", []) if s["codec_type"] == "video"), None)
        if not video_stream:
            raise ValueError("No video stream found")

        fps_parts = video_stream.get("r_frame_rate", "30/1").split("/")
        fps = float(fps_parts[0]) / float(fps_parts[1]) if len(fps_parts) == 2 else 30.0
        width = int(video_stream.get("width", 0))
        height = int(video_stream.get("height", 0))
        logger.info(f"Video: {width}x{height} @ {fps:.2f}fps")

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

        logger.info(f"Extracted {len(frame_files)} frames, processing...")

        # Process each frame
        out_dir = os.path.join(tmpdir, "processed")
        os.makedirs(out_dir)
        scale = 4 if mode == "upscale_4x" else 2

        for i, frame_path in enumerate(frame_files):
            frame = cv2.imread(str(frame_path), cv2.IMREAD_COLOR)
            if frame is None:
                continue

            # Real-ESRGAN background enhancement
            if mode in ("upscale_2x", "upscale_4x"):
                frame = upscale_image(frame, scale=scale)

            # GFPGAN face restoration (if enabled)
            if face_enhance:
                frame, _ = restore_face(frame)

            out_path = os.path.join(out_dir, f"frame_{i:06d}.png")
            cv2.imwrite(out_path, frame)

            if (i + 1) % 10 == 0:
                logger.info(f"  Processed {i + 1}/{len(frame_files)} frames")

        # Reconstruct video with ffmpeg
        output_path = os.path.join(tmpdir, "output.mp4")

        # Get output resolution from first processed frame
        first_out = cv2.imread(os.path.join(out_dir, "frame_000000.png"))
        out_h, out_w = first_out.shape[:2] if first_out is not None else (height * scale, width * scale)

        subprocess.run(
            [
                "ffmpeg", "-y",
                "-framerate", str(fps),
                "-i", f"{out_dir}/frame_%06d.png",
                "-c:v", "libx264",
                "-preset", "medium",
                "-crf", "18",
                "-pix_fmt", "yuv420p",
                "-vf", f"scale={out_w}:{out_h}",
                output_path,
            ],
            capture_output=True, timeout=300,
        )

        with open(output_path, "rb") as f:
            output_bytes = f.read()

        return output_bytes, len(frame_files)

    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


# ─── FastAPI App ──────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(f"Restoration service starting (device={DEVICE}, models={MODEL_DIR})")
    logger.info(f"Models available: GFPGAN={Path(MODEL_DIR / 'GFPGANv1.4.pth').exists()}, "
                f"RealESRGAN_x2={Path(MODEL_DIR / 'RealESRGAN_x2plus.pth').exists()}, "
                f"RealESRGAN_x4={Path(MODEL_DIR / 'RealESRGAN_x4plus.pth').exists()}")
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
    return HealthResponse(
        status="ok",
        device=DEVICE,
        models_dir=str(MODEL_DIR),
        models_available={
            "gfpgan_v1.4": Path(MODEL_DIR / "GFPGANv1.4.pth").exists(),
            "realesrgan_x2": Path(MODEL_DIR / "RealESRGAN_x2plus.pth").exists(),
            "realesrgan_x4": Path(MODEL_DIR / "RealESRGAN_x4plus.pth").exists(),
        },
    )


@app.post("/restore", response_model=RestoreResponse)
async def restore_image_endpoint(req: RestoreRequest):
    """
    Image restoration endpoint.
    Modes: face_restore, face_restore_hd, upscale_2x, upscale_4x, old_photo
    """
    start = time.time()
    try:
        img = decode_image(req.image_base64)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid image: {e}")

    faces_detected = 0

    try:
        if req.mode == "face_restore":
            result, faces_detected = restore_face(img, upscale=2)

        elif req.mode == "face_restore_hd":
            # 4x face restore: upscale first, then face restore
            upscaled = upscale_image(img, scale=4)
            result, faces_detected = restore_face(upscaled, upscale=1)

        elif req.mode == "upscale_2x":
            result = upscale_image(img, scale=2)
            if req.face_enhance:
                result, faces_detected = restore_face(result)

        elif req.mode == "upscale_4x":
            result = upscale_image(img, scale=4)
            if req.face_enhance:
                result, faces_detected = restore_face(result)

        elif req.mode == "old_photo":
            result, faces_detected = restore_old_photo(img)

        else:
            raise HTTPException(status_code=400, detail=f"Unknown mode: {req.mode}")

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Restoration failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Restoration failed: {str(e)}")

    b64, mime = encode_image(result)
    elapsed_ms = int((time.time() - start) * 1000)

    logger.info(f"Restored image: mode={req.mode}, faces={faces_detected}, time={elapsed_ms}ms")
    return RestoreResponse(
        image_base64=b64,
        mime_type=mime,
        processing_ms=elapsed_ms,
        faces_detected=faces_detected,
        mode=req.mode,
        device=DEVICE,
    )


@app.post("/restore-video", response_model=VideoRestoreResponse)
async def restore_video_endpoint(req: VideoRestoreRequest):
    """
    Video restoration: frame extraction → per-frame processing → reconstruction.
    """
    start = time.time()

    try:
        video_bytes = base64.b64decode(req.video_base64)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid video base64: {e}")

    try:
        output_bytes, frames = process_video(video_bytes, req.mode, req.face_enhance, req.max_frames)
    except Exception as e:
        logger.error(f"Video restoration failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Video restoration failed: {str(e)}")

    elapsed_ms = int((time.time() - start) * 1000)
    b64_out = base64.b64encode(output_bytes).decode("utf-8")

    logger.info(f"Video restored: mode={req.mode}, frames={frames}, time={elapsed_ms}ms")
    return VideoRestoreResponse(
        video_base64=b64_out,
        mime_type="video/mp4",
        processing_ms=elapsed_ms,
        frames_processed=frames,
        mode=req.mode,
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="info")
