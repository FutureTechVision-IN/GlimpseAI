#!/bin/bash
set -e

REPO=$(find /Users/bipbabu/Library/CloudStorage -maxdepth 10 -path "*/GlimpseAI" -type d 2>/dev/null | head -1)
cd "$REPO" || exit 1

echo "🔑 API Key Validation & Organization System"
echo "==========================================="
echo ""
echo "Preparing environment..."

if ! command -v ts-node &> /dev/null; then
    echo "Installing ts-node..."
    npm install -g ts-node typescript
fi

echo ""
echo "Starting validation campaign..."
echo "Testing keys from: $(pwd)/.env"
echo ""

npx ts-node key-validator.ts

echo ""
echo "✅ Validation complete!"
echo "📝 Check .key-validation-logs/ for detailed reports"
echo ""
