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
  db_url=$(grep -E '^(SQLALCHEMY_DATABASE_URL|DATABASE_URL)=' "$env_file" | head -n1 | cut -d'=' -f2- | tr -d '"' | tr -d "'" || true)
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
    curl -fsS --connect-timeout 10 --max-time 120 -F "chat_id=\${TELEGRAM_CHAT_ID}" \\
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
    db_url=$(grep -E '^(SQLALCHEMY_DATABASE_URL|DATABASE_URL)=' "$PG_OPT_DIR/.env" | head -n1 | cut -d'=' -f2- | tr -d '"' | tr -d "'" || true)
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
    db_url=$(grep -E '^(SQLALCHEMY_DATABASE_URL|DATABASE_URL)=' "$PG_OPT_DIR/.env" | head -n1 | cut -d'=' -f2- | tr -d '"' | tr -d "'" || true)
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
    curl -fsS --connect-timeout 10 --max-time 300 -X POST "$PANEL_URL/api/agent/upload" \\
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
    echo "[ERROR] Backup archive not found: $archive_file" >&2
    exit 1
  fi

  echo "[Restore] Creating pre-restore safety snapshot..."
  create_backup "pre_restore" >/dev/null || true

  local tmp_restore
  tmp_restore=$(mktemp -d /tmp/pgrestore-stage.XXXXXX)
  trap 'rm -rf "$tmp_restore"' RETURN
  tar -C "$tmp_restore" -xzf "$archive_file"

  echo "[Restore] Stopping PasarGuard containers..."
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
      db_url=$(grep -E '^(SQLALCHEMY_DATABASE_URL|DATABASE_URL)=' "$PG_OPT_DIR/.env" | head -n1 | cut -d'=' -f2- | tr -d '"' | tr -d "'" || true)
      db_name=$(basename "\${db_url%%\\?*}")
      docker compose -f "$PG_OPT_DIR/docker-compose.yml" exec -T "$svc" sh -c "mysql -u root -p\\"\\\$MYSQL_ROOT_PASSWORD\\" \\"$db_name\\"" < "$tmp_restore/db/mysql_dump.sql"
    fi
  elif [[ -f "$tmp_restore/db/postgres_dump.sql" ]]; then
    sleep 6
    local svc
    svc=$(docker compose -f "$PG_OPT_DIR/docker-compose.yml" ps --services | grep -iE 'postgres|timescale' | head -n1 || true)
    if [[ -n "$svc" ]]; then
      local db_url db_name
      db_url=$(grep -E '^(SQLALCHEMY_DATABASE_URL|DATABASE_URL)=' "$PG_OPT_DIR/.env" | head -n1 | cut -d'=' -f2- | tr -d '"' | tr -d "'" || true)
      db_name=$(basename "\${db_url%%\\?*}")
      docker compose -f "$PG_OPT_DIR/docker-compose.yml" exec -T "$svc" psql -U postgres -d "$db_name" < "$tmp_restore/db/postgres_dump.sql"
    fi
  fi

  echo "[Restore] Completed successfully. PasarGuard services restarted."
}

