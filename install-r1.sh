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

# ── Platform detection ────────────────────────────────────────────────

OS="$(uname -s)"
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64)  CF_ARCH="amd64" ;;
  aarch64) CF_ARCH="arm64" ;;
  arm64)   CF_ARCH="arm64" ;;
  armv7l)  CF_ARCH="arm" ;;
  *)       CF_ARCH="" ;;
esac

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

# cloudflared (optional, for HTTPS tunneling)
HAS_CLOUDFLARED=false
if command -v cloudflared &>/dev/null; then
  ok "cloudflared $(cloudflared version 2>&1 | awk '{print $2}' | head -1)"
  HAS_CLOUDFLARED=true
else
  warn "cloudflared not found. Needed for HTTPS tunneling to R1."
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

# ── Cloudflared ──────────────────────────────────────────────────────

if [ "$HAS_CLOUDFLARED" = false ]; then
  echo
  ask "Install cloudflared for HTTPS tunneling? [Y/n]"
  read -r yn
  if [[ ! "$yn" =~ ^[Nn] ]]; then
    case "$OS" in
      Darwin)
        if command -v brew &>/dev/null; then
          info "Installing cloudflared via Homebrew..."
          brew install cloudflared 2>&1 | tail -3
          ok "cloudflared installed."
          HAS_CLOUDFLARED=true
        else
          warn "Homebrew not found. Install manually: brew install cloudflared"
        fi
        ;;
      Linux)
        if [ -n "$CF_ARCH" ]; then
          info "Downloading cloudflared for linux-${CF_ARCH}..."
          mkdir -p "$HOME/.local/bin"
          curl -fsSL -o /tmp/cloudflared "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${CF_ARCH}"
          install -m 755 /tmp/cloudflared "$HOME/.local/bin/cloudflared"
          rm -f /tmp/cloudflared
          export PATH="$HOME/.local/bin:$PATH"
          ok "cloudflared installed to ~/.local/bin"
          HAS_CLOUDFLARED=true
        else
          warn "Unsupported architecture: $ARCH. Install cloudflared manually."
        fi
        ;;
      *)
        warn "Unsupported OS. Install cloudflared manually: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
        ;;
    esac
  fi
fi

# ── Services ─────────────────────────────────────────────────────────

NODE_BIN="$(which node)"
mkdir -p "$INSTALL_DIR/logs"

echo
ask "Install as a system service (auto-start on boot)? [Y/n]"
read -r yn
if [[ ! "$yn" =~ ^[Nn] ]]; then
  HTTP_PORT="${HTTP_PORT:-4080}"

  case "$OS" in
    Linux)
      info "Creating systemd user services..."
      mkdir -p "$HOME/.config/systemd/user"

      cat > "$HOME/.config/systemd/user/nanoclaw.service" <<SVCEOF
[Unit]
Description=NanoClaw Personal Assistant
After=network.target

[Service]
Type=simple
ExecStart=${NODE_BIN} ${INSTALL_DIR}/dist/index.js
WorkingDirectory=${INSTALL_DIR}
Restart=always
RestartSec=5
Environment=HOME=${HOME}
Environment=PATH=/usr/local/bin:/usr/bin:/bin:${HOME}/.local/bin
StandardOutput=append:${INSTALL_DIR}/logs/nanoclaw.log
StandardError=append:${INSTALL_DIR}/logs/nanoclaw.error.log

[Install]
WantedBy=default.target
SVCEOF
      ok "Created nanoclaw.service"

      if [ "$HAS_CLOUDFLARED" = true ]; then
        CF_BIN="$(which cloudflared)"
        cat > "$HOME/.config/systemd/user/nanoclaw-tunnel.service" <<SVCEOF
[Unit]
Description=NanoClaw Cloudflare Tunnel
After=network.target

[Service]
Type=simple
ExecStart=${CF_BIN} tunnel --url http://localhost:${HTTP_PORT}
Restart=always
RestartSec=10
StandardOutput=append:${INSTALL_DIR}/logs/cloudflared.log
StandardError=append:${INSTALL_DIR}/logs/cloudflared.log

[Install]
WantedBy=default.target
SVCEOF
        ok "Created nanoclaw-tunnel.service"
      fi

      systemctl --user daemon-reload
      systemctl --user enable nanoclaw
      ok "Enabled nanoclaw.service"

      if [ "$HAS_CLOUDFLARED" = true ]; then
        systemctl --user enable nanoclaw-tunnel
        ok "Enabled nanoclaw-tunnel.service"
      fi

      # Enable linger so user services start at boot without an active login
      if command -v loginctl &>/dev/null; then
        loginctl enable-linger "$(whoami)" 2>/dev/null && \
          ok "Enabled linger (services run at boot without login)" || \
          warn "Could not enable linger. Services may only run when logged in."
      fi
      ;;

    Darwin)
      info "Creating launchd agents..."
      mkdir -p "$HOME/Library/LaunchAgents"

      cat > "$HOME/Library/LaunchAgents/com.nanoclaw.plist" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.nanoclaw</string>
    <key>ProgramArguments</key>
    <array>
        <string>${NODE_BIN}</string>
        <string>${INSTALL_DIR}/dist/index.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${INSTALL_DIR}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${INSTALL_DIR}/logs/nanoclaw.log</string>
    <key>StandardErrorPath</key>
    <string>${INSTALL_DIR}/logs/nanoclaw.error.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>HOME</key>
        <string>${HOME}</string>
        <key>PATH</key>
        <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
    </dict>
