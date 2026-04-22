#!/bin/bash
set -e

# Ensure security hooks are always active after a pull/merge
echo "[post-merge] Activating security hooks from .githooks/..."
git config core.hooksPath .githooks
chmod +x .githooks/pre-commit .githooks/pre-push 2>/dev/null || true
echo "[post-merge] Security hooks active. ✓"

pnpm install --frozen-lockfile
pnpm --filter db push
