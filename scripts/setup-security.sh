#!/usr/bin/env bash
# =============================================================================
# GlimpseAI Security Setup
# Run once after cloning: ./scripts/setup-security.sh
# Installs git hooks that block .env / secret commits and pushes.
# =============================================================================
set -e

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

echo "Installing GlimpseAI security hooks..."

git config core.hooksPath .githooks
chmod +x .githooks/pre-commit .githooks/pre-push

echo ""
echo "✓ Pre-commit hook: blocks .env files and known secret patterns"
echo "✓ Pre-push hook:   second pass scan before anything reaches GitHub"
echo "✓ GitHub Actions:  cloud-side scan on every push (TruffleHog)"
echo ""
echo "Hooks directory: .githooks/"
echo "To bypass in an emergency (NOT recommended): git commit --no-verify"
echo ""
echo "Setup complete."
