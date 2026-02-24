#!/usr/bin/env bash
# NanoClaw for Rabbit R1 — one-command installer
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/dsr-restyn/nanoclaw/main/install-r1.sh | bash
#
# Or clone first and run locally:
#   bash install-r1.sh
#
set -euo pipefail

REPO_URL="https://github.com/dsr-restyn/nanoclaw.git"
INSTALL_DIR="${NANOCLAW_DIR:-$HOME/nanoclaw}"

# ── Colors ────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info()  { echo -e "${CYAN}▸${NC} $*"; }
ok()    { echo -e "${GREEN}✓${NC} $*"; }
warn()  { echo -e "${YELLOW}⚠${NC} $*"; }
fail()  { echo -e "${RED}✗${NC} $*"; exit 1; }
ask()   { echo -en "${BOLD}$*${NC} "; }

# ── Pre-flight checks ────────────────────────────────────────────────

echo
echo -e "${BOLD}╔══════════════════════════════════════╗${NC}"
echo -e "${BOLD}║   NanoClaw — Rabbit R1 Installer     ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════╝${NC}"
echo

info "Checking prerequisites..."

# Node.js
if ! command -v node &>/dev/null; then
  fail "Node.js not found. Install it: https://nodejs.org (v20+ recommended)"
fi
NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VER" -lt 20 ]; then
  warn "Node.js v${NODE_VER} detected. v20+ recommended."
else
  ok "Node.js $(node -v)"
fi

# npm
if ! command -v npm &>/dev/null; then
  fail "npm not found. It should come with Node.js."
fi
ok "npm $(npm -v)"

# git
if ! command -v git &>/dev/null; then
  fail "git not found. Install it: https://git-scm.com"
fi
ok "git $(git --version | awk '{print $3}')"

# Docker (optional, for container runner)
if command -v docker &>/dev/null; then
  ok "Docker $(docker --version | awk '{print $3}' | tr -d ',')"
else
  warn "Docker not found. Needed for running AI agents in containers."
  warn "Install: https://docs.docker.com/get-docker/"
fi

echo

# ── Clone or locate repo ─────────────────────────────────────────────

# Check if we're already inside the repo
if [ -f "package.json" ] && grep -q '"nanoclaw"' package.json 2>/dev/null; then
  INSTALL_DIR="$(pwd)"
  info "Already in NanoClaw directory: $INSTALL_DIR"
else
  if [ -d "$INSTALL_DIR/.git" ]; then
    info "Existing installation found at $INSTALL_DIR"
    ask "Update it? [Y/n]"
    read -r yn
    if [[ "$yn" =~ ^[Nn] ]]; then
      fail "Aborted."
    fi
    cd "$INSTALL_DIR"
    git pull --rebase || warn "Pull failed — continuing with existing code."
  else
    info "Installing to $INSTALL_DIR"
    ask "Continue? [Y/n]"
    read -r yn
    if [[ "$yn" =~ ^[Nn] ]]; then
      fail "Aborted. Set NANOCLAW_DIR to change install location."
    fi
    git clone "$REPO_URL" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
  fi
fi

cd "$INSTALL_DIR"

# ── Install dependencies ─────────────────────────────────────────────

info "Installing Node.js dependencies..."
npm install --silent 2>&1 | tail -1
ok "Dependencies installed."

# ── Build base ────────────────────────────────────────────────────────

info "Building base..."
npm run build > /dev/null 2>&1 || fail "Base build failed. Check for errors."
ok "Base build passed."

# ── Skills engine setup ──────────────────────────────────────────────

info "Initializing skills system..."
if [ -d ".nanoclaw/base" ]; then
  ok "Already initialized."
else
  npx tsx scripts/apply-skill.ts --init > /dev/null
  ok "Skills system initialized."
fi

# ── Apply HTTP channel ───────────────────────────────────────────────

