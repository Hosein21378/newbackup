import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import dotenv from 'dotenv';
import express, { type Request, type Response } from 'express';
import multer from 'multer';
import { createServer as createViteServer } from 'vite';
import { generateConnectedInstallScript, generateStandaloneScript } from './server/scripts.ts';
import {
  computeSha256,
  createIsolatedSandboxArchive,
  createJobRecord,
  createServerRecord,
  getArchiveFilePath,
  inspectTarGz,
  loadVault,
  saveVault,
  stripLogsFromTarGz,
  updateTelegramConfig,
} from './server/store.ts';
import type { BackupArchive, BackupTrigger, DbEngine, ExclusionPolicy, PasarGuardServer } from './server/types.ts';

dotenv.config();

const PORT = 3000;
const upload = multer({
  dest: path.join(os.tmpdir(), 'pgvault-uploads'),
  limits: { fileSize: 1024 * 1024 * 512 },
});

function resolvePanelUrl(req: Request): string {
  const envUrl = process.env.APP_URL?.trim();
  const forwardedProto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim();
  const forwardedHost = (req.headers['x-forwarded-host'] as string | undefined)?.split(',')[0]?.trim();
  if (forwardedHost) {
    return `${forwardedProto || 'https'}://${forwardedHost}`;
  }
  const host = req.get('host');
  if (host) {
    const proto = forwardedProto || req.protocol || 'http';
    return `${proto}://${host}`;
  }
  return envUrl || `http://localhost:${PORT}`;
}

function getBearerToken(req: Request): string {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) {
    return auth.slice(7).trim();
  }
  return '';
}

function findServerByToken(token: string): PasarGuardServer | undefined {
  if (!token) return undefined;
  const vault = loadVault();
  return vault.servers.find((s) => s.token === token);
}