case "\${1:-}" in
  backup)
    create_backup "\${2:-manual}"
    ;;
  restore)
    if [[ -z "\${2:-}" ]]; then
      echo "Usage: pgbackup restore /path/to/archive.tar.gz"
      exit 1
    fi
    restore_backup "$2"
    ;;
  list)
    ls -lh "$BACKUP_LOCAL_DIR"/pg-*.tar.gz 2>/dev/null || echo "No local backups found in $BACKUP_LOCAL_DIR."
    ;;
  poll)
    if [[ -z "\${PANEL_URL:-}" || -z "\${AGENT_TOKEN:-}" ]]; then
      exit 0
    fi
    local_db=$(detect_db_engine)
    host_ip=$(hostname -I 2>/dev/null | awk '{print $1}' || hostname)
    os_name=$(grep PRETTY_NAME /etc/os-release 2>/dev/null | cut -d= -f2 | tr -d '"' || uname -s)
    payload=$(jq -n --arg host "$host_ip" --arg db "$local_db" --arg os "$os_name" '{host:$host,dbEngine:$db,osInfo:$os}')
    jobs_json=$(curl -fsS --connect-timeout 8 --max-time 20 -X POST "$PANEL_URL/api/agent/heartbeat" \\
      -H "Authorization: Bearer $AGENT_TOKEN" \\
      -H "Content-Type: application/json" \\
      -d "$payload" 2>/dev/null || echo '{"jobs":[]}')

    echo "$jobs_json" | jq -c '.jobs[]?' | while IFS= read -r job; do
      job_id=$(echo "$job" | jq -r '.id')
      action=$(echo "$job" | jq -r '.action')
      if [[ "$action" == "backup_now" ]]; then
        if out=$(create_backup "manual" 2>&1); then
          curl -fsS --connect-timeout 8 --max-time 30 -X POST "$PANEL_URL/api/agent/jobs/$job_id/complete" \\
            -H "Authorization: Bearer $AGENT_TOKEN" \\
            -H "Content-Type: application/json" \\
            -d "{\\"status\\":\\"completed\\",\\"outputLog\\":$(echo "$out" | jq -Rs .)}" >/dev/null || true
        else
          curl -fsS --connect-timeout 8 --max-time 30 -X POST "$PANEL_URL/api/agent/jobs/$job_id/complete" \\
            -H "Authorization: Bearer $AGENT_TOKEN" \\
            -H "Content-Type: application/json" \\
            -d "{\\"status\\":\\"failed\\",\\"outputLog\\":$(echo "$out" | jq -Rs .)}" >/dev/null || true
        fi
      elif [[ "$action" == "restore_archive" ]]; then
        bkp_id=$(echo "$job" | jq -r '.backupId')
        dl_file="/tmp/restore-$bkp_id.tar.gz"
        curl -fsS --connect-timeout 10 --max-time 300 -L -H "Authorization: Bearer $AGENT_TOKEN" "$PANEL_URL/api/agent/download/$bkp_id" -o "$dl_file"
        if out=$(restore_backup "$dl_file" 2>&1); then
          rm -f "$dl_file"
          curl -fsS --connect-timeout 8 --max-time 30 -X POST "$PANEL_URL/api/agent/jobs/$job_id/complete" \\
            -H "Authorization: Bearer $AGENT_TOKEN" \\
            -H "Content-Type: application/json" \\
            -d "{\\"status\\":\\"completed\\",\\"outputLog\\":$(echo "$out" | jq -Rs .)}" >/dev/null || true
        else
          rm -f "$dl_file"
          curl -fsS --connect-timeout 8 --max-time 30 -X POST "$PANEL_URL/api/agent/jobs/$job_id/complete" \\
            -H "Authorization: Bearer $AGENT_TOKEN" \\
            -H "Content-Type: application/json" \\
            -d "{\\"status\\":\\"failed\\",\\"outputLog\\":$(echo "$out" | jq -Rs .)}" >/dev/null || true
        fi
      elif [[ "$action" == "update_agent" ]]; then
        if out=$(curl -fsSL --connect-timeout 10 --max-time 60 "$PANEL_URL/install.sh?token=$AGENT_TOKEN" | bash 2>&1); then
          curl -fsS --connect-timeout 8 --max-time 30 -X POST "$PANEL_URL/api/agent/jobs/$job_id/complete" \\
            -H "Authorization: Bearer $AGENT_TOKEN" \\
            -H "Content-Type: application/json" \\
            -d "{\\"status\\":\\"completed\\",\\"outputLog\\":$(echo "$out" | jq -Rs .)}" >/dev/null || true
        else
          curl -fsS --connect-timeout 8 --max-time 30 -X POST "$PANEL_URL/api/agent/jobs/$job_id/complete" \\
            -H "Authorization: Bearer $AGENT_TOKEN" \\
            -H "Content-Type: application/json" \\
            -d "{\\"status\\":\\"failed\\",\\"outputLog\\":$(echo "$out" | jq -Rs .)}" >/dev/null || true
        fi
      fi
    done
    ;;
  update)
    if [[ -z "\${PANEL_URL:-}" || -z "\${AGENT_TOKEN:-}" ]]; then
      echo "[ERROR] Agent is not linked to a panel. Re-run the installer command."
      exit 1
    fi
    curl -fsSL --connect-timeout 10 --max-time 60 "$PANEL_URL/install.sh?token=$AGENT_TOKEN" | bash
    ;;
  *)
    echo "PasarGuard Vault CLI (pgbackup)"
    echo "  pgbackup backup              Create log-free backup immediately"
    echo "  pgbackup restore <file>      Restore archive with pre-restore safety snapshot"
    echo "  pgbackup list                List local backups"
    echo "  pgbackup update              Update pgbackup agent from connected panel"
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
  echo "[ERROR] Please run this script as root (use sudo)."
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a

