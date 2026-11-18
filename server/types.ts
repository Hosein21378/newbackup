export type DbEngine = 'sqlite' | 'mysql' | 'mariadb' | 'postgres' | 'timescaledb' | 'unknown';

export type ServerStatus = 'online' | 'pending' | 'offline';

export type BackupTrigger = 'manual' | 'scheduled' | 'upload' | 'pre_restore' | 'sandbox_test';

export type JobAction = 'backup_now' | 'restore_archive' | 'update_agent';

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface SystemUpdateStatus {
  repo: string;
  isGitRepo: boolean;
  currentCommit: string | null;
  currentMessage: string | null;
  currentDate: string | null;
  latestCommit: string | null;
  latestMessage: string | null;
  latestDate: string | null;
  updateAvailable: boolean;
  checkError: string | null;
  status: 'idle' | 'running' | 'success' | 'error';
  log: string;
  updatedAt: string | null;
}

export interface ExclusionPolicy {
  excludeLogsDir: boolean;
  excludeLogExtensions: boolean;
  excludeDbUsageLogs: boolean;
  excludeGeoAssets: boolean;
  customExcludePatterns: string[];
  includePaths: {
    envFile: boolean;
    dockerCompose: boolean;
    database: boolean;
    certs: boolean;
    templates: boolean;
    xrayConfig: boolean;
  };
  retentionCount: number;
  scheduleEnabled: boolean;
  scheduleCron: string;
}

export interface PasarGuardServer {
  id: string;
  name: string;
  host: string;
  token: string;
  status: ServerStatus;
  optPath: string;
  dataPath: string;
  dbEngine: DbEngine;
  panelVersion: string;
  osInfo: string;
  lastSeenAt: string | null;
  lastBackupAt: string | null;
  createdAt: string;
  notes: string;
}

export interface ArchiveEntry {
  path: string;
  size: number;
  type: string;
}

export interface BackupArchive {
  id: string;
  serverId: string;
  serverName: string;
  filename: string;
  trigger: BackupTrigger;
  dbEngine: DbEngine;
  sizeBytes: number;
  excludedLogBytes: number;
  excludedLogCount: number;
  sha256: string;
  components: string[];
  entriesCount: number;
  logFreeVerified: boolean;
  createdAt: string;
}

export interface BackupJob {
  id: string;
  serverId: string;
  serverName: string;
  action: JobAction;
  status: JobStatus;
  backupId?: string;
  backupFilename?: string;
  message: string;
  outputLog: string;
  createdAt: string;
  updatedAt: string;
}

export interface TelegramConfig {
  enabled: boolean;
  botToken: string;
  chatId: string;
}

export interface VaultState {
  servers: PasarGuardServer[];
  backups: BackupArchive[];
  jobs: BackupJob[];
  policy: ExclusionPolicy;
  telegram: TelegramConfig;
}