async function startServer(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  // --- Panel Management API ---
  app.get('/api/state', (req: Request, res: Response) => {
    const vault = loadVault();
    const panelUrl = resolvePanelUrl(req);
    const now = Date.now();
    // Mark servers unseen for > 90s as offline if previously online
    let dirty = false;
    for (const srv of vault.servers) {
      if (srv.lastSeenAt) {
        const diff = now - new Date(srv.lastSeenAt).getTime();
        const nextStatus = diff > 90_000 ? 'offline' : 'online';
        if (srv.status !== nextStatus) {
          srv.status = nextStatus;
          dirty = true;
        }
      }
    }
    if (dirty) saveVault(vault);
    res.json({
      ...vault,
      panelUrl,
    });
  });

  app.post('/api/servers', (req: Request, res: Response) => {
    const { name, host, optPath, dataPath, dbEngine, notes } = req.body as {
      name?: string;
      host?: string;
      optPath?: string;
      dataPath?: string;
      dbEngine?: DbEngine;
      notes?: string;
    };

    if (!name || !name.trim()) {
      res.status(400).json({ error: 'نام سرور الزامی است.' });
      return;
    }

    const vault = loadVault();
    const server = createServerRecord({ name, host, optPath, dataPath, dbEngine, notes });
    vault.servers.unshift(server);
    saveVault(vault);

    const panelUrl = resolvePanelUrl(req);
    const installScriptUrl = `${panelUrl}/install.sh?token=${server.token}`;
    const installCommand = `curl -sSL "${installScriptUrl}" | sudo bash`;

    res.status(201).json({
      server,
      installScriptUrl,
      installCommand,
    });
  });

  app.delete('/api/servers/:id', (req: Request, res: Response) => {
    const vault = loadVault();
    const before = vault.servers.length;
    vault.servers = vault.servers.filter((s) => s.id !== req.params.id);
    if (vault.servers.length === before) {
      res.status(404).json({ error: 'سرور مورد نظر یافت نشد.' });
      return;
    }
    saveVault(vault);
    res.json({ ok: true });
  });

  app.post('/api/servers/:id/backup', (req: Request, res: Response) => {
    const vault = loadVault();
    const server = vault.servers.find((s) => s.id === req.params.id);
    if (!server) {
      res.status(404).json({ error: 'سرور یافت نشد.' });
      return;
    }

    const job = createJobRecord({
      serverId: server.id,
      serverName: server.name,
      action: 'backup_now',
      message: 'دستور بکاپ فوری (بدون لاگ) در صف ایجنت سرور ثبت شد.',
    });
    vault.jobs.unshift(job);
    vault.jobs = vault.jobs.slice(0, 60);
    saveVault(vault);
    res.status(201).json({ job });
  });

  app.post('/api/servers/:id/sandbox-backup', async (req: Request, res: Response) => {
    const vault = loadVault();
    const server = vault.servers.find((s) => s.id === req.params.id);
    if (!server) {
      res.status(404).json({ error: 'سرور یافت نشد.' });
      return;
    }

    try {
      const { archive, excludedLogFiles } = await createIsolatedSandboxArchive(server, vault.policy);
      vault.backups.unshift(archive);
      server.lastBackupAt = archive.createdAt;
      const job = createJobRecord({
        serverId: server.id,
        serverName: server.name,
        action: 'backup_now',
        backupId: archive.id,
        backupFilename: archive.filename,
        status: 'completed',
        message: `آزمون ساخت آرشیو PasarGuard تکمیل شد (${excludedLogFiles.length} فایل لاگ حذف گردید).`,
      });
      job.outputLog = `Archive: ${archive.filename}\nExcluded logs: ${excludedLogFiles.join(', ')}\nSHA256: ${archive.sha256}`;
      vault.jobs.unshift(job);
      vault.jobs = vault.jobs.slice(0, 60);
      saveVault(vault);
      res.status(201).json({ archive, job, excludedLogFiles });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'خطا در ایجاد آرشیو آزمایشی' });
    }
  });

  app.post('/api/backups/upload', upload.single('archive'), async (req: Request, res: Response) => {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'فایل بکاپ انتخاب نشده است.' });
      return;
    }

    try {
      const vault = loadVault();
      const serverId = (req.body.serverId as string | undefined) || 'uploaded';
      const matchedServer = vault.servers.find((s) => s.id === serverId);
      const stripLogs = req.body.stripLogs !== 'false';

      const originalName = (file.originalname || `pasarguard-upload-${Date.now()}.tar.gz`).replace(/[^a-zA-Z0-9._-]/g, '_');
      const finalName = originalName.endsWith('.tar.gz') || originalName.endsWith('.tgz')
        ? `${Date.now()}-${originalName}`
        : `${Date.now()}-${originalName}.tar.gz`;
      const destPath = getArchiveFilePath(finalName);

      let excludedLogBytes = 0;
      let excludedLogCount = 0;

      if (stripLogs) {
        const stripped = await stripLogsFromTarGz(file.path, destPath);
        excludedLogBytes = stripped.strippedBytes;
        excludedLogCount = stripped.strippedCount;
      } else {
        fs.copyFileSync(file.path, destPath);
      }

      const inspection = await inspectTarGz(destPath);
      const stat = fs.statSync(destPath);
      const sha256 = computeSha256(destPath);

      const archive: BackupArchive = {
        id: `bkp_${crypto.randomBytes(6).toString('hex')}`,
        serverId: matchedServer?.id || 'uploaded',
        serverName: matchedServer?.name || 'آرشیو آپلودی',
        filename: finalName,
        trigger: 'upload',
        dbEngine: matchedServer?.dbEngine || 'sqlite',
        sizeBytes: stat.size,
        excludedLogBytes,
        excludedLogCount,
        sha256,
        components: inspection.components,
        entriesCount: inspection.entries.filter((e) => e.type === 'File').length,
        logFreeVerified: inspection.logEntries.length === 0,
        createdAt: new Date().toISOString(),
      };

      vault.backups.unshift(archive);
      saveVault(vault);
      res.status(201).json({ archive });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? `فایل نامعتبر یا فرمت tar.gz پشتیبانی نمی‌شود: ${err.message}` : 'خطا در پردازش آرشیو',
      });
    } finally {
      if (file && fs.existsSync(file.path)) {
        fs.rmSync(file.path, { force: true });
      }
    }
  });

  app.get('/api/backups/:id/contents', async (req: Request, res: Response) => {
    const vault = loadVault();
    const archive = vault.backups.find((b) => b.id === req.params.id);
    if (!archive) {
      res.status(404).json({ error: 'بکاپ مورد نظر یافت نشد.' });
      return;
    }
    const filePath = getArchiveFilePath(archive.filename);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'فایل فیزیکی آرشیو در مخزن یافت نشد.' });
      return;
    }
    try {
      const inspection = await inspectTarGz(filePath);
      res.json({
        archive,
        ...inspection,
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'خطا در خواندن محتوای آرشیو' });
    }
  });

  app.get('/api/backups/:id/download', (req: Request, res: Response) => {
    const vault = loadVault();
    const archive = vault.backups.find((b) => b.id === req.params.id);
    if (!archive) {
      res.status(404).json({ error: 'بکاپ یافت نشد.' });
      return;
    }
    const filePath = getArchiveFilePath(archive.filename);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'فایل بکاپ در مخزن وجود ندارد.' });
      return;
    }
    res.download(filePath, archive.filename);
  });

  app.post('/api/backups/:id/restore', (req: Request, res: Response) => {
    const vault = loadVault();
    const archive = vault.backups.find((b) => b.id === req.params.id);
    if (!archive) {
      res.status(404).json({ error: 'بکاپ مورد نظر یافت نشد.' });
      return;
    }

    const targetServerId = (req.body.targetServerId as string | undefined) || archive.serverId;
    const targetServer = vault.servers.find((s) => s.id === targetServerId);
    if (!targetServer) {
      res.status(400).json({
        error: 'هیچ سرور مقصدی برای بازیابی انتخاب نشده است. ابتدا یک سرور را با دستور تک‌خطی متصل کنید.',
      });
      return;
    }

    const job = createJobRecord({
      serverId: targetServer.id,
      serverName: targetServer.name,
      action: 'restore_archive',
      backupId: archive.id,
      backupFilename: archive.filename,
      message: `دستور بازیابی «${archive.filename}» برای سرور «${targetServer.name}» در صف قرار گرفت.`,
    });

    vault.jobs.unshift(job);
    vault.jobs = vault.jobs.slice(0, 60);
    saveVault(vault);
    res.status(201).json({ job });
  });

  app.delete('/api/backups/:id', (req: Request, res: Response) => {
    const vault = loadVault();
    const target = vault.backups.find((b) => b.id === req.params.id);
    if (!target) {
      res.status(404).json({ error: 'بکاپ یافت نشد.' });
      return;
    }
    const filePath = getArchiveFilePath(target.filename);
    if (fs.existsSync(filePath)) {
      fs.rmSync(filePath, { force: true });
    }
    vault.backups = vault.backups.filter((b) => b.id !== req.params.id);
    saveVault(vault);
    res.json({ ok: true });
  });

  app.put('/api/policy', (req: Request, res: Response) => {
    const vault = loadVault();
    const nextPolicy = req.body as Partial<ExclusionPolicy>;
    vault.policy = {
      ...vault.policy,
      ...nextPolicy,
      includePaths: {
        ...vault.policy.includePaths,
        ...(nextPolicy.includePaths || {}),
      },
    };
    saveVault(vault);
    res.json({ policy: vault.policy });
  });

  app.put('/api/telegram', (req: Request, res: Response) => {
    const vault = loadVault();
    const updated = updateTelegramConfig(vault, req.body);
    res.json({ telegram: updated.telegram });
  });

  // --- One-Line Installer Endpoints ---
  app.get('/install.sh', (req: Request, res: Response) => {
    const token = (req.query.token as string | undefined)?.trim();
    const vault = loadVault();
    let server = vault.servers.find((s) => s.token === token);

    if (!server) {
      const name = ((req.query.name as string | undefined) || 'PasarGuard-VPS').trim();
      server = createServerRecord({ name });
      vault.servers.unshift(server);
      saveVault(vault);
    }

    const script = generateConnectedInstallScript({
      panelUrl: resolvePanelUrl(req),
      server,
      policy: vault.policy,
      telegram: vault.telegram,
    });
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(script);
  });

  app.get('/standalone.sh', (req: Request, res: Response) => {
    const vault = loadVault();
    const optPath = ((req.query.optPath as string | undefined) || '/opt/pasarguard').trim();
    const dataPath = ((req.query.dataPath as string | undefined) || '/var/lib/pasarguard').trim();
    const script = generateStandaloneScript({
      optPath,
      dataPath,
      policy: vault.policy,
      telegram: vault.telegram,
    });
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(script);
  });

  // --- VPS Agent Endpoints ---
  app.post('/api/agent/heartbeat', (req: Request, res: Response) => {
    const token = getBearerToken(req);
    const vault = loadVault();
    const server = vault.servers.find((s) => s.token === token);
    if (!server) {
      res.status(401).json({ error: 'توکن ایجنت نامعتبر است.' });
      return;
    }

    const { host, dbEngine, osInfo } = req.body as {
      host?: string;
      dbEngine?: DbEngine;
      osInfo?: string;
    };

    server.status = 'online';
    server.lastSeenAt = new Date().toISOString();
    if (host) server.host = host;
    if (dbEngine) server.dbEngine = dbEngine;
    if (osInfo) server.osInfo = osInfo;

    const pendingJobs = vault.jobs.filter((j) => j.serverId === server.id && j.status === 'pending');
    for (const j of pendingJobs) {
      j.status = 'running';
      j.updatedAt = new Date().toISOString();
    }

    saveVault(vault);
    res.json({
      ok: true,
      jobs: pendingJobs,
    });
  });

  app.post('/api/agent/upload', upload.single('archive'), async (req: Request, res: Response) => {
    const token = getBearerToken(req);
    const serverMatch = findServerByToken(token);
    if (!serverMatch) {
      if (req.file && fs.existsSync(req.file.path)) fs.rmSync(req.file.path, { force: true });
      res.status(401).json({ error: 'توکن ایجنت نامعتبر است.' });
      return;
    }

    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'فایل بکاپ ارسال نشده است.' });
      return;
    }

    try {
      const vault = loadVault();
      const server = vault.servers.find((s) => s.id === serverMatch.id)!;
      const filename = `${Date.now()}-${(file.originalname || 'backup.tar.gz').replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const destPath = getArchiveFilePath(filename);
      fs.copyFileSync(file.path, destPath);

      const inspection = await inspectTarGz(destPath);
      const stat = fs.statSync(destPath);
      const sha256 = computeSha256(destPath);
      const trigger = ((req.body.trigger as BackupTrigger | undefined) || 'manual');
      const dbEngine = ((req.body.dbEngine as DbEngine | undefined) || server.dbEngine);
      const excludedLogBytes = Number(req.body.excludedLogBytes || 0);
      const excludedLogCount = Number(req.body.excludedLogCount || 0);

      const archive: BackupArchive = {
        id: `bkp_${crypto.randomBytes(6).toString('hex')}`,
        serverId: server.id,
        serverName: server.name,
        filename,
        trigger,
        dbEngine,
        sizeBytes: stat.size,
        excludedLogBytes,
        excludedLogCount,
        sha256,
        components: inspection.components,
        entriesCount: inspection.entries.filter((e) => e.type === 'File').length,
        logFreeVerified: inspection.logEntries.length === 0,
        createdAt: new Date().toISOString(),
      };

      vault.backups.unshift(archive);
      server.lastBackupAt = archive.createdAt;
      server.lastSeenAt = archive.createdAt;
      server.status = 'online';
      saveVault(vault);
      res.status(201).json({ ok: true, archive });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'خطا در ثبت آرشیو' });
    } finally {
      if (fs.existsSync(file.path)) fs.rmSync(file.path, { force: true });
    }
  });

  app.post('/api/agent/jobs/:id/complete', (req: Request, res: Response) => {
    const token = getBearerToken(req);
    const serverMatch = findServerByToken(token);
    if (!serverMatch) {
      res.status(401).json({ error: 'توکن نامعتبر است.' });
      return;
    }
    const vault = loadVault();
    const job = vault.jobs.find((j) => j.id === req.params.id && j.serverId === serverMatch.id);
    if (!job) {
      res.status(404).json({ error: 'عملیات یافت نشد.' });
      return;
    }
    const { status, outputLog } = req.body as { status?: 'completed' | 'failed'; outputLog?: string };
    job.status = status === 'failed' ? 'failed' : 'completed';
    job.outputLog = outputLog || '';
    job.message = job.status === 'completed' ? 'عملیات روی سرور با موفقیت انجام شد.' : 'عملیات روی سرور با خطا مواجه شد.';
    job.updatedAt = new Date().toISOString();
    saveVault(vault);
    res.json({ ok: true, job });
  });

  app.get('/api/agent/download/:backupId', (req: Request, res: Response) => {
    const token = getBearerToken(req);
    if (!findServerByToken(token)) {
      res.status(401).json({ error: 'توکن نامعتبر است.' });
      return;
    }
    const vault = loadVault();
    const archive = vault.backups.find((b) => b.id === req.params.backupId);
    if (!archive) {
      res.status(404).json({ error: 'آرشیو یافت نشد.' });
      return;
    }
    const filePath = getArchiveFilePath(archive.filename);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'فایل آرشیو وجود ندارد.' });
      return;
    }
    res.download(filePath, archive.filename);
  });

  // --- Vite Middleware / Production Static Serving ---
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`PasarGuard Vault listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start PasarGuard Vault server:', err);
  process.exit(1);
});
