#!/usr/bin/env bash
# Setup NanoClaw for Rabbit R1 (HTTP channel + voice + Creation frontend)
# Usage: bash .claude/skills/setup-r1/scripts/setup-r1.sh
set -euo pipefail

echo "=== NanoClaw R1 Setup ==="
echo

# 1. Install dependencies
echo "[1/6] Installing dependencies..."
npm install --silent
echo "  Done."

# 2. Verify clean build before applying skills
echo "[2/6] Verifying base build..."
npm run build > /dev/null 2>&1 || { echo "  ERROR: Base build failed. Fix errors first."; exit 1; }
echo "  Done."

# 3. Initialize skills system
echo "[3/6] Initializing skills system..."
if [ -d ".nanoclaw/base" ]; then
  echo "  Already initialized, skipping."
else
  npx tsx scripts/apply-skill.ts --init
  echo "  Done."
fi

# 4. Apply http-channel
echo "[4/6] Applying http-channel skill..."
if grep -q "http-channel" .nanoclaw/state.yaml 2>/dev/null; then
  echo "  Already applied, skipping."
else
  npx tsx scripts/apply-skill.ts .claude/skills/add-http-channel
  echo "  Done."
fi

# 5. Apply rabbit-r1
echo "[5/6] Applying rabbit-r1 skill..."
if grep -q "rabbit-r1" .nanoclaw/state.yaml 2>/dev/null; then
  echo "  Already applied, skipping."
else
  npx tsx scripts/apply-skill.ts .claude/skills/add-rabbit-r1
  echo "  Done."
fi

# 6. Final build
echo "[6/6] Building..."
npm run build > /dev/null 2>&1 || { echo "  ERROR: Build failed after skill application."; exit 1; }
echo "  Done."

# Verify static files
if [ ! -f "dist/static/creation/index.html" ]; then
  echo "  WARNING: dist/static/creation/index.html missing. Check build script copies static/."
fi

echo
echo "=== Setup complete ==="
echo
echo "Create a device token:"
echo "  npx tsx scripts/create-token.ts r1-device"
echo
echo "Then add to .env:"
echo "  HTTP_CHANNEL_ENABLED=true"
echo "  HTTP_PORT=4080"
echo "  WHATSAPP_ENABLED=false"
echo "  VOICE_ENABLED=true"
echo
echo "Start: npm start"