PANEL_URL='${escapeBashSingle(cleanPanelUrl)}'
AGENT_TOKEN='${escapeBashSingle(server.token)}'
SERVER_ID='${escapeBashSingle(server.id)}'
SERVER_NAME='${escapeBashSingle(server.name)}'
PG_OPT_DIR='${escapeBashSingle(server.optPath || '/opt/pasarguard')}'
PG_DATA_DIR='${escapeBashSingle(server.dataPath || '/var/lib/pasarguard')}'
BACKUP_LOCAL_DIR="/var/backups/pasarguard"
CONFIG_DIR="/etc/pasarguard-vault"
CONFIG_FILE="$CONFIG_DIR/agent.env"

echo "[1/5] Checking dependencies (curl, jq, tar, sqlite3)..."
if command -v apt-get >/dev/null 2>&1; then
  apt-get update -qq
  apt-get install -y -qq -o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold" curl jq tar gzip sqlite3
elif command -v dnf >/dev/null 2>&1; then
  dnf install -y -q curl jq tar gzip sqlite
elif command -v yum >/dev/null 2>&1; then
  yum install -y -q curl jq tar gzip sqlite
fi

mkdir -p "$CONFIG_DIR" "$BACKUP_LOCAL_DIR"

echo "[2/5] Saving agent configuration to $CONFIG_FILE..."
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

echo "[3/5] Installing PasarGuard backup CLI (/usr/local/bin/pgbackup)..."
cat > /usr/local/bin/pgbackup <<'PGBACKUP_EOF'
${PGBACKUP_CLI_BODY}
PGBACKUP_EOF
chmod +x /usr/local/bin/pgbackup

echo "[4/5] Configuring systemd timers for polling and scheduled backups..."
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

echo "[5/5] Registering server with panel..."
/usr/local/bin/pgbackup poll || true

echo ""
echo "=================================================================="
echo " PasarGuard Vault Agent installed successfully!"
echo " • Manual backup:   pgbackup backup"
echo " • Manual restore:  pgbackup restore /path/to/archive.tar.gz"
echo " • List local:      pgbackup list"
echo " • Logs directory and *.log files are excluded automatically."
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
# ==============================================================================

if [[ \${EUID:-0} -ne 0 ]]; then
  echo "[ERROR] Please run this script as root (use sudo)."
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a

echo "[1/3] Installing required packages (curl, tar, gzip, sqlite3, jq)..."
if command -v apt-get >/dev/null 2>&1; then
  apt-get update -qq
  apt-get install -y -qq -o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold" curl tar gzip sqlite3 jq
elif command -v dnf >/dev/null 2>&1; then
  dnf install -y -q curl tar gzip sqlite jq
fi

mkdir -p /etc/pasarguard-vault /var/backups/pasarguard

echo "[2/3] Writing configuration to /etc/pasarguard-vault/agent.env..."
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

echo "[3/3] Installing pgbackup CLI and daily systemd timer..."
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
echo " PasarGuard Standalone Backuper installed successfully!"
echo " • Manual backup:   pgbackup backup"
echo " • List backups:    pgbackup list"
echo " • Restore backup:  pgbackup restore /var/backups/pasarguard/<file>.tar.gz"
echo "=================================================================="
`;
}
