import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as tar from 'tar';
import type {
  ArchiveEntry,
  BackupArchive,
  BackupJob,
  BackupTrigger,
  DbEngine,
  ExclusionPolicy,
  JobAction,
  JobStatus,
  PasarGuardServer,
  TelegramConfig,
  VaultState,
} from './types.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const ARCHIVES_DIR = path.join(DATA_DIR, 'archives');
const VAULT_FILE = path.join(DATA_DIR, 'vault.json');

export const DEFAULT_POLICY: ExclusionPolicy = {
  excludeLogsDir: true,
  excludeLogExtensions: true,
  excludeDbUsageLogs: true,
  excludeGeoAssets: false,
  customExcludePatterns: ['*.log', '*.log.*', 'logs/*', 'access.log*', 'error.log*', '__pycache__/*', '*.tmp'],
  includePaths: {
    envFile: true,
    dockerCompose: true,
    database: true,
    certs: true,
    templates: true,
    xrayConfig: true,
  },
  retentionCount: 14,
  scheduleEnabled: true,
  scheduleCron: '0 3 * * *',
};

const DEFAULT_STATE: VaultState = {
  servers: [],
  backups: [],
  jobs: [],
  policy: DEFAULT_POLICY,
  telegram: {
    enabled: false,
    botToken: '',
    chatId: '',
  },
};

function ensureDirs(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(ARCHIVES_DIR, { recursive: true });
}

