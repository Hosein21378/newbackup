import type { ExclusionPolicy, PasarGuardServer, TelegramConfig } from './types.ts';

function escapeBashSingle(value: string): string {
  return value.replace(/'/g, `'\"'\"'`);
}

const PGBACKUP_CLI_BODY = `#!/usr/bin/env bash
set -euo pipefail

CONFIG_FILE="/etc/pasarguard-vault/agent.env"
if [[ -f "$CONFIG_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$CONFIG_FILE"
fi

PG_OPT_DIR="\${PG_OPT_DIR:-/opt/pasarguard}"
PG_DATA_DIR="\${PG_DATA_DIR:-/var/lib/pasarguard}"
BACKUP_LOCAL_DIR="\${BACKUP_LOCAL_DIR:-/var/backups/pasarguard}"
EXCLUDE_LOGS_DIR="\${EXCLUDE_LOGS_DIR:-true}"
EXCLUDE_LOG_EXT="\${EXCLUDE_LOG_EXT:-true}"
EXCLUDE_DB_USAGE_LOGS="\${EXCLUDE_DB_USAGE_LOGS:-true}"
EXCLUDE_GEO_ASSETS="\${EXCLUDE_GEO_ASSETS:-false}"
RETENTION_COUNT="\${RETENTION_COUNT:-14}"

mkdir -p "$BACKUP_LOCAL_DIR"

detect_db_engine() {
  local env_file="$PG_OPT_DIR/.env"
  if [[ ! -f "$env_file" ]]; then
    echo "sqlite"
    return
  fi
  local db_url
  db_url=$(grep -E '^SQLALCHEMY_DATABASE_URL=' "$env_file" | head -n1 | cut -d'=' -f2- | tr -d '"' | tr -d "'" || true)
  if [[ "$db_url" == *"postgresql"* || "$db_url" == *"timescale"* ]]; then
    echo "postgres"
  elif [[ "$db_url" == *"mysql"* || "$db_url" == *"mariadb"* ]]; then
    echo "mysql"
  else
    echo "sqlite"
  fi
}

measure_excluded_logs() {
  local bytes=0
  local count=0
  if [[ -d "$PG_DATA_DIR/logs" ]]; then
    while IFS= read -r -d '' f; do
      local sz
      sz=$(stat -c%s "$f" 2>/dev/null || echo 0)
      bytes=$((bytes + sz))
      count=$((count + 1))
    done < <(find "$PG_DATA_DIR/logs" -type f -print0 2>/dev/null || true)
  fi
  while IFS= read -r -d '' f; do
    local sz
    sz=$(stat -c%s "$f" 2>/dev/null || echo 0)
    bytes=$((bytes + sz))
    count=$((count + 1))
  done < <(find "$PG_DATA_DIR" -maxdepth 3 -type f \\( -name "*.log" -o -name "*.log.*" \\) -print0 2>/dev/null || true)
  echo "\${bytes}:\${count}"
}

send_telegram_backup() {
  local archive_path="$1"
  local caption="$2"
  if [[ "\${TELEGRAM_ENABLED:-false}" == "true" && -n "\${TELEGRAM_BOT_TOKEN:-}" && -n "\${TELEGRAM_CHAT_ID:-}" ]]; then
    curl -sS -F "chat_id=\${TELEGRAM_CHAT_ID}" \\
      -F "document=@\${archive_path}" \\
      -F "caption=\${caption}" \\
      "https://api.telegram.org/bot\${TELEGRAM_BOT_TOKEN}/sendDocument" >/dev/null || true
  fi
}

create_backup() {
  local trigger="\${1:-manual}"
  local stamp
  stamp=$(date -u +"%Y%m%d-%H%M%S")
  local db_engine
  db_engine=$(detect_db_engine)
  local stage
  stage=$(mktemp -d /tmp/pgbackup-stage.XXXXXX)
  trap 'rm -rf "$stage"' RETURN

  mkdir -p "$stage/opt/pasarguard" "$stage/var/lib/pasarguard" "$stage/db"

  # 1. Copy critical PasarGuard configuration files
  [[ -f "$PG_OPT_DIR/.env" ]] && cp -a "$PG_OPT_DIR/.env" "$stage/opt/pasarguard/.env"
  [[ -f "$PG_OPT_DIR/docker-compose.yml" ]] && cp -a "$PG_OPT_DIR/docker-compose.yml" "$stage/opt/pasarguard/docker-compose.yml"
  [[ -f "$PG_OPT_DIR/docker-compose.override.yml" ]] && cp -a "$PG_OPT_DIR/docker-compose.override.yml" "$stage/opt/pasarguard/docker-compose.override.yml"

  # 2. Safe Database Backup (No dirty live file copies)
  if [[ "$db_engine" == "sqlite" ]]; then
    local sqlite_file=""
    for candidate in "$PG_DATA_DIR/db.sqlite3" "$PG_DATA_DIR/pasarguard.db" "$PG_DATA_DIR/db.db"; do
      if [[ -f "$candidate" ]]; then
        sqlite_file="$candidate"
        break
      fi
    done
    if [[ -n "$sqlite_file" ]]; then
      if command -v sqlite3 >/dev/null 2>&1; then
        sqlite3 "$sqlite_file" ".backup '$stage/db/db.sqlite3'"
      else
        cp -a "$sqlite_file" "$stage/db/db.sqlite3"
      fi
    fi
  elif [[ "$db_engine" == "mysql" ]]; then
    local db_url
    db_url=$(grep -E '^SQLALCHEMY_DATABASE_URL=' "$PG_OPT_DIR/.env" | head -n1 | cut -d'=' -f2- | tr -d '"' | tr -d "'" || true)
    local db_name
    db_name=$(basename "\${db_url%%\\?*}")
    local ignore_flags=""
    if [[ "$EXCLUDE_DB_USAGE_LOGS" == "true" ]]; then
      ignore_flags="--ignore-table=\${db_name}.node_traffic_logs --ignore-table=\${db_name}.user_usage_logs --ignore-table=\${db_name}.system_logs"
    fi
    if [[ -f "$PG_OPT_DIR/docker-compose.yml" ]] && docker compose -f "$PG_OPT_DIR/docker-compose.yml" ps --services 2>/dev/null | grep -qiE 'mysql|mariadb'; then
      local svc
      svc=$(docker compose -f "$PG_OPT_DIR/docker-compose.yml" ps --services | grep -iE 'mysql|mariadb' | head -n1)
      # shellcheck disable=SC2086
      docker compose -f "$PG_OPT_DIR/docker-compose.yml" exec -T "$svc" sh -c "mysqldump --single-transaction --routines --triggers -u root -p\\"\\\$MYSQL_ROOT_PASSWORD\\" $ignore_flags \\"$db_name\\"" > "$stage/db/mysql_dump.sql"
    fi
  elif [[ "$db_engine" == "postgres" ]]; then
    local db_url
    db_url=$(grep -E '^SQLALCHEMY_DATABASE_URL=' "$PG_OPT_DIR/.env" | head -n1 | cut -d'=' -f2- | tr -d '"' | tr -d "'" || true)
    local db_name
    db_name=$(basename "\${db_url%%\\?*}")
    local exclude_flags=""
    if [[ "$EXCLUDE_DB_USAGE_LOGS" == "true" ]]; then
      exclude_flags="--exclude-table-data=*_logs --exclude-table-data=*_usage_logs"
    fi
    if [[ -f "$PG_OPT_DIR/docker-compose.yml" ]] && docker compose -f "$PG_OPT_DIR/docker-compose.yml" ps --services 2>/dev/null | grep -qiE 'postgres|timescale'; then
      local svc
      svc=$(docker compose -f "$PG_OPT_DIR/docker-compose.yml" ps --services | grep -iE 'postgres|timescale' | head -n1)
      # shellcheck disable=SC2086
      docker compose -f "$PG_OPT_DIR/docker-compose.yml" exec -T "$svc" pg_dump -U postgres $exclude_flags "$db_name" > "$stage/db/postgres_dump.sql"
    fi
  fi

  # 3. Copy critical persistent assets while strictly excluding all logs
  local tar_excludes=(--exclude="logs" --exclude="logs/*" --exclude="*.log" --exclude="*.log.*" --exclude="access.log*" --exclude="error.log*" --exclude="__pycache__" --exclude="*.tmp" --exclude="db.sqlite3-wal" --exclude="db.sqlite3-shm")
  if [[ "$EXCLUDE_GEO_ASSETS" == "true" ]]; then
    tar_excludes+=(--exclude="assets/*.dat")
  fi

  if [[ -d "$PG_DATA_DIR" ]]; then
    tar -C "$PG_DATA_DIR" "\${tar_excludes[@]}" -cf - . | tar -C "$stage/var/lib/pasarguard" -xf -
    rm -f "$stage/var/lib/pasarguard/db.sqlite3" "$stage/var/lib/pasarguard/db.sqlite3-wal" "$stage/var/lib/pasarguard/db.sqlite3-shm"
  fi

  local log_stats
  log_stats=$(measure_excluded_logs)
  local excluded_bytes="\${log_stats%%:*}"
  local excluded_count="\${log_stats##*:}"

  cat > "$stage/manifest.json" <<MANIFEST_EOF
{
  "tool": "PasarGuard Vault",
  "trigger": "$trigger",
  "dbEngine": "$db_engine",
  "excludedLogBytes": $excluded_bytes,
  "excludedLogCount": $excluded_count,
  "createdAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
MANIFEST_EOF

  local out_file="$BACKUP_LOCAL_DIR/pg-\${trigger}-\${stamp}.tar.gz"
  tar -C "$stage" -czf "$out_file" .

  ls -1t "$BACKUP_LOCAL_DIR"/pg-*.tar.gz 2>/dev/null | tail -n +"$((RETENTION_COUNT + 1))" | xargs -r rm -f || true

  if [[ -n "\${PANEL_URL:-}" && -n "\${AGENT_TOKEN:-}" ]]; then
    curl -sS -X POST "$PANEL_URL/api/agent/upload" \\
      -H "Authorization: Bearer $AGENT_TOKEN" \\
      -F "archive=@$out_file" \\
      -F "trigger=$trigger" \\
      -F "dbEngine=$db_engine" \\
      -F "excludedLogBytes=$excluded_bytes" \\
      -F "excludedLogCount=$excluded_count" >/dev/null || true
  fi

  send_telegram_backup "$out_file" "PasarGuard Backup ($trigger) | DB: $db_engine | Logs skipped: $excluded_count files"
  echo "$out_file"
}

restore_backup() {
  local archive_file="$1"
  if [[ ! -f "$archive_file" ]]; then
    echo "[ERROR] فایل بکاپ یافت نشد: $archive_file" >&2
    exit 1
  fi

  echo "[Restore] ایجاد بکاپ ایمن پیش از بازیابی (Pre-Restore Safety Snapshot)..."
  create_backup "pre_restore" >/dev/null || true

  local tmp_restore
  tmp_restore=$(mktemp -d /tmp/pgrestore-stage.XXXXXX)
  trap 'rm -rf "$tmp_restore"' RETURN
  tar -C "$tmp_restore" -xzf "$archive_file"

  echo "[Restore] توقف موقت کانتینرهای PasarGuard..."
  if [[ -f "$PG_OPT_DIR/docker-compose.yml" ]]; then
    docker compose -f "$PG_OPT_DIR/docker-compose.yml" down || true
  fi

  mkdir -p "$PG_OPT_DIR" "$PG_DATA_DIR"
  if [[ -d "$tmp_restore/opt/pasarguard" ]]; then
    cp -a "$tmp_restore/opt/pasarguard/." "$PG_OPT_DIR/"
  fi
  if [[ -d "$tmp_restore/var/lib/pasarguard" ]]; then
    cp -a "$tmp_restore/var/lib/pasarguard/." "$PG_DATA_DIR/"
  fi

  if [[ -f "$tmp_restore/db/db.sqlite3" ]]; then
    rm -f "$PG_DATA_DIR/db.sqlite3-wal" "$PG_DATA_DIR/db.sqlite3-shm"
    cp -a "$tmp_restore/db/db.sqlite3" "$PG_DATA_DIR/db.sqlite3"
  fi

  if [[ -f "$PG_OPT_DIR/docker-compose.yml" ]]; then
    docker compose -f "$PG_OPT_DIR/docker-compose.yml" up -d
  fi

  if [[ -f "$tmp_restore/db/mysql_dump.sql" ]]; then
    sleep 6
    local svc
    svc=$(docker compose -f "$PG_OPT_DIR/docker-compose.yml" ps --services | grep -iE 'mysql|mariadb' | head -n1 || true)
    if [[ -n "$svc" ]]; then
      local db_url db_name
      db_url=$(grep -E '^SQLALCHEMY_DATABASE_URL=' "$PG_OPT_DIR/.env" | head -n1 | cut -d'=' -f2- | tr -d '"' | tr -d "'" || true)
      db_name=$(basename "\${db_url%%\\?*}")
      docker compose -f "$PG_OPT_DIR/docker-compose.yml" exec -T "$svc" sh -c "mysql -u root -p\\"\\\$MYSQL_ROOT_PASSWORD\\" \\"$db_name\\"" < "$tmp_restore/db/mysql_dump.sql"
    fi
  elif [[ -f "$tmp_restore/db/postgres_dump.sql" ]]; then
    sleep 6
    local svc
    svc=$(docker compose -f "$PG_OPT_DIR/docker-compose.yml" ps --services | grep -iE 'postgres|timescale' | head -n1 || true)
    if [[ -n "$svc" ]]; then
      local db_url db_name
      db_url=$(grep -E '^SQLALCHEMY_DATABASE_URL=' "$PG_OPT_DIR/.env" | head -n1 | cut -d'=' -f2- | tr -d '"' | tr -d "'" || true)
      db_name=$(basename "\${db_url%%\\?*}")
      docker compose -f "$PG_OPT_DIR/docker-compose.yml" exec -T "$svc" psql -U postgres -d "$db_name" < "$tmp_restore/db/postgres_dump.sql"
    fi
  fi

  echo "[Restore] بازیابی با موفقیت انجام شد و پنل PasarGuard راه‌اندازی مجدد شد."
}

case "\${1:-}" in
  backup)
    create_backup "\${2:-manual}"
    ;;
  restore)
    if [[ -z "\${2:-}" ]]; then
      echo "استفاده: pgbackup restore /path/to/archive.tar.gz"
      exit 1
    fi
    restore_backup "$2"
    ;;
  list)
    ls -lh "$BACKUP_LOCAL_DIR"/pg-*.tar.gz 2>/dev/null || echo "هیچ بکاپ محلی وجود ندارد."
    ;;
  poll)
    if [[ -z "\${PANEL_URL:-}" || -z "\${AGENT_TOKEN:-}" ]]; then
      exit 0
    fi
    local_db=$(detect_db_engine)
    host_ip=$(hostname -I 2>/dev/null | awk '{print $1}' || hostname)
    os_name=$(grep PRETTY_NAME /etc/os-release 2>/dev/null | cut -d= -f2 | tr -d '"' || uname -s)
    jobs_json=$(curl -sS -X POST "$PANEL_URL/api/agent/heartbeat" \\
      -H "Authorization: Bearer $AGENT_TOKEN" \\
      -H "Content-Type: application/json" \\
      -d "{\\"host\\":\\"$host_ip\\",\\"dbEngine\\":\\"$local_db\\",\\"osInfo\\":\\"$os_name\\"}" || echo '{"jobs":[]}')

    echo "$jobs_json" | jq -c '.jobs[]?' | while IFS= read -r job; do
      job_id=$(echo "$job" | jq -r '.id')
      action=$(echo "$job" | jq -r '.action')
      if [[ "$action" == "backup_now" ]]; then
        if out=$(create_backup "manual" 2>&1); then
          curl -sS -X POST "$PANEL_URL/api/agent/jobs/$job_id/complete" \\
            -H "Authorization: Bearer $AGENT_TOKEN" \\
            -H "Content-Type: application/json" \\
            -d "{\\"status\\":\\"completed\\",\\"outputLog\\":$(echo "$out" | jq -Rs .)}" >/dev/null || true
        else
          curl -sS -X POST "$PANEL_URL/api/agent/jobs/$job_id/complete" \\
            -H "Authorization: Bearer $AGENT_TOKEN" \\
            -H "Content-Type: application/json" \\
            -d "{\\"status\\":\\"failed\\",\\"outputLog\\":$(echo "$out" | jq -Rs .)}" >/dev/null || true
        fi
      elif [[ "$action" == "restore_archive" ]]; then
        bkp_id=$(echo "$job" | jq -r '.backupId')
        dl_file="/tmp/restore-$bkp_id.tar.gz"
        curl -sS -L -H "Authorization: Bearer $AGENT_TOKEN" "$PANEL_URL/api/agent/download/$bkp_id" -o "$dl_file"
        if out=$(restore_backup "$dl_file" 2>&1); then
          rm -f "$dl_file"
          curl -sS -X POST "$PANEL_URL/api/agent/jobs/$job_id/complete" \\
            -H "Authorization: Bearer $AGENT_TOKEN" \\
            -H "Content-Type: application/json" \\
            -d "{\\"status\\":\\"completed\\",\\"outputLog\\":$(echo "$out" | jq -Rs .)}" >/dev/null || true
        else
          rm -f "$dl_file"
          curl -sS -X POST "$PANEL_URL/api/agent/jobs/$job_id/complete" \\
            -H "Authorization: Bearer $AGENT_TOKEN" \\
            -H "Content-Type: application/json" \\
            -d "{\\"status\\":\\"failed\\",\\"outputLog\\":$(echo "$out" | jq -Rs .)}" >/dev/null || true
        fi
      fi
    done
    ;;
  *)
    echo "PasarGuard Vault CLI (pgbackup)"
    echo "  pgbackup backup              گرفتن بکاپ فوری بدون لاگ"
    echo "  pgbackup restore <file>      بازیابی بکاپ همراه با پیش‌نسخه ایمن"
    echo "  pgbackup list                نمایش بکاپ‌های محلی"
    ;;
esac
`;

export function generateConnectedInstallScript(params: {
  panelUrl: string;
  server: PasarGuardServer;
  policy: ExclusionPolicy;
  telegram: TelegramConfig;
}): string {
  const { panelUrl, server, policy, telegram } = params;
  const cleanPanelUrl = panelUrl.replace(/\/+$/, '');

  return `#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# PasarGuard Vault - One-Line Agent Installer & Log-Free Backuper
# Target Panel: https://github.com/PasarGuard/panel
# Server: ${server.name} (${server.id})
# ==============================================================================

if [[ \${EUID:-0} -ne 0 ]]; then
  echo "[ERROR] لطفاً اسکریپت را با دسترسی root یا sudo اجرا کنید."
  exit 1
fi

PANEL_URL='${escapeBashSingle(cleanPanelUrl)}'
AGENT_TOKEN='${escapeBashSingle(server.token)}'
SERVER_ID='${escapeBashSingle(server.id)}'
SERVER_NAME='${escapeBashSingle(server.name)}'
PG_OPT_DIR='${escapeBashSingle(server.optPath || '/opt/pasarguard')}'
PG_DATA_DIR='${escapeBashSingle(server.dataPath || '/var/lib/pasarguard')}'
BACKUP_LOCAL_DIR="/var/backups/pasarguard"
CONFIG_DIR="/etc/pasarguard-vault"
CONFIG_FILE="$CONFIG_DIR/agent.env"

echo "[1/5] بررسی و نصب پیش‌نیازها (curl, jq, tar, sqlite3)..."
if command -v apt-get >/dev/null 2>&1; then
  DEBIAN_FRONTEND=noninteractive apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq curl jq tar gzip sqlite3 >/dev/null
elif command -v dnf >/dev/null 2>&1; then
  dnf install -y -q curl jq tar gzip sqlite >/dev/null
elif command -v yum >/dev/null 2>&1; then
  yum install -y -q curl jq tar gzip sqlite >/dev/null
fi

mkdir -p "$CONFIG_DIR" "$BACKUP_LOCAL_DIR"

echo "[2/5] ذخیره پیکربندی ایجنت در $CONFIG_FILE..."
cat > "$CONFIG_FILE" <<EOF
PANEL_URL="$PANEL_URL"
AGENT_TOKEN="$AGENT_TOKEN"
SERVER_ID="$SERVER_ID"
SERVER_NAME="$SERVER_NAME"
PG_OPT_DIR="$PG_OPT_DIR"
PG_DATA_DIR="$PG_DATA_DIR"
BACKUP_LOCAL_DIR="$BACKUP_LOCAL_DIR"
EXCLUDE_LOGS_DIR="${policy.excludeLogsDir ? 'true' : 'false'}"
EXCLUDE_LOG_EXT="${policy.excludeLogExtensions ? 'true' : 'false'}"
EXCLUDE_DB_USAGE_LOGS="${policy.excludeDbUsageLogs ? 'true' : 'false'}"
EXCLUDE_GEO_ASSETS="${policy.excludeGeoAssets ? 'true' : 'false'}"
RETENTION_COUNT="${policy.retentionCount}"
TELEGRAM_ENABLED="${telegram.enabled ? 'true' : 'false'}"
TELEGRAM_BOT_TOKEN="${escapeBashSingle(telegram.botToken)}"
TELEGRAM_CHAT_ID="${escapeBashSingle(telegram.chatId)}"
EOF
chmod 600 "$CONFIG_FILE"

echo "[3/5] نصب ابزار بکاپ و بازیابی اختصاصی PasarGuard (/usr/local/bin/pgbackup)..."
cat > /usr/local/bin/pgbackup <<'PGBACKUP_EOF'
${PGBACKUP_CLI_BODY}
PGBACKUP_EOF
chmod +x /usr/local/bin/pgbackup

echo "[4/5] راه‌اندازی سرویس systemd برای ارتباط لحظه‌ای و بکاپ زمان‌بندی‌شده..."
cat > /etc/systemd/system/pasarguard-vault-poll.service <<'EOF'
[Unit]
Description=PasarGuard Vault Agent Poll Service
After=network-online.target docker.service

[Service]
Type=oneshot
ExecStart=/usr/local/bin/pgbackup poll
EOF

cat > /etc/systemd/system/pasarguard-vault-poll.timer <<'EOF'
[Unit]
Description=Poll PasarGuard Vault Panel Every 15 Seconds

[Timer]
OnBootSec=10s
OnUnitActiveSec=15s
AccuracySec=2s

[Install]
WantedBy=timers.target
EOF

cat > /etc/systemd/system/pasarguard-vault-backup.service <<'EOF'
[Unit]
Description=PasarGuard Vault Scheduled Log-Free Backup
After=docker.service

[Service]
Type=oneshot
ExecStart=/usr/local/bin/pgbackup backup scheduled
EOF

cat > /etc/systemd/system/pasarguard-vault-backup.timer <<'EOF'
[Unit]
Description=Daily Scheduled PasarGuard Backup

[Timer]
OnCalendar=*-*-* 03:00:00
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now pasarguard-vault-poll.timer
${policy.scheduleEnabled ? 'systemctl enable --now pasarguard-vault-backup.timer' : '# Scheduled timer disabled in panel policy'}

echo "[5/5] ثبت سرور در پنل مرکزی و دریافت تاییدیه..."
/usr/local/bin/pgbackup poll || true

echo ""
echo "=================================================================="
echo " نصب ایجنت بکاپر PasarGuard Vault با موفقیت انجام شد!"
echo " • دستور دستی گرفتن بکاپ:   pgbackup backup"
echo " • دستور دستی بازیابی:       pgbackup restore /path/to/file.tar.gz"
echo " • پوشه لاگ‌ها و *.log به‌طور خودکار از تمامی بکاپ‌ها حذف می‌شوند."
echo "=================================================================="
`;
}

export function generateStandaloneScript(params: {
  optPath: string;
  dataPath: string;
  policy: ExclusionPolicy;
  telegram: TelegramConfig;
}): string {
  const { optPath, dataPath, policy, telegram } = params;
  return `#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# PasarGuard Standalone Log-Free Backuper Installer
# Target: https://github.com/PasarGuard/panel
# Installs pgbackup CLI + automated systemd timer directly on your VPS
# ==============================================================================

if [[ \${EUID:-0} -ne 0 ]]; then
  echo "[ERROR] لطفاً اسکریپت را با دسترسی root یا sudo اجرا کنید."
  exit 1
fi

if command -v apt-get >/dev/null 2>&1; then
  DEBIAN_FRONTEND=noninteractive apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq curl tar gzip sqlite3 >/dev/null
elif command -v dnf >/dev/null 2>&1; then
  dnf install -y -q curl tar gzip sqlite >/dev/null
fi

mkdir -p /etc/pasarguard-vault /var/backups/pasarguard

cat > /etc/pasarguard-vault/agent.env <<EOF
PG_OPT_DIR="${escapeBashSingle(optPath || '/opt/pasarguard')}"
PG_DATA_DIR="${escapeBashSingle(dataPath || '/var/lib/pasarguard')}"
BACKUP_LOCAL_DIR="/var/backups/pasarguard"
EXCLUDE_LOGS_DIR="${policy.excludeLogsDir ? 'true' : 'false'}"
EXCLUDE_LOG_EXT="${policy.excludeLogExtensions ? 'true' : 'false'}"
EXCLUDE_DB_USAGE_LOGS="${policy.excludeDbUsageLogs ? 'true' : 'false'}"
EXCLUDE_GEO_ASSETS="${policy.excludeGeoAssets ? 'true' : 'false'}"
RETENTION_COUNT="${policy.retentionCount}"
TELEGRAM_ENABLED="${telegram.enabled ? 'true' : 'false'}"
TELEGRAM_BOT_TOKEN="${escapeBashSingle(telegram.botToken)}"
TELEGRAM_CHAT_ID="${escapeBashSingle(telegram.chatId)}"
EOF
chmod 600 /etc/pasarguard-vault/agent.env

cat > /usr/local/bin/pgbackup <<'PGBACKUP_EOF'
${PGBACKUP_CLI_BODY}
PGBACKUP_EOF
chmod +x /usr/local/bin/pgbackup

cat > /etc/systemd/system/pasarguard-vault-backup.service <<'EOF'
[Unit]
Description=PasarGuard Standalone Scheduled Log-Free Backup
After=docker.service

[Service]
Type=oneshot
ExecStart=/usr/local/bin/pgbackup backup scheduled
EOF

cat > /etc/systemd/system/pasarguard-vault-backup.timer <<'EOF'
[Unit]
Description=Daily Scheduled PasarGuard Backup

[Timer]
OnCalendar=*-*-* 03:00:00
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
${policy.scheduleEnabled ? 'systemctl enable --now pasarguard-vault-backup.timer' : '# Scheduled timer disabled'}

echo ""
echo "=================================================================="
echo " بکاپر مستقل PasarGuard با موفقیت نصب شد!"
echo " • گرفتن بکاپ بدون لاگ:     pgbackup backup"
echo " • لیست بکاپ‌ها:            pgbackup list"
echo " • بازیابی مستقیم بکاپ:     pgbackup restore /var/backups/pasarguard/<file>.tar.gz"
echo "=================================================================="
`;
}