info "Applying HTTP channel skill..."
if grep -q "http-channel" .nanoclaw/state.yaml 2>/dev/null; then
  ok "Already applied."
else
  OUTPUT=$(npx tsx scripts/apply-skill.ts .claude/skills/add-http-channel 2>&1)
  if echo "$OUTPUT" | grep -q '"success": true'; then
    ok "HTTP channel applied."
  else
    echo "$OUTPUT"
    fail "HTTP channel skill failed. See output above."
  fi
fi

# ── Apply R1 support ─────────────────────────────────────────────────

info "Applying Rabbit R1 skill..."
if grep -q "rabbit-r1" .nanoclaw/state.yaml 2>/dev/null; then
  ok "Already applied."
else
  OUTPUT=$(npx tsx scripts/apply-skill.ts .claude/skills/add-rabbit-r1 2>&1)
  if echo "$OUTPUT" | grep -q '"success": true'; then
    ok "R1 support applied."
  else
    echo "$OUTPUT"
    fail "R1 skill failed. See output above."
  fi
fi

# ── Final build ──────────────────────────────────────────────────────

info "Final build..."
npm run build > /dev/null 2>&1 || fail "Build failed after skill application."
ok "Build passed."

if [ -f "dist/static/creation/index.html" ]; then
  ok "Creation frontend bundled."
else
  warn "dist/static/creation/index.html missing — check build script."
fi

# ── Device token ─────────────────────────────────────────────────────

echo
ask "Create a device token for your R1? [Y/n]"
read -r yn
if [[ ! "$yn" =~ ^[Nn] ]]; then
  ask "Token label (default: r1-device):"
  read -r label
  label="${label:-r1-device}"
  echo
  npx tsx scripts/create-token.ts "$label"
  echo -e "${YELLOW}Save this token now — it cannot be shown again.${NC}"
fi

# ── Environment ──────────────────────────────────────────────────────

echo
if [ ! -f ".env" ]; then
  ask "Create .env file with R1 defaults? [Y/n]"
  read -r yn
  if [[ ! "$yn" =~ ^[Nn] ]]; then
    cat > .env <<'ENVEOF'
HTTP_CHANNEL_ENABLED=true
HTTP_PORT=4080
WHATSAPP_ENABLED=false
VOICE_ENABLED=true
ENVEOF
    ok "Created .env"
  fi
else
  info ".env already exists — verify it has:"
  echo "  HTTP_CHANNEL_ENABLED=true"
  echo "  HTTP_PORT=4080"
  echo "  WHATSAPP_ENABLED=false"
  echo "  VOICE_ENABLED=true"
fi

# ── Docker image ─────────────────────────────────────────────────────

echo
if command -v docker &>/dev/null; then
  ask "Build the agent container image? (needed to run AI agents) [Y/n]"
  read -r yn
  if [[ ! "$yn" =~ ^[Nn] ]]; then
    info "Building nanoclaw-agent:latest..."
    docker build -t nanoclaw-agent:latest -f container/Dockerfile container/ 2>&1 | tail -3
    ok "Agent image built."
  fi
fi

# ── Done ─────────────────────────────────────────────────────────────

echo
echo -e "${BOLD}╔══════════════════════════════════════╗${NC}"
echo -e "${BOLD}║          Setup Complete!              ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════╝${NC}"
echo
echo -e "  ${CYAN}Start:${NC}  cd $INSTALL_DIR && npm start"
echo -e "  ${CYAN}Health:${NC} curl http://localhost:4080/health"
echo
echo -e "  ${CYAN}Pair R1:${NC} Open in browser:"
echo -e "           http://localhost:4080/pair?token=YOUR_TOKEN"
echo
echo -e "  ${YELLOW}Note:${NC} R1 requires HTTPS. For quick tunneling:"
echo -e "        cloudflared tunnel --url http://localhost:4080"
echo
echo -e "  ${CYAN}More tokens:${NC} npx tsx scripts/create-token.ts <label>"
echo