</dict>
</plist>
PLISTEOF
      ok "Created com.nanoclaw.plist"

      if [ "$HAS_CLOUDFLARED" = true ]; then
        CF_BIN="$(which cloudflared)"
        cat > "$HOME/Library/LaunchAgents/com.nanoclaw.tunnel.plist" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.nanoclaw.tunnel</string>
    <key>ProgramArguments</key>
    <array>
        <string>${CF_BIN}</string>
        <string>tunnel</string>
        <string>--url</string>
        <string>http://localhost:${HTTP_PORT}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${INSTALL_DIR}/logs/cloudflared.log</string>
    <key>StandardErrorPath</key>
    <string>${INSTALL_DIR}/logs/cloudflared.log</string>
</dict>
</plist>
PLISTEOF
        ok "Created com.nanoclaw.tunnel.plist"
      fi

      # Unload first in case they already exist from a previous install
      launchctl unload "$HOME/Library/LaunchAgents/com.nanoclaw.plist" 2>/dev/null || true
      launchctl load "$HOME/Library/LaunchAgents/com.nanoclaw.plist"
      ok "Loaded com.nanoclaw"

      if [ "$HAS_CLOUDFLARED" = true ]; then
        launchctl unload "$HOME/Library/LaunchAgents/com.nanoclaw.tunnel.plist" 2>/dev/null || true
        launchctl load "$HOME/Library/LaunchAgents/com.nanoclaw.tunnel.plist"
        ok "Loaded com.nanoclaw.tunnel"
      fi
      ;;

    *)
      warn "Unsupported OS for service installation. Start manually: cd $INSTALL_DIR && npm start"
      ;;
  esac
fi

# ── Done ─────────────────────────────────────────────────────────────

echo
echo -e "${BOLD}╔══════════════════════════════════════╗${NC}"
echo -e "${BOLD}║          Setup Complete!              ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════╝${NC}"
echo

case "$OS" in
  Linux)
    echo -e "  ${CYAN}Start:${NC}     systemctl --user start nanoclaw"
    echo -e "  ${CYAN}Stop:${NC}      systemctl --user stop nanoclaw"
    echo -e "  ${CYAN}Restart:${NC}   systemctl --user restart nanoclaw"
    echo -e "  ${CYAN}Logs:${NC}      tail -f $INSTALL_DIR/logs/nanoclaw.log"
    if [ "$HAS_CLOUDFLARED" = true ]; then
      echo
      echo -e "  ${CYAN}Tunnel:${NC}    systemctl --user start nanoclaw-tunnel"
      echo -e "  ${CYAN}Tunnel URL:${NC} grep trycloudflare $INSTALL_DIR/logs/cloudflared.log | tail -1"
    fi
    ;;
  Darwin)
    echo -e "  ${CYAN}Stop:${NC}      launchctl unload ~/Library/LaunchAgents/com.nanoclaw.plist"
    echo -e "  ${CYAN}Restart:${NC}   launchctl kickstart -k gui/\$(id -u)/com.nanoclaw"
    echo -e "  ${CYAN}Logs:${NC}      tail -f $INSTALL_DIR/logs/nanoclaw.log"
    if [ "$HAS_CLOUDFLARED" = true ]; then
      echo
      echo -e "  ${CYAN}Tunnel:${NC}    launchctl kickstart -k gui/\$(id -u)/com.nanoclaw.tunnel"
      echo -e "  ${CYAN}Tunnel URL:${NC} grep trycloudflare $INSTALL_DIR/logs/cloudflared.log | tail -1"
    fi
    ;;
  *)
    echo -e "  ${CYAN}Start:${NC}     cd $INSTALL_DIR && npm start"
    ;;
esac

echo
echo -e "  ${CYAN}Health:${NC}    curl http://localhost:4080/health"
echo
echo -e "  ${CYAN}Pair R1:${NC}   Open in browser:"
echo -e "             https://YOUR_TUNNEL_URL/pair?token=YOUR_TOKEN"
echo
echo -e "  ${CYAN}More tokens:${NC} npx tsx scripts/create-token.ts <label>"
echo

if [ "$HAS_CLOUDFLARED" = true ]; then
  echo -e "  ${YELLOW}Note:${NC} Quick tunnels get a new URL on each restart."
  echo -e "        Check the tunnel log for the current URL."
  echo
fi
