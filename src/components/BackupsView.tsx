import {
  Check,
  CheckCircle2,
  Copy,
  Download,
  Eye,
  FlaskConical,
  Plus,
  RotateCcw,
  Search,
  Terminal,
  Trash2,
  Upload,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import type { BackupArchive, BackupTrigger, PasarGuardServer } from '../types.ts';
import { dbEngineLabel, formatBytes, formatDateTimeFa, triggerLabel } from '../utils/format.ts';

interface BackupsViewProps {
  backups: BackupArchive[];
  servers: PasarGuardServer[];
  panelUrl: string;
  busyActionId: string | null;
  onTriggerBackup: (serverId: string) => void;
  onRunSandboxBackup: (serverId: string) => void;
  onOpenUploadModal: () => void;
  onInspectArchive: (backup: BackupArchive) => void;
  onOpenRestoreModal: (backup: BackupArchive) => void;
  onDeleteArchive: (backup: BackupArchive) => void;
  onNavigateServers: () => void;
}

export function BackupsView({
  backups,
  servers,
  panelUrl,
  busyActionId,
  onTriggerBackup,
  onRunSandboxBackup,
  onOpenUploadModal,
  onInspectArchive,
  onOpenRestoreModal,
  onDeleteArchive,
  onNavigateServers,
}: BackupsViewProps) {
  const [search, setSearch] = useState('');
  const [triggerFilter, setTriggerFilter] = useState<'all' | BackupTrigger>('all');
  const [selectedServerId, setSelectedServerId] = useState<string>(servers[0]?.id || '');
  const [installMode, setInstallMode] = useState<'connected' | 'standalone' | 'github'>('connected');
  const [githubRepo, setGithubRepo] = useState('OWNER/pasarguard-vault');
  const [copiedCmd, setCopiedCmd] = useState(false);

  const activeServer = useMemo(
    () => servers.find((s) => s.id === selectedServerId) || servers[0],
    [servers, selectedServerId]
  );

  const cleanPanelUrl = panelUrl.replace(/\/+$/, '');
  const cleanRepo = githubRepo.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '') || 'OWNER/REPO';
  const oneLineCommand =
    installMode === 'connected'
      ? activeServer
        ? `curl -sSL "${cleanPanelUrl}/install.sh?token=${activeServer.token}" | sudo bash`
        : `curl -sSL "${cleanPanelUrl}/install.sh?name=PasarGuard-Main" | sudo bash`
      : installMode === 'standalone'
        ? `curl -sSL "${cleanPanelUrl}/standalone.sh" | sudo bash`
        : `PG_VAULT_REPO="https://github.com/${cleanRepo}.git" bash -c "$(curl -sL https://raw.githubusercontent.com/${cleanRepo}/main/install.sh)"`;

  const handleCopyCommand = async () => {
    try {
      await navigator.clipboard.writeText(oneLineCommand);
      setCopiedCmd(true);
      setTimeout(() => setCopiedCmd(false), 2000);
    } catch {
      // Ignore clipboard failures in restricted frames
    }
  };

  const filteredBackups = useMemo(() => {
    const q = search.trim().toLowerCase();
    return backups.filter((b) => {
      if (triggerFilter !== 'all' && b.trigger !== triggerFilter) return false;
      if (!q) return true;
      return (
        b.filename.toLowerCase().includes(q) ||
        b.serverName.toLowerCase().includes(q) ||
        b.sha256.toLowerCase().includes(q)
      );
    });
  }, [backups, search, triggerFilter]);

  const totalSize = useMemo(() => backups.reduce((acc, b) => acc + b.sizeBytes, 0), [backups]);
  const totalLogsSaved = useMemo(() => backups.reduce((acc, b) => acc + b.excludedLogBytes, 0), [backups]);
  const onlineServersCount = useMemo(() => servers.filter((s) => s.status === 'online').length, [servers]);

  return (
    <div className="space-y-6">
      {/* Summary Metrics Strip (Single hairline grid, no nested cards) */}
      <section className="grid grid-cols-1 divide-y divide-slate-800 rounded-lg border border-slate-800 bg-[#0F172A] sm:grid-cols-2 sm:divide-y-0 sm:divide-x sm:divide-x-reverse lg:grid-cols-4">
        <div className="p-5">
          <div className="text-xs font-medium text-slate-400">تعداد آرشیوهای بکاپ</div>
          <div className="mt-2 font-mono text-2xl font-semibold tabular-nums text-slate-100">
            {backups.length}
          </div>
          <div className="mt-1 text-xs text-slate-500">آرشیو فشرده بدون لاگ</div>
        </div>
        <div className="p-5">
          <div className="text-xs font-medium text-slate-400">حجم کل مخزن</div>
          <div className="mt-2 font-mono text-2xl font-semibold tabular-nums text-slate-100" dir="ltr">
            {formatBytes(totalSize)}
          </div>
          <div className="mt-1 text-xs text-slate-500">فقط داده‌های حیاتی پنل</div>
        </div>
        <div className="p-5">
          <div className="text-xs font-medium text-slate-400">حجم لاگ‌های حذف‌شده</div>
          <div className="mt-2 font-mono text-2xl font-semibold tabular-nums text-emerald-400" dir="ltr">
            {formatBytes(totalLogsSaved)}
          </div>
          <div className="mt-1 text-xs text-slate-500">صرفه‌جویی از حذف access/error logs</div>
        </div>
        <div className="p-5">
          <div className="text-xs font-medium text-slate-400">وضعیت سرورهای متصل</div>
          <div className="mt-2 font-mono text-2xl font-semibold tabular-nums text-slate-100">
            {onlineServersCount} / {servers.length}
          </div>
          <div className="mt-1 text-xs text-slate-500">سرور فعال و متصل به پنل</div>
        </div>
      </section>

      {/* One-Line Server Installer Strip (Directly visible on first page) */}
      <section className="rounded-lg border border-slate-800 bg-[#0F172A] p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2.5">
            <Terminal className="h-4.5 w-4.5 text-sky-400 shrink-0" />
            <div>
              <h2 className="text-sm font-semibold text-slate-100">
                دستور نصب تک‌خطی بکاپر روی سرور PasarGuard
              </h2>
              <p className="mt-0.5 text-xs text-slate-400">
                این دستور را در ترمینال سرور لینوکس اجرا کنید تا بکاپر بدون لاگ ({' '}
                <span className="font-mono text-slate-300">pgbackup</span>) نصب و آماده بکاپ‌گیری و بازیابی شود.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1 self-start rounded-md border border-slate-800 bg-[#0B1120] p-1 sm:self-center shrink-0">
            <button
              type="button"
              onClick={() => setInstallMode('connected')}
              className={`rounded px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                installMode === 'connected'
                  ? 'bg-sky-500/20 text-sky-300'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              متصل به همین پنل
            </button>
            <button
              type="button"
              onClick={() => setInstallMode('standalone')}
              className={`rounded px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                installMode === 'standalone'
                  ? 'bg-sky-500/20 text-sky-300'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              نصب مستقل (CLI)
            </button>
            <button
              type="button"
              onClick={() => setInstallMode('github')}
              className={`rounded px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                installMode === 'github'
                  ? 'bg-sky-500/20 text-sky-300'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              نصب از گیت‌هاب
            </button>
          </div>
        </div>

        {installMode === 'github' && (
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <label className="text-xs text-slate-400 whitespace-nowrap">
              نام ریپازیتوری گیت‌هاب (User/Repo):
            </label>
            <input
              type="text"
              value={githubRepo}
              onChange={(e) => setGithubRepo(e.target.value)}
              dir="ltr"
              placeholder="OWNER/pasarguard-vault"
              className="w-full max-w-xs rounded-md border border-slate-800 bg-[#0B1120] px-3 py-1.5 font-mono text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
            />
          </div>
        )}

        <div className="mt-4 flex flex-col gap-3 rounded-md border border-slate-800 bg-[#0B1120] p-3 sm:flex-row sm:items-center sm:justify-between">
          <pre className="min-w-0 flex-1 overflow-x-auto font-mono text-xs leading-relaxed text-sky-300" dir="ltr">
            {oneLineCommand}
          </pre>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleCopyCommand}
              className="inline-flex items-center gap-1.5 rounded-md bg-sky-500 px-3.5 py-2 text-xs font-medium text-slate-950 transition-colors hover:bg-sky-400 whitespace-nowrap shrink-0"
            >
              {copiedCmd ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copiedCmd ? 'کپی شد' : 'کپی دستور نصب'}
            </button>
            <button
              type="button"
              onClick={onNavigateServers}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              تنظیمات سرورها
            </button>
          </div>
        </div>
      </section>

      {/* Action & Filter Toolbar */}
      <section className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-[#0F172A] p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-3">
          <div className="relative min-w-[220px] flex-1 max-w-sm">
            <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="جستجو در نام فایل، سرور یا SHA-256..."
              className="w-full rounded-md border border-slate-800 bg-[#0B1120] py-2 pr-9 pl-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-1 rounded-md border border-slate-800 bg-[#0B1120] p-1">
            {(
              [
                { id: 'all', label: 'همه' },
                { id: 'manual', label: 'دستی' },
                { id: 'scheduled', label: 'زمان‌بندی' },
                { id: 'upload', label: 'آپلودی' },
                { id: 'pre_restore', label: 'پیش‌نسخه' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setTriggerFilter(tab.id)}
                className={`rounded px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  triggerFilter === tab.id
                    ? 'bg-slate-800 text-slate-100'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {servers.length > 0 && (
            <select
              value={activeServer?.id || ''}
              onChange={(e) => setSelectedServerId(e.target.value)}
              className="rounded-md border border-slate-800 bg-[#0B1120] px-3 py-2 text-sm text-slate-200 focus:border-sky-500 focus:outline-none"
              aria-label="انتخاب سرور"
            >
              {servers.map((srv) => (
                <option key={srv.id} value={srv.id}>
                  {srv.name} ({srv.status === 'online' ? 'آنلاین' : 'در انتظار'})
                </option>
              ))}
            </select>
          )}

          <button
            type="button"
            onClick={onOpenUploadModal}
            className="inline-flex items-center gap-2 rounded-md border border-slate-700 bg-slate-800/70 px-4 py-2 text-sm font-medium text-slate-200 transition-colors hover:bg-slate-800 whitespace-nowrap shrink-0"
          >
            <Upload className="h-4 w-4 text-slate-400" />
            آپلود بکاپ
          </button>

          {activeServer ? (
            <>
              <button
                type="button"
                disabled={busyActionId === `sandbox:${activeServer.id}`}
                onClick={() => onRunSandboxBackup(activeServer.id)}
                className="inline-flex items-center gap-2 rounded-md border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-medium text-slate-200 transition-colors hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0"
                title="ساخت بسته بکاپ آزمایشی برای بررسی فیلتر حذف لاگ‌ها"
              >
                <FlaskConical className="h-4 w-4 text-amber-400" />
                {busyActionId === `sandbox:${activeServer.id}` ? 'در حال ساخت...' : 'تست حذف لاگ'}
              </button>
              <button
                type="button"
                disabled={busyActionId === `backup:${activeServer.id}`}
                onClick={() => onTriggerBackup(activeServer.id)}
                className="inline-flex items-center gap-2 rounded-md bg-sky-500 px-4 py-2 text-sm font-medium text-slate-950 transition-colors hover:bg-sky-400 disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                <Plus className="h-4 w-4" />
                {busyActionId === `backup:${activeServer.id}` ? 'در حال ثبت...' : 'گرفتن بکاپ فوری'}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onNavigateServers}
              className="inline-flex items-center gap-2 rounded-md bg-sky-500 px-4 py-2 text-sm font-medium text-slate-950 transition-colors hover:bg-sky-400 whitespace-nowrap shrink-0"
            >
              <Plus className="h-4 w-4" />
              اتصال اولین سرور با یک خط کد
            </button>
          )}
        </div>
      </section>

      {/* High-Density Backups Data Table */}
      <section className="overflow-hidden rounded-lg border border-slate-800 bg-[#0F172A]">
        {filteredBackups.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
            <div className="text-base font-semibold text-slate-200">
              {backups.length === 0 ? 'هنوز هیچ آرشیو بکاپی در مخزن ثبت نشده است' : 'نتیجه‌ای با فیلتر فعلی یافت نشد'}
            </div>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-400">
              {backups.length === 0
                ? 'برای شروع، یک سرور PasarGuard را با دستور تک‌خطی متصل کنید یا یک فایل بکاپ (.tar.gz) را مستقیم آپلود نمایید تا لاگ‌ها پاکسازی و محتوای آن آماده بازیابی شود.'
                : 'عبارت جستجو یا فیلتر نوع بکاپ را تغییر دهید تا آرشیوهای موجود نمایش داده شوند.'}
            </p>
            {backups.length === 0 && (
              <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={onNavigateServers}
                  className="inline-flex items-center gap-2 rounded-md bg-sky-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-sky-400 whitespace-nowrap shrink-0"
                >
                  <Plus className="h-4 w-4" />
                  دریافت دستور نصب تک‌خطی
                </button>
                <button
                  type="button"
                  onClick={onOpenUploadModal}
                  className="inline-flex items-center gap-2 rounded-md border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-700 whitespace-nowrap shrink-0"
                >
                  <Upload className="h-4 w-4" />
                  آپلود فایل بکاپ
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-right text-sm">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-900/60 text-xs font-medium text-slate-400">
                  <th className="px-4 py-3">فایل آرشیو و هش</th>
                  <th className="px-4 py-3">سرور و منبع</th>
                  <th className="px-4 py-3">دیتابیس و اجزا</th>
                  <th className="px-4 py-3">حجم آرشیو</th>
                  <th className="px-4 py-3">لاگ‌های حذف‌شده</th>
                  <th className="px-4 py-3">زمان ایجاد</th>
                  <th className="px-4 py-3 text-left">عملیات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {filteredBackups.map((b) => (
                  <tr key={b.id} className="transition-colors hover:bg-slate-800/35">
                    <td className="px-4 py-3 align-middle">
                      <div className="font-mono text-xs font-medium text-slate-100" dir="ltr">
                        {b.filename}
                      </div>
                      <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
                        <span className="font-mono tabular-nums" dir="ltr">
                          sha256:{b.sha256.slice(0, 12)}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="tabular-nums">{b.entriesCount} فایل</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <div className="font-medium text-slate-200">{b.serverName}</div>
                      <div className="mt-0.5 text-xs text-slate-400">{triggerLabel(b.trigger)}</div>
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <div className="font-mono text-xs text-slate-200" dir="ltr">
                        {dbEngineLabel(b.dbEngine)}
                      </div>
                      <div className="mt-0.5 text-xs text-slate-400">
                        {b.components.length > 0 ? b.components.join(' · ') : 'پیکربندی عمومی'}
                      </div>
                    </td>
                    <td className="px-4 py-3 align-middle font-mono text-xs tabular-nums text-slate-200" dir="ltr">
                      {formatBytes(b.sizeBytes)}
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <div className="flex items-center gap-1.5 text-xs">
                        <CheckCircle2
                          className={`h-3.5 w-3.5 shrink-0 ${
                            b.logFreeVerified ? 'text-emerald-400' : 'text-amber-400'
                          }`}
                        />
                        <span className={b.logFreeVerified ? 'text-emerald-400' : 'text-amber-400'}>
                          {b.logFreeVerified ? 'بدون لاگ' : 'دارای لاگ'}
                        </span>
                      </div>
                      <div className="mt-0.5 font-mono text-xs tabular-nums text-slate-500" dir="ltr">
                        {b.excludedLogCount} files ({formatBytes(b.excludedLogBytes)})
                      </div>
                    </td>
                    <td className="px-4 py-3 align-middle text-xs tabular-nums text-slate-400">
                      {formatDateTimeFa(b.createdAt)}
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => onInspectArchive(b)}
                          className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800 whitespace-nowrap shrink-0"
                          title="بررسی فایل‌های داخل آرشیو"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          محتوا
                        </button>
                        <a
                          href={`/api/backups/${b.id}/download`}
                          className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800 whitespace-nowrap shrink-0"
                          title="دانلود فایل .tar.gz"
                        >
                          <Download className="h-3.5 w-3.5" />
                          دانلود
                        </a>
                        <button
                          type="button"
                          onClick={() => onOpenRestoreModal(b)}
                          className="inline-flex items-center gap-1 rounded border border-sky-500/40 bg-sky-500/10 px-2.5 py-1.5 text-xs font-medium text-sky-300 hover:bg-sky-500/20 whitespace-nowrap shrink-0"
                          title="بازگردانی بکاپ روی سرور"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          بازیابی
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteArchive(b)}
                          className="inline-flex items-center rounded border border-slate-800 p-1.5 text-slate-500 hover:border-rose-500/40 hover:bg-rose-500/10 hover:text-rose-400"
                          title="حذف آرشیو"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
