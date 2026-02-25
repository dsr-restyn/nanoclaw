#!/usr/bin/env bash
# NanoClaw for Rabbit R1 — uninstaller
#
# Usage:
#   bash uninstall-r1.sh
#
# Stops services, removes service files, and optionally deletes the install directory.
#
set -euo pipefail

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

# ── Locate install directory ──────────────────────────────────────────

if [ -f "package.json" ] && grep -q '"nanoclaw"' package.json 2>/dev/null; then
  INSTALL_DIR="$(pwd)"
else
  INSTALL_DIR="${NANOCLAW_DIR:-$HOME/nanoclaw}"
fi

echo
echo -e "${BOLD}╔══════════════════════════════════════╗${NC}"
echo -e "${BOLD}║   NanoClaw — R1 Uninstaller          ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════╝${NC}"
echo
echo -e "  Install directory: ${BOLD}${INSTALL_DIR}${NC}"
echo -e "  Platform:          ${BOLD}${OS}${NC}"
echo

ask "Proceed with uninstall? [y/N]"
read -r yn
if [[ ! "$yn" =~ ^[Yy] ]]; then
  echo "Aborted."
  exit 0
fi

echo

# ── Stop and remove services ─────────────────────────────────────────

info "Stopping services..."

case "$OS" in
  Linux)
    # Stop and disable systemd user services
    for svc in nanoclaw-tunnel nanoclaw; do
      if systemctl --user is-active "$svc" &>/dev/null; then
        systemctl --user stop "$svc"
        ok "Stopped $svc"
      fi
      if systemctl --user is-enabled "$svc" &>/dev/null; then
        systemctl --user disable "$svc" 2>/dev/null
        ok "Disabled $svc"
      fi
      SVC_FILE="$HOME/.config/systemd/user/${svc}.service"
      if [ -f "$SVC_FILE" ]; then
        rm "$SVC_FILE"
        ok "Removed $SVC_FILE"
      fi
    done
    systemctl --user daemon-reload
    ;;

  Darwin)
    # Unload and remove launchd plists
    for plist in com.nanoclaw.tunnel com.nanoclaw; do
      PLIST_FILE="$HOME/Library/LaunchAgents/${plist}.plist"
      if [ -f "$PLIST_FILE" ]; then
        launchctl unload "$PLIST_FILE" 2>/dev/null || true
        ok "Unloaded $plist"
        rm "$PLIST_FILE"
        ok "Removed $PLIST_FILE"
      fi
    done
    ;;

  *)
    warn "Unknown OS — skipping service removal. Kill any running processes manually."
    ;;
esac

# ── Kill any orphaned processes ──────────────────────────────────────

for proc in "node.*nanoclaw" "cloudflared tunnel.*4080"; do
  PIDS=$(pgrep -f "$proc" 2>/dev/null || true)
  if [ -n "$PIDS" ]; then
    echo "$PIDS" | xargs kill 2>/dev/null || true
    ok "Killed orphaned process: $proc"
  fi
done

# ── Remove cloudflared (if we installed it) ──────────────────────────

CF_LOCAL="$HOME/.local/bin/cloudflared"
if [ -f "$CF_LOCAL" ]; then
  echo
  ask "Remove cloudflared from ~/.local/bin? [y/N]"
  read -r yn
  if [[ "$yn" =~ ^[Yy] ]]; then
    rm "$CF_LOCAL"
    ok "Removed $CF_LOCAL"
  fi
fi

# ── Remove install directory ─────────────────────────────────────────

echo
if [ -d "$INSTALL_DIR" ]; then
  ask "Delete install directory ($INSTALL_DIR)? This removes all data, logs, and tokens. [y/N]"
  read -r yn
  if [[ "$yn" =~ ^[Yy] ]]; then
    rm -rf "$INSTALL_DIR"
    ok "Removed $INSTALL_DIR"
  else
    info "Kept $INSTALL_DIR — you can delete it manually later."
  fi
else
  info "Install directory not found at $INSTALL_DIR — nothing to delete."
fi

# ── Done ─────────────────────────────────────────────────────────────

echo
echo -e "${BOLD}Uninstall complete.${NC}"
echo