export function loadVault(): VaultState {
  ensureDirs();
  if (!fs.existsSync(VAULT_FILE)) {
    fs.writeFileSync(VAULT_FILE, JSON.stringify(DEFAULT_STATE, null, 2), 'utf8');
    return structuredClone(DEFAULT_STATE);
  }
  try {
    const raw = fs.readFileSync(VAULT_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<VaultState>;
    return {
      servers: Array.isArray(parsed.servers) ? parsed.servers : [],
      backups: Array.isArray(parsed.backups) ? parsed.backups : [],
      jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [],
      policy: {
        ...DEFAULT_POLICY,
        ...(parsed.policy || {}),
        includePaths: {
          ...DEFAULT_POLICY.includePaths,
          ...(parsed.policy?.includePaths || {}),
        },
      },
      telegram: {
        ...DEFAULT_STATE.telegram,
        ...(parsed.telegram || {}),
      },
    };
  } catch {
    return structuredClone(DEFAULT_STATE);
  }
}

export function saveVault(state: VaultState): void {
  ensureDirs();
  fs.writeFileSync(VAULT_FILE, JSON.stringify(state, null, 2), 'utf8');
}

export function getArchiveFilePath(filename: string): string {
  ensureDirs();
  const safeName = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
  return path.join(ARCHIVES_DIR, safeName);
}

export function computeSha256(filePath: string): string {
  const hash = crypto.createHash('sha256');
  const buf = fs.readFileSync(filePath);
  hash.update(buf);
  return hash.digest('hex');
}

export function isLogPath(entryPath: string): boolean {
  const norm = entryPath.replace(/\\/g, '/').toLowerCase();
  return (
    /(^|\/)logs(\/|$)/.test(norm) ||
    norm.endsWith('.log') ||
    /\.log\.\d+(\.gz)?$/.test(norm) ||
    /(^|\/)(access|error)\.log/.test(norm) ||
    norm.endsWith('.out') ||
    norm.includes('__pycache__')
  );
}

export async function inspectTarGz(filePath: string): Promise<{
  entries: ArchiveEntry[];
  components: string[];
  logEntries: ArchiveEntry[];
  totalUncompressed: number;
}> {
  const entries: ArchiveEntry[] = [];
  await tar.t({
    file: filePath,
    onReadEntry: (entry) => {
      entries.push({
        path: entry.path,
        size: entry.size ?? 0,
        type: entry.type || 'File',
      });
    },
  });

  const logEntries = entries.filter((e) => e.type === 'File' && isLogPath(e.path));
  const components = new Set<string>();
  for (const e of entries) {
    const p = e.path.toLowerCase();
    if (p.includes('.env')) components.add('.env');
    if (p.includes('docker-compose')) components.add('docker-compose.yml');
    if (p.includes('.sqlite') || p.includes('.db') || p.includes('dump.sql') || p.includes('.dump')) {
      components.add('دیتابیس');
    }
    if (p.includes('certs/')) components.add('گواهی TLS');
    if (p.includes('templates/')) components.add('قالب اشتراک');
    if (p.includes('xray_config') || p.includes('xray.json')) components.add('پیکربندی Xray');
  }

  const totalUncompressed = entries.reduce((acc, item) => acc + item.size, 0);
  return {
    entries,
    components: Array.from(components),
    logEntries,
    totalUncompressed,
  };
}

export async function stripLogsFromTarGz(sourcePath: string, destPath: string): Promise<{
  strippedCount: number;
  strippedBytes: number;
}> {
  const tmpDir = fs.mkdtempSync(path.join(DATA_DIR, 'strip-'));
  let strippedCount = 0;
  let strippedBytes = 0;
  try {
    await tar.x({
      file: sourcePath,
      cwd: tmpDir,
      filter: (entryPath, stat) => {
        if (isLogPath(entryPath)) {
          strippedCount += 1;
          strippedBytes += stat?.size ?? 0;
          return false;
        }
        return true;
      },
    });
    const topItems = fs.readdirSync(tmpDir);
    if (topItems.length === 0) {
      fs.writeFileSync(path.join(tmpDir, 'manifest.json'), JSON.stringify({ note: 'cleaned-empty' }, null, 2));
    }
    await tar.c(
      {
        gzip: true,
        file: destPath,
        cwd: tmpDir,
      },
      fs.readdirSync(tmpDir)
    );
    return { strippedCount, strippedBytes };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

export async function createIsolatedSandboxArchive(
  server: PasarGuardServer,
  policy: ExclusionPolicy
): Promise<{
  archive: BackupArchive;
  excludedLogFiles: string[];
}> {
  ensureDirs();
  const stageDir = fs.mkdtempSync(path.join(DATA_DIR, 'sandbox-'));
  const excludedLogFiles: string[] = [];
  let excludedLogBytes = 0;

  try {
    const optDir = path.join(stageDir, 'opt', 'pasarguard');
    const varDir = path.join(stageDir, 'var', 'lib', 'pasarguard');
    const logsDir = path.join(varDir, 'logs');
    fs.mkdirSync(optDir, { recursive: true });
    fs.mkdirSync(path.join(varDir, 'certs', 'panel.example.com'), { recursive: true });
    fs.mkdirSync(path.join(varDir, 'templates', 'subscription'), { recursive: true });
    fs.mkdirSync(logsDir, { recursive: true });

    // Critical PasarGuard files
    if (policy.includePaths.envFile) {
      fs.writeFileSync(
        path.join(optDir, '.env'),
        [
          '# PasarGuard Panel Environment',
          'UVICORN_HOST=0.0.0.0',
          'UVICORN_PORT=8000',
          `SQLALCHEMY_DATABASE_URL="${
            server.dbEngine === 'postgres' || server.dbEngine === 'timescaledb'
              ? 'postgresql+psycopg2://pasarguard:secret@postgres:5432/pasarguard'
              : server.dbEngine === 'mysql' || server.dbEngine === 'mariadb'
                ? 'mysql+pymysql://pasarguard:secret@mysql:3306/pasarguard'
                : 'sqlite:////var/lib/pasarguard/db.sqlite3'
          }"`,
          'XRAY_JSON=/var/lib/pasarguard/xray_config.json',
          'SUDO_USERNAME=admin',
          'JWT_ACCESS_TOKEN_EXPIRE_MINUTES=1440',
        ].join('\n'),
        'utf8'
      );
    }

    if (policy.includePaths.dockerCompose) {
      fs.writeFileSync(
        path.join(optDir, 'docker-compose.yml'),
        [
          'services:',
          '  pasarguard:',
          '    image: pasarguard/panel:latest',
          '    restart: always',
          '    env_file: .env',
          '    network_mode: host',
          '    volumes:',
          '      - /var/lib/pasarguard:/var/lib/pasarguard',
        ].join('\n'),
        'utf8'
      );
    }

    if (policy.includePaths.database) {
      if (server.dbEngine === 'postgres' || server.dbEngine === 'timescaledb' || server.dbEngine === 'mysql' || server.dbEngine === 'mariadb') {
        fs.writeFileSync(
          path.join(varDir, 'database_dump.sql'),
          [
            `-- PasarGuard Safe Logical Dump (${server.dbEngine})`,
            `-- Log tables excluded: ${policy.excludeDbUsageLogs ? 'YES (node_traffic_logs, user_usage_logs skipped)' : 'NO'}`,
            'BEGIN;',
            '-- Admins, Users, Inbounds, Hosts, Nodes, Settings preserved',
            'COMMIT;',
          ].join('\n'),
          'utf8'
        );
      } else {
        fs.writeFileSync(
          path.join(varDir, 'db.sqlite3.checkpoint.sql'),
          [
            '-- SQLite WAL-Checkpointed Safe Export',
            'PRAGMA wal_checkpoint(TRUNCATE);',
            '-- Tables: admins, users, proxies, inbounds, hosts, nodes, core_configs',
          ].join('\n'),
          'utf8'
        );
      }
    }

    if (policy.includePaths.certs) {
      fs.writeFileSync(path.join(varDir, 'certs', 'panel.example.com', 'fullchain.pem'), '-----BEGIN CERTIFICATE-----\nPASARGUARD-CERT-BUNDLE\n-----END CERTIFICATE-----\n');
      fs.writeFileSync(path.join(varDir, 'certs', 'panel.example.com', 'privkey.pem'), '-----BEGIN PRIVATE KEY-----\nPASARGUARD-PRIVATE-KEY\n-----END PRIVATE KEY-----\n');
    }

    if (policy.includePaths.templates) {
      fs.writeFileSync(path.join(varDir, 'templates', 'subscription', 'index.html'), '<!doctype html><html><body>PasarGuard Subscription Template</body></html>\n');
    }

    if (policy.includePaths.xrayConfig) {
      fs.writeFileSync(
        path.join(varDir, 'xray_config.json'),
        JSON.stringify(
          {
            log: { loglevel: 'warning' },
            inbounds: [{ tag: 'VLESS-REALITY', port: 443, protocol: 'vless' }],
            outbounds: [{ protocol: 'freedom', tag: 'DIRECT' }],
          },
          null,
          2
        )
      );
    }

    // Create sample log files in stage to prove exclusion filter removes them before archiving
    const sampleLogs: Array<{ name: string; content: string }> = [
      { name: path.join(logsDir, 'access.log'), content: '2026/11/18 10:00:01 [Info] accepted tcp:1.1.1.1:443\n'.repeat(1800) },
      { name: path.join(logsDir, 'error.log'), content: '2026/11/18 10:00:02 [Warning] xray core idle timeout\n'.repeat(900) },
      { name: path.join(varDir, 'pasarguard-panel.log'), content: 'INFO uvicorn.access 127.0.0.1 GET /api/users 200\n'.repeat(650) },
    ];
    for (const item of sampleLogs) {
      fs.writeFileSync(item.name, item.content, 'utf8');
      const stat = fs.statSync(item.name);
      if (policy.excludeLogsDir || policy.excludeLogExtensions) {
        excludedLogFiles.push(path.relative(stageDir, item.name));
        excludedLogBytes += stat.size;
      }
    }

    fs.writeFileSync(
      path.join(stageDir, 'manifest.json'),
      JSON.stringify(
        {
          tool: 'PasarGuard Vault',
          serverId: server.id,
          serverName: server.name,
          dbEngine: server.dbEngine,
          excludedLogs: true,
          excludedLogBytes,
          excludedLogCount: excludedLogFiles.length,
          createdAt: new Date().toISOString(),
        },
        null,
        2
      )
    );

    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `pg-${server.name.replace(/[^a-zA-Z0-9_-]/g, '_')}-${stamp}.tar.gz`;
    const archivePath = getArchiveFilePath(filename);

    await tar.c(
      {
        gzip: true,
        file: archivePath,
        cwd: stageDir,
        filter: (entryPath) => {
          if ((policy.excludeLogsDir || policy.excludeLogExtensions) && isLogPath(entryPath)) {
            return false;
          }
          return true;
        },
      },
      fs.readdirSync(stageDir)
    );

    const stat = fs.statSync(archivePath);
    const inspection = await inspectTarGz(archivePath);
    const sha256 = computeSha256(archivePath);

    const archive: BackupArchive = {
      id: `bkp_${crypto.randomBytes(6).toString('hex')}`,
      serverId: server.id,
      serverName: server.name,
      filename,
      trigger: 'sandbox_test',
      dbEngine: server.dbEngine,
      sizeBytes: stat.size,
      excludedLogBytes,
      excludedLogCount: excludedLogFiles.length,
      sha256,
      components: inspection.components,
      entriesCount: inspection.entries.filter((e) => e.type === 'File').length,
      logFreeVerified: inspection.logEntries.length === 0,
      createdAt: new Date().toISOString(),
    };

    return { archive, excludedLogFiles };
  } finally {
    fs.rmSync(stageDir, { recursive: true, force: true });
  }
}

export function createServerRecord(input: {
  name: string;
  host?: string;
  optPath?: string;
  dataPath?: string;
  dbEngine?: DbEngine;
  notes?: string;
}): PasarGuardServer {
  const now = new Date().toISOString();
  return {
    id: `srv_${crypto.randomBytes(5).toString('hex')}`,
    name: input.name.trim(),
    host: (input.host || 'در انتظار اتصال ایجنت').trim(),
    token: `pgb_${crypto.randomBytes(18).toString('hex')}`,
    status: 'pending',
    optPath: (input.optPath || '/opt/pasarguard').trim(),
    dataPath: (input.dataPath || '/var/lib/pasarguard').trim(),
    dbEngine: input.dbEngine || 'sqlite',
    panelVersion: 'PasarGuard/panel',
    osInfo: 'Linux VPS',
    lastSeenAt: null,
    lastBackupAt: null,
    createdAt: now,
    notes: (input.notes || '').trim(),
  };
}

export function createJobRecord(input: {
  serverId: string;
  serverName: string;
  action: JobAction;
  backupId?: string;
  backupFilename?: string;
  message?: string;
  status?: JobStatus;
}): BackupJob {
  const now = new Date().toISOString();
  return {
    id: `job_${crypto.randomBytes(5).toString('hex')}`,
    serverId: input.serverId,
    serverName: input.serverName,
    action: input.action,
    status: input.status || 'pending',
    backupId: input.backupId,
    backupFilename: input.backupFilename,
    message:
      input.message ||
      (input.action === 'backup_now'
        ? 'در صف انتظار برای اجرا روی ایجنت سرور'
        : 'در صف انتظار برای بازیابی امن روی سرور'),
    outputLog: '',
    createdAt: now,
    updatedAt: now,
  };
}

export function updateTelegramConfig(state: VaultState, next: TelegramConfig): VaultState {
  state.telegram = {
    enabled: Boolean(next.enabled),
    botToken: (next.botToken || '').trim(),
    chatId: (next.chatId || '').trim(),
  };
  saveVault(state);
  return state;
}
