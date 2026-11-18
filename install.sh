#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# PasarGuard Vault - GitHub One-Line Panel & Log-Free Backuper Installer
# Repository: https://github.com/Hosein21378/newbackup
# Usage:
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/Hosein21378/newbackup/main/install.sh)"
# ==============================================================================

if [[ "${EUID:-0}" -ne 0 ]]; then
  echo "[ERROR] Please run this installer as root (use sudo)."
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a
export GIT_TERMINAL_PROMPT=0

DEFAULT_REPO="https://github.com/Hosein21378/newbackup.git"
REPO_URL="${PG_VAULT_REPO:-$DEFAULT_REPO}"
INSTALL_DIR="/opt/pasarguard-vault"
PORT="${PG_VAULT_PORT:-3000}"

echo "=================================================================="
echo "  PasarGuard Vault - Log-Free Backup Panel Installer"
echo "=================================================================="

# 1. Install base dependencies
echo "[1/6] Installing required system packages (curl, git, tar, sqlite3, jq)..."
if command -v apt-get >/dev/null 2>&1; then
  apt-get update -qq
  apt-get install -y -qq -o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold" \
    curl git tar gzip sqlite3 jq ca-certificates gnupg
elif command -v dnf >/dev/null 2>&1; then
  dnf install -y -q curl git tar gzip sqlite jq
elif command -v yum >/dev/null 2>&1; then
  yum install -y -q curl git tar gzip sqlite jq
fi

# 2. Install Node.js 22 if missing or < v20
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | sed 's/^v//' | cut -d. -f1)" -lt 20 ]]; then
  echo "[2/6] Installing Node.js 22..."
  if command -v apt-get >/dev/null 2>&1; then
    curl -fsSL --connect-timeout 15 --max-time 60 https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y -qq -o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold" nodejs
  else
    echo "[ERROR] Node.js 20+ is required. Please install Node.js 20 or newer and re-run."
    exit 1
  fi
else
  echo "[2/6] Node.js $(node -v) detected."
fi

# 3. Clone or update repository
if [[ -f "./package.json" && -f "./server.ts" && -z "${PG_VAULT_REPO:-}" ]]; then
  echo "[3/6] Copying local project files to $INSTALL_DIR..."
  if [[ "$(pwd)" != "$INSTALL_DIR" ]]; then
    mkdir -p "$INSTALL_DIR"
    cp -a . "$INSTALL_DIR/"
  fi
else
  echo "[3/6] Fetching source from $REPO_URL..."
  if [[ -d "$INSTALL_DIR/.git" ]]; then
    git -C "$INSTALL_DIR" fetch --all --prune
    git -C "$INSTALL_DIR" reset --hard origin/main
  else
    rm -rf "$INSTALL_DIR"
    git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
  fi
fi

# 4. Install dependencies & build frontend
echo "[4/6] Installing Node dependencies and building web panel (this may take 1-2 minutes)..."
cd "$INSTALL_DIR"
npm install --no-audit --no-fund --loglevel=error
npm run build

if [[ ! -f "$INSTALL_DIR/dist/index.html" ]]; then
  echo "[ERROR] Frontend build failed: dist/index.html was not created."
  exit 1
fi

NODE_BIN="$(command -v node)"
TSX_BIN="$INSTALL_DIR/node_modules/.bin/tsx"

if [[ ! -x "$TSX_BIN" ]]; then
  echo "[ERROR] tsx binary not found at $TSX_BIN"
  exit 1
fi

# 5. Configure systemd service for the Web Panel
echo "[5/6] Configuring systemd service (pasarguard-vault-panel) on port $PORT..."
cat > /etc/systemd/system/pasarguard-vault-panel.service <<EOF
[Unit]
Description=PasarGuard Vault Backup Management Panel
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$INSTALL_DIR
Environment=NODE_ENV=production
Environment=PORT=$PORT
ExecStart=$NODE_BIN $TSX_BIN $INSTALL_DIR/server.ts
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable pasarguard-vault-panel.service
systemctl restart pasarguard-vault-panel.service

# 6. Wait for panel port to come online and auto-register this server
echo -n "[6/6] Waiting for panel API on port $PORT"
PANEL_READY=0
for _ in $(seq 1 30); do
  if curl -fsS --connect-timeout 2 --max-time 3 "http://127.0.0.1:${PORT}/api/state" >/dev/null 2>&1; then
    PANEL_READY=1
    break
  fi
  echo -n "."
  sleep 1
done
echo ""

if [[ "$PANEL_READY" -ne 1 ]]; then
  echo "[ERROR] Panel failed to start on port $PORT within 30s. Service logs:"
  journalctl -u pasarguard-vault-panel.service -n 30 --no-pager || true
  exit 1
fi

echo "[6/6] Registering local server agent (pgbackup)..."
curl -fsSL --connect-timeout 5 --max-time 60 "http://127.0.0.1:${PORT}/install.sh?name=$(hostname)" | bash

SERVER_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "YOUR_SERVER_IP")
echo ""
echo "=================================================================="
echo " PasarGuard Vault installed successfully!"
echo " Panel URL:         http://${SERVER_IP}:${PORT}"
echo " Service status:    systemctl status pasarguard-vault-panel"
echo " Quick backup:      pgbackup backup"
echo " Quick restore:     pgbackup restore /var/backups/pasarguard/<file>.tar.gz"
echo "=================================================================="
