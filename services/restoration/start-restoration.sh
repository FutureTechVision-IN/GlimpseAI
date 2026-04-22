#!/usr/bin/env bash
# Start the GlimpseAI Restoration Service (GFPGAN + Real-ESRGAN)
# Usage: ./start-restoration.sh [port]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="$SCRIPT_DIR/.venv"
PORT="${1:-7860}"

if [ ! -d "$VENV_DIR" ]; then
  echo "Error: Virtual environment not found at $VENV_DIR"
  echo "Run: python3.11 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt"
  exit 1
fi

echo "Starting GlimpseAI Restoration Service on port $PORT..."
export RESTORATION_PORT="$PORT"
exec "$VENV_DIR/bin/python" "$SCRIPT_DIR/server.py"
