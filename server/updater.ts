import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { SystemUpdateStatus } from './types.ts';

const execFileAsync = promisify(execFile);
const REPO = process.env.PG_VAULT_GITHUB_REPO || 'Hosein21378/newbackup';
const DATA_DIR = path.resolve(process.cwd(), 'data');
const UPDATE_STATUS_FILE = path.join(DATA_DIR, 'update-status.json');

interface PersistedUpdateState {
  status: 'idle' | 'running' | 'success' | 'error';
  log: string;
  updatedAt: string | null;
}

function readPersistedState(): PersistedUpdateState {
  try {
    if (fs.existsSync(UPDATE_STATUS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(UPDATE_STATUS_FILE, 'utf8')) as Partial<PersistedUpdateState>;
      return {
        status: parsed.status || 'idle',
        log: parsed.log || '',
        updatedAt: parsed.updatedAt || null,
      };
    }
  } catch {
    // ignore corrupt state
  }
  return { status: 'idle', log: '', updatedAt: null };
}

function writePersistedState(state: PersistedUpdateState): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(UPDATE_STATUS_FILE, JSON.stringify(state, null, 2), 'utf8');
}

async function runGit(args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd: process.cwd(),
      timeout: 10_000,
    });
    return stdout.trim();
  } catch {
    return null;
  }
}

export async function getSystemUpdateStatus(): Promise<SystemUpdateStatus> {
  const rootDir = process.cwd();
  const isGitRepo = fs.existsSync(path.join(rootDir, '.git'));
  const persisted = readPersistedState();

  let currentCommit: string | null = null;
  let currentMessage: string | null = null;
  let currentDate: string | null = null;

  if (isGitRepo) {
    currentCommit = await runGit(['rev-parse', '--short', 'HEAD']);
    currentMessage = await runGit(['log', '-1', '--format=%s']);
    currentDate = await runGit(['log', '-1', '--format=%cI']);
  }

  let latestCommit: string | null = null;
  let latestMessage: string | null = null;
  let latestDate: string | null = null;
  let checkError: string | null = null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(`https://api.github.com/repos/${REPO}/commits/main`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'PasarGuard-Vault-Updater',
      },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      checkError = `GitHub API HTTP ${res.status}`;
    } else {
      const json = (await res.json()) as {
        sha?: string;
        commit?: { message?: string; committer?: { date?: string } };
      };
      if (json.sha) {
        latestCommit = json.sha.slice(0, 7);
        latestMessage = json.commit?.message?.split('\n')[0] || '';
        latestDate = json.commit?.committer?.date || null;
      }
    }
  } catch (err) {
    checkError = err instanceof Error ? err.message : 'خطا در ارتباط با گیت‌هاب';
  }

  const updateAvailable = Boolean(
    isGitRepo && currentCommit && latestCommit && !latestCommit.startsWith(currentCommit) && !currentCommit.startsWith(latestCommit)
  );

  return {
    repo: REPO,
    isGitRepo,
    currentCommit,
    currentMessage,
    currentDate,
    latestCommit,
    latestMessage,
    latestDate,
    updateAvailable,
    checkError,
    status: persisted.status,
    log: persisted.log,
    updatedAt: persisted.updatedAt,
  };
}

function appendLog(line: string): void {
  const prev = readPersistedState();
  const nextLog = prev.log ? `${prev.log}\n${line}` : line;
  writePersistedState({
    ...prev,
    log: nextLog,
    updatedAt: new Date().toISOString(),
  });
}

function runShellStep(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        DEBIAN_FRONTEND: 'noninteractive',
      },
    });

    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8').trim();
      if (text) appendLog(text);
    });

    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8').trim();
      if (text) appendLog(text);
    });

    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

export function triggerSelfUpdate(): { started: boolean; error?: string } {
  const rootDir = process.cwd();
  if (!fs.existsSync(path.join(rootDir, '.git'))) {
    return {
      started: false,
      error: 'این محیط به‌صورت مخزن Git نصب نشده است. روی سرور واقعی لینوکس پس از نصب با install.sh، بروزرسانی خودکار فعال است.',
    };
  }

  const current = readPersistedState();
  if (current.status === 'running') {
    return { started: true };
  }

  writePersistedState({
    status: 'running',
    log: `[${new Date().toISOString()}] Starting PasarGuard Vault update from ${REPO}...`,
    updatedAt: new Date().toISOString(),
  });

  void (async () => {
    try {
      appendLog('[1/4] Fetching latest commits from origin/main...');
      await runShellStep('git', ['fetch', '--all', '--prune']);

      appendLog('[2/4] Updating source code to origin/main...');
      await runShellStep('git', ['reset', '--hard', 'origin/main']);

      appendLog('[3/4] Installing dependencies...');
      await runShellStep('npm', ['install', '--legacy-peer-deps', '--no-audit', '--no-fund', '--loglevel=error']);

      appendLog('[4/4] Building production bundle...');
      await runShellStep('npm', ['run', 'build']);

      writePersistedState({
        status: 'success',
        log: `${readPersistedState().log}\n[${new Date().toISOString()}] Update built successfully! Restarting panel service...`,
        updatedAt: new Date().toISOString(),
      });

      // Restart systemd service if running under systemd on Linux VPS
      if (fs.existsSync('/etc/systemd/system/pasarguard-vault-panel.service')) {
        setTimeout(() => {
          spawn('systemctl', ['restart', 'pasarguard-vault-panel.service'], {
            detached: true,
            stdio: 'ignore',
          }).unref();
        }, 600);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown update error';
      writePersistedState({
        status: 'error',
        log: `${readPersistedState().log}\n[ERROR] ${msg}`,
        updatedAt: new Date().toISOString(),
      });
    }
  })();

  return { started: true };
}
