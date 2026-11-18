import { Check, Copy, FlaskConical, Play, Plus, Server, Terminal, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { DbEngine, PasarGuardServer } from '../types.ts';
import { dbEngineLabel, formatDateTimeFa, serverStatusInfo } from '../utils/format.ts';

interface ServersInstallViewProps {
  servers: PasarGuardServer[];
  panelUrl: string;
  busyActionId: string | null;
  onAddServer: (payload: {
    name: string;
    host: string;
    optPath: string;
    dataPath: string;
    dbEngine: DbEngine;
  }) => Promise<void>;
  onDeleteServer: (serverId: string) => void;
  onTriggerBackup: (serverId: string) => void;
  onRunSandboxBackup: (serverId: string) => void;
}

export function ServersInstallView({
  servers,
  panelUrl,
  busyActionId,
  onAddServer,
  onDeleteServer,
  onTriggerBackup,
  onRunSandboxBackup,
}: ServersInstallViewProps) {
  const [name, setName] = useState('');
  const [host, setHost] = useState('');
  const [optPath, setOptPath] = useState('/opt/pasarguard');
  const [dataPath, setDataPath] = useState('/var/lib/pasarguard');
  const [dbEngine, setDbEngine] = useState<DbEngine>('sqlite');
  const [submitting, setSubmitting] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const cleanPanelUrl = panelUrl.replace(/\/+$/, '');
  const standaloneCommand = `curl -sSL "${cleanPanelUrl}/standalone.sh?optPath=${encodeURIComponent(optPath)}&dataPath=${encodeURIComponent(dataPath)}" | sudo bash`;

  const copyText = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId((curr) => (curr === id ? null : curr)), 2000);
    } catch {
      // Ignore clipboard failures in restricted frames
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      await onAddServer({ name, host, optPath, dataPath, dbEngine });
      setName('');
      setHost('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Grid: Register Connected Server + Standalone Installer */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <form
          onSubmit={handleSubmit}
          className="rounded-lg border border-slate-800 bg-[#0F172A] p-6 xl:col-span-7"
        >
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <div>
              <h2 className="text-base font-semibold text-slate-100">
                افزودن سرور PasarGuard و تولید دستور نصب تک‌خطی
              </h2>
              <p className="mt-1 text-xs text-slate-400">
                با ثبت سرور، یک توکن اختصاصی ایجاد می‌شود تا با اجرای یک خط کد روی VPS، بکاپ‌گیری و بازیابی مستقیماً از همین پنل انجام شود.
              </p>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-300">
                نام نمایشی سرور *
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="مثال: Germany-Main-Panel"
                className="w-full rounded-md border border-slate-800 bg-[#0B1120] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-300">
                آدرس IP یا دامنه (اختیاری)
              </label>
              <input
                type="text"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="panel.example.com"
                dir="ltr"
                className="w-full rounded-md border border-slate-800 bg-[#0B1120] px-3 py-2 font-mono text-sm text-slate-100 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-300">
                مسیر نصب PasarGuard (.env &amp; Compose)
              </label>
              <input
                type="text"
                value={optPath}
                onChange={(e) => setOptPath(e.target.value)}
                dir="ltr"
                className="w-full rounded-md border border-slate-800 bg-[#0B1120] px-3 py-2 font-mono text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-300">
                مسیر داده‌های ماندگار (Data Volume)
              </label>
              <input
                type="text"
                value={dataPath}
                onChange={(e) => setDataPath(e.target.value)}
                dir="ltr"
                className="w-full rounded-md border border-slate-800 bg-[#0B1120] px-3 py-2 font-mono text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="mb-1.5 block text-xs font-medium text-slate-300">
                موتور دیتابیس پیش‌فرض (ایجنت روی سرور به‌صورت خودکار از .env تشخیص می‌دهد)
              </label>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    { id: 'sqlite', label: 'SQLite (WAL Safe)' },
                    { id: 'postgres', label: 'PostgreSQL 17' },
                    { id: 'timescaledb', label: 'TimescaleDB' },
                    { id: 'mysql', label: 'MySQL / MariaDB' },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setDbEngine(item.id)}
                    className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                      dbEngine === item.id
                        ? 'border-sky-500/40 bg-sky-500/15 text-sky-300'
                        : 'border-slate-800 bg-[#0B1120] text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-6 flex justify-end">
            <button
              type="submit"
              disabled={submitting || !name.trim()}
              className="inline-flex items-center gap-2 rounded-md bg-sky-500 px-5 py-2 text-sm font-medium text-slate-950 transition-colors hover:bg-sky-400 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <Plus className="h-4 w-4" />
              {submitting ? 'در حال ثبت...' : 'ایجاد سرور و دریافت کد نصب'}
            </button>
          </div>
        </form>

        {/* Standalone One-Line Installer Box */}
        <div className="flex flex-col justify-between rounded-lg border border-slate-800 bg-[#0F172A] p-6 xl:col-span-5">
          <div>
            <div className="flex items-center gap-2 text-base font-semibold text-slate-100">
              <Terminal className="h-4.5 w-4.5 text-sky-400" />
              نصب مستقل روی سرور (Standalone CLI)
            </div>
            <p className="mt-2 text-xs leading-relaxed text-slate-400">
              اگر می‌خواهید ابزار بکاپر <span className="font-mono text-slate-300">pgbackup</span> را بدون اتصال به این پنل، فقط روی خود سرور لینوکس نصب کنید تا روزانه بدون لاگ بکاپ بگیرد و به تلگرام یا مسیر محلی ذخیره کند، دستور زیر را در ترمینال VPS اجرا کنید:
            </p>

            <div className="mt-4 rounded-md border border-slate-800 bg-[#0B1120] p-3">
              <div className="mb-2 flex items-center justify-between text-xs text-slate-500">
                <span>دستور تک‌خطی نصب مستقل</span>
                <button
                  type="button"
                  onClick={() => copyText('standalone', standaloneCommand)}
                  className="inline-flex items-center gap-1 text-sky-400 hover:text-sky-300 whitespace-nowrap shrink-0"
                >
                  {copiedId === 'standalone' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copiedId === 'standalone' ? 'کپی شد' : 'کپی دستور'}
                </button>
              </div>
              <pre className="overflow-x-auto font-mono text-xs leading-relaxed text-slate-200" dir="ltr">
                {standaloneCommand}
              </pre>
            </div>
          </div>

          <div className="mt-4 border-t border-slate-800 pt-4 text-xs text-slate-400">
            <div className="font-medium text-slate-300">موارد شامل‌شده در هر بکاپ:</div>
            <div className="mt-1.5 font-mono text-[11px] leading-relaxed text-slate-400" dir="ltr">
              ✓ .env · docker-compose.yml · SQLite(.backup)/MySQL/Postgres · certs/ · templates/ · xray_config.json
            </div>
            <div className="mt-1 font-mono text-[11px] leading-relaxed text-rose-400" dir="ltr">
              ✕ /var/lib/pasarguard/logs/ · access.log · error.log · *.log*
            </div>
          </div>
        </div>
      </div>

      {/* Connected Servers List */}
      <section className="rounded-lg border border-slate-800 bg-[#0F172A]">
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
          <h3 className="text-base font-semibold text-slate-100">سرورهای ثبت‌شده و دستورات نصب</h3>
          <span className="font-mono text-xs tabular-nums text-slate-400">{servers.length} سرور</span>
        </div>

        {servers.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-slate-400">
            هنوز سروری ثبت نشده است. از فرم بالا نام سرور PasarGuard خود را وارد کنید تا دستور نصب تک‌خطی تولید شود.
          </div>
        ) : (
          <div className="divide-y divide-slate-800">
            {servers.map((srv) => {
              const statusMeta = serverStatusInfo(srv.status);
              const installCmd = `curl -sSL "${cleanPanelUrl}/install.sh?token=${srv.token}" | sudo bash`;
              return (
                <div key={srv.id} className="p-6">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2.5">
                        <Server className="h-4 w-4 text-slate-400" />
                        <span className="text-base font-semibold text-slate-100">{srv.name}</span>
                        <span className="text-slate-600" aria-hidden="true">·</span>
                        <span className={`text-xs font-medium ${statusMeta.colorClass}`}>
                          {statusMeta.label}
                        </span>
                        <span className="text-slate-600" aria-hidden="true">·</span>
                        <span className="font-mono text-xs text-slate-400" dir="ltr">
                          {dbEngineLabel(srv.dbEngine)}
                        </span>
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
                        <span className="font-mono" dir="ltr">{srv.host}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono" dir="ltr">{srv.optPath}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono" dir="ltr">{srv.dataPath}</span>
                        <span aria-hidden="true">·</span>
                        <span>آخرین اتصال: {formatDateTimeFa(srv.lastSeenAt)}</span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <button
                        type="button"
                        disabled={busyActionId === `sandbox:${srv.id}`}
                        onClick={() => onRunSandboxBackup(srv.id)}
                        className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0"
                      >
                        <FlaskConical className="h-3.5 w-3.5 text-amber-400" />
                        تست ساخت آرشیو
                      </button>
                      <button
                        type="button"
                        disabled={busyActionId === `backup:${srv.id}`}
                        onClick={() => onTriggerBackup(srv.id)}
                        className="inline-flex items-center gap-1.5 rounded-md bg-sky-500 px-3 py-1.5 text-xs font-medium text-slate-950 hover:bg-sky-400 disabled:opacity-50 whitespace-nowrap shrink-0"
                      >
                        <Play className="h-3.5 w-3.5" />
                        بکاپ فوری از سرور
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteServer(srv.id)}
                        className="inline-flex items-center rounded-md border border-slate-800 p-1.5 text-slate-500 hover:border-rose-500/40 hover:bg-rose-500/10 hover:text-rose-400"
                        title="حذف سرور"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {/* One-Line Install Command Strip */}
                  <div className="mt-4 flex flex-col gap-2 rounded-md border border-slate-800 bg-[#0B1120] p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 text-[11px] font-medium text-slate-500">
                        دستور نصب تک‌خطی اختصاصی روی سرور لینوکس (Ubuntu / Debian / AlmaLinux):
                      </div>
                      <pre className="overflow-x-auto font-mono text-xs text-sky-300" dir="ltr">
                        {installCmd}
                      </pre>
                    </div>
                    <button
                      type="button"
                      onClick={() => copyText(srv.id, installCmd)}
                      className="inline-flex items-center gap-1.5 self-start rounded border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 sm:self-center whitespace-nowrap shrink-0"
                    >
                      {copiedId === srv.id ? (
                        <>
                          <Check className="h-3.5 w-3.5 text-emerald-400" />
                          کپی شد
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5" />
                          کپی دستور
                        </>
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
