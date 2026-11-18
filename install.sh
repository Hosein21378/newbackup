#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# PasarGuard Vault - GitHub One-Line Panel & Log-Free Backuper Installer
# Repository: https://github.com/Hosein21378/newbackup
# Usage:
#   bash -c "$(curl -sL https://raw.githubusercontent.com/Hosein21378/newbackup/main/install.sh)"
# ==============================================================================

if [[ "${EUID:-0}" -ne 0 ]]; then
  echo "[ERROR] لطفاً دستور نصب را با دسترسی root یا sudo اجرا کنید."
  exit 1
fi

DEFAULT_REPO="https://github.com/Hosein21378/newbackup.git"
REPO_URL="${PG_VAULT_REPO:-$DEFAULT_REPO}"
INSTALL_DIR="/opt/pasarguard-vault"
PORT="${PG_VAULT_PORT:-3000}"

echo "=================================================================="
echo "  PasarGuard Vault - نصب پنل مدیریت بکاپ و بازیابی بدون لاگ"
echo "=================================================================="

# 1. Install base dependencies
if command -v apt-get >/dev/null 2>&1; then
  DEBIAN_FRONTEND=noninteractive apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq curl git tar gzip sqlite3 jq ca-certificates gnupg >/dev/null
elif command -v dnf >/dev/null 2>&1; then
  dnf install -y -q curl git tar gzip sqlite jq >/dev/null
fi

# 2. Install Node.js 22 if missing
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | sed 's/v//' | cut -d. -f1)" -lt 20 ]]; then
  echo "[1/5] نصب Node.js 22..."
  if command -v apt-get >/dev/null 2>&1; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs >/dev/null
  else
    echo "[ERROR] لطفاً Node.js نسخه 20 یا بالاتر را نصب کنید."
    exit 1
  fi
fi

# 3. Clone or update repository
if [[ -f "./package.json" && -f "./server.ts" && -z "${PG_VAULT_REPO:-}" ]]; then
  echo "[2/5] استفاده از فایل‌های محلی پروژه در $INSTALL_DIR..."
  if [[ "$(pwd)" != "$INSTALL_DIR" ]]; then
    mkdir -p "$INSTALL_DIR"
    cp -a . "$INSTALL_DIR/"
  fi
else
  echo "[2/5] دریافت سورس پنل از گیت‌هاب ($REPO_URL)..."
  if [[ -d "$INSTALL_DIR/.git" ]]; then
    git -C "$INSTALL_DIR" pull --ff-only
  else
    rm -rf "$INSTALL_DIR"
    git clone "$REPO_URL" "$INSTALL_DIR"
  fi
fi

# 4. Install dependencies & build frontend
echo "[3/5] نصب وابستگی‌ها و بیلد پنل مدیریت..."
cd "$INSTALL_DIR"
npm install --no-audit --no-fund --silent
npm run build --silent

NODE_BIN="$(command -v node)"
TSX_BIN="$INSTALL_DIR/node_modules/.bin/tsx"

# 5. Configure systemd service for the Web Panel
echo "[4/5] راه‌اندازی سرویس systemd برای پنل وب (پورت $PORT)..."
cat > /etc/systemd/system/pasarguard-vault-panel.service <<EOF
[Unit]
Description=PasarGuard Vault Backup Management Panel
After=network-online.target docker.service

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
systemctl enable --now pasarguard-vault-panel.service

# 6. Wait for panel port to come online and auto-register this server
echo "[5/5] اتصال خودکار این سرور به پنل مدیریت..."
for _ in $(seq 1 20); do
  if curl -sf "http://127.0.0.1:${PORT}/api/state" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

curl -sSL "http://127.0.0.1:${PORT}/install.sh?name=$(hostname)" | bash || true

SERVER_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "YOUR_SERVER_IP")
echo ""
echo "=================================================================="
echo " نصب PasarGuard Vault با موفقیت انجام شد!"
echo " آدرس پنل مدیریت:  http://${SERVER_IP}:${PORT}"
echo " دستور بکاپ سریع:   pgbackup backup"
echo " دستور بازیابی:     pgbackup restore /var/backups/pasarguard/<file>.tar.gz"
echo "=================================================================="
