#!/usr/bin/env python3
"""
qa-runner.py – Automated functional & quality validation for Claude Code CLI
"""

import json, csv, subprocess, time, hashlib, pathlib, sys
from pathlib import Path
from PIL import Image
from skimage.metrics import structural_similarity as ssim
from imagehash import phash
import numpy as np

# ------------------- Configuration -------------------
DATA_ROOT = Path("qa-data")
OUTPUT_ROOT = Path("qa-report/batch_out")
OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)

# Minimal matrix – add or extend entries as new filters appear
MATRIX = [
    {
        "name": "Colour Grade (standard)",
        "flag": "--filter colourgrade",
        "premium": False,
        "input_type": "image",
    },
    {
        "name": "Oil‑Paint (premium)",
        "flag": "--filter oilpaint",
        "premium": True,
        "input_type": "image",
    },
    {
        "name": "2× Upscale (premium)",
        "flag": "--upscale 2x",
        "premium": True,
        "input_type": "image",
    },
    {
        "name": "Video Stabilisation (premium)",
        "flag": "--stab",
        "premium": True,
        "input_type": "video",
    },
    {
        "name": "Batch processing (mixed)",
        "flag": "--batch-dir qa-data/images",
        "premium": False,
        "input_type": "folder",
    },
]

# Quality thresholds
SSIM_THRESHOLD = 0.98
PHASH_MAX_DIST = 4

# ------------------- Helper functions -------------------
def run_cli(args: list) -> subprocess.CompletedProcess:
    """Execute `claude` with supplied arguments and return the result."""
    return subprocess.run(["claude"] + args, capture_output=True, text=True)

def hash_md5(img: Image.Image) -> str:
    return hashlib.md5(img.tobytes()).hexdigest()

def compare_images(ref_path: Path, out_path: Path) -> bool:
    ref = Image.open(ref_path).convert("RGB")
    out = Image.open(out_path).convert("RGB")
    if hash_md5(ref) == hash_md5(out):
        return True
    s = ssim(np.array(ref), np.array(out), multichannel=True, data_range=255)
    ph = phash(ref) - phash(out)
    return s >= SSIM_THRESHOLD and ph <= PHASH_MAX_DIST

def log_result(csv_writer, test_name, src, out, status, mode, duration, notes):
    csv_writer.writerow({
        "Test": test_name,
        "Source": str(src),
        "Output": str(out),
        "Status": status,
        "FailureMode": mode,
        "DurationSec": f"{duration:.2f}",
        "Notes": notes,
    })

# ------------------- Main execution -------------------
def main():
    results_path = Path("qa-report/results.csv")
    with results_path.open("w", newline="") as csvfile:
        fieldnames = ["Test","Source","Output","Status","FailureMode","DurationSec","Notes"]
        writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
        writer.writeheader()
        for entry in MATRIX:
            if entry["input_type"] == "folder":
                inputs = list(Path("qa-data/images").glob("*"))
            elif entry["input_type"] == "video":
                inputs = list(Path("qa-data/videos").glob("*"))
            else:
                inputs = list(Path("qa-data/images").glob("*"))
            for src in inputs:
                start = time.time()
                args = ["apply", str(src)] + entry["flag"].split()
                if entry["premium"]:
                    args.append("--premium")
                proc = run_cli(args)
                duration = time.time() - start
                fail_mode = ""
                notes = ""
                if proc.returncode != 0:
                    status = "FAIL"
                    fail_mode = "FAIL-FUNC"
                    notes = proc.stderr.strip() or "CLI error"
                    out_path = ""
                else:
                    out_path = Path(proc.stdout.strip().splitlines()[-1])
                    if not out_path.is_file():
                        status = "FAIL"
                        fail_mode = "FAIL-FUNC"
                        notes = "Output not created"
                    else:
                        if entry["premium"] and "premium" not in out_path.name.lower():
                            status = "FAIL"
                            fail_mode = "FAIL-LABEL"
                            notes = "Premium flag missing"
                        else:
                            if src.suffix.lower() in {".png", ".jpg", ".jpeg", ".tif", ".tiff"}:
                                if compare_images(src, out_path):
                                    status = "PASS"
                                else:
                                    status = "FAIL"
                                    fail_mode = "FAIL-QUALITY"
                                    notes = "SSIM/Phash thresholds not met"
                            else:
                                status = "PASS"
                log_result(writer, entry["name"], src, out_path, status, fail_mode, duration, notes)
    print(f"✅ QA run complete – results written to {results_path}")

if __name__ == "__main__":
    main()
