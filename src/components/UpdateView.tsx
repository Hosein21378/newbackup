import { ArrowUpCircle, Check, CheckCircle2, Copy, GitCommitHorizontal, Loader2, RefreshCw, Terminal } from 'lucide-react';
import { useState } from 'react';
import type { SystemUpdateStatus } from '../types.ts';
import { formatDateTimeFa } from '../utils/format.ts';

interface UpdateViewProps {
  updateStatus: SystemUpdateStatus | null;
  checking: boolean;
  starting: boolean;
  onCheckUpdate: () => void;
  onStartUpdate: () => void;
}

export function UpdateView({
  updateStatus,
  checking,
  starting,
  onCheckUpdate,
  onStartUpdate,
}: UpdateViewProps) {
  const [copiedCmd, setCopiedCmd] = useState(false);

  const repo = updateStatus?.repo || 'Hosein21378/newbackup';
  const fallbackCmd = `bash -c "$(curl -fsSL https://raw.githubusercontent.com/${repo}/main/install.sh)"`;

  const copyCommand = async () => {
    try {
      await navigator.clipboard.writeText(fallbackCmd);
      setCopiedCmd(true);
      setTimeout(() => setCopiedCmd(false), 2000);
    } catch {
      // Ignore clipboard failures
    }
  };

  const isRunning = updateStatus?.status === 'running' || starting;

  return (
    <div className="space-y-6">
      {/* Version & Update Comparison */}
      <section className="rounded-lg border border-slate-800 bg-[#0F172A] p-6">
        <div className="flex flex-col gap-4 border-b border-slate-800 pb-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-100">
              بروزرسانی پنل PasarGuard Vault از گیت‌هاب
            </h2>
            <p className="mt-1 text-xs text-slate-400">
              بررسی آخرین تغییرات مخزن{' '}
              <span className="font-mono text-slate-300" dir="ltr">
                {repo}
              </span>{' '}
              و اعمال مستقیم آپدیت همراه با بیلد و ری‌استارت سرویس.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              disabled={checking || isRunning}
              onClick={onCheckUpdate}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-900 px-4 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${checking ? 'animate-spin' : ''}`} />
              {checking ? 'در حال بررسی...' : 'بررسی آپدیت جدید'}
            </button>

            <button
              type="button"
              disabled={isRunning || !updateStatus?.isGitRepo}
              onClick={onStartUpdate}
              className="inline-flex items-center gap-1.5 rounded-md bg-sky-500 px-4 py-2 text-xs font-medium text-slate-950 hover:bg-sky-400 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              {isRunning ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ArrowUpCircle className="h-3.5 w-3.5" />
              )}
              {isRunning
                ? 'در حال بروزرسانی...'
                : updateStatus?.updateAvailable
                  ? 'نصب نسخه جدید از گیت‌هاب'
                  : 'بروزرسانی / بازسازی پنل'}
            </button>
          </div>
        </div>

        {/* Version Grid */}
        <div className="mt-5 grid grid-cols-1 divide-y divide-slate-800 rounded-md border border-slate-800 bg-[#0B1120] md:grid-cols-2 md:divide-y-0 md:divide-x md:divide-x-reverse">
          <div className="p-4">
            <div className="flex items-center gap-2 text-xs font-medium text-slate-400">
              <GitCommitHorizontal className="h-4 w-4 text-slate-500" />
              نسخه نصب‌شده فعلی روی سرور
            </div>
            <div className="mt-2 font-mono text-base font-semibold text-slate-100" dir="ltr">
              {updateStatus?.currentCommit || 'غیر Git (پیش‌نمایش)'}
            </div>
            <div className="mt-1 text-xs text-slate-400">
              {updateStatus?.currentMessage || 'نصب مستقیم بدون مخزن git محلی'}
            </div>
            {updateStatus?.currentDate && (
              <div className="mt-1 font-mono text-[11px] tabular-nums text-slate-500">
                {formatDateTimeFa(updateStatus.currentDate)}
              </div>
            )}
          </div>

          <div className="p-4">
            <div className="flex items-center justify-between text-xs font-medium text-slate-400">
              <span className="flex items-center gap-2">
                <GitCommitHorizontal className="h-4 w-4 text-sky-400" />
                آخرین نسخه در گیت‌هاب (main)
              </span>
              {updateStatus && !updateStatus.checkError && (
                <span
                  className={
                    updateStatus.updateAvailable ? 'text-amber-400 font-medium' : 'text-emerald-400 font-medium'
                  }
                >
                  {updateStatus.updateAvailable ? 'آپدیت جدید موجود است' : 'به‌روز است'}
                </span>
              )}
            </div>
            <div className="mt-2 font-mono text-base font-semibold text-slate-100" dir="ltr">
              {updateStatus?.latestCommit || '—'}
            </div>
            <div className="mt-1 text-xs text-slate-400">
              {updateStatus?.checkError
                ? `خطا در بررسی گیت‌هاب: ${updateStatus.checkError}`
                : updateStatus?.latestMessage || 'در انتظار بررسی...'}
            </div>
            {updateStatus?.latestDate && (
              <div className="mt-1 font-mono text-[11px] tabular-nums text-slate-500">
                {formatDateTimeFa(updateStatus.latestDate)}
              </div>
            )}
          </div>
        </div>

        {/* Status / Non-git explanation */}
        {updateStatus && !updateStatus.isGitRepo && (
          <div className="mt-4 rounded-md border border-slate-800 bg-[#0B1120] p-4 text-xs leading-relaxed text-slate-400">
            دکمه بروزرسانی خودکار داخل پنل روی سرور لینوکسی که با دستور <span className="font-mono text-slate-200">install.sh</span> و مخزن Git در مسیر <span className="font-mono text-slate-200">/opt/pasarguard-vault</span> نصب شده باشد فعال می‌شود. همچنین همیشه می‌توانید با اجرای دستور تک‌خطی زیر در ترمینال سرور پنل را آپدیت کنید:
          </div>
        )}

        {updateStatus?.status === 'success' && (
          <div className="mt-4 flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-300">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            بروزرسانی با موفقیت انجام شد و سرویس پنل مجدداً راه‌اندازی گردید.
          </div>
        )}

        {/* Live Update Output Log */}
        {updateStatus?.log && (
          <div className="mt-4">
            <div className="mb-1.5 text-xs font-medium text-slate-400">گزارش اجرای بروزرسانی</div>
            <pre
              className="max-h-72 overflow-auto rounded-md border border-slate-800 bg-[#0B1120] p-4 font-mono text-xs leading-relaxed text-slate-300"
              dir="ltr"
            >
              {updateStatus.log}
            </pre>
          </div>
        )}
      </section>

      {/* Manual One-Line Terminal Update Fallback */}
      <section className="rounded-lg border border-slate-800 bg-[#0F172A] p-5">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
          <Terminal className="h-4 w-4 text-sky-400" />
          دستور بروزرسانی دستی از طریق ترمینال سرور
        </div>
        <p className="mt-1 text-xs text-slate-400">
          در صورت نیاز، اجرای مجدد دستور نصب تک‌خطی نیز آخرین نسخه را از گیت‌هاب دریافت کرده و بدون پاک شدن بکاپ‌ها پنل را بروزرسانی می‌کند.
        </p>
        <div className="mt-3 flex flex-col gap-3 rounded-md border border-slate-800 bg-[#0B1120] p-3 sm:flex-row sm:items-center sm:justify-between">
          <pre className="min-w-0 flex-1 overflow-x-auto font-mono text-xs text-sky-300" dir="ltr">
            {fallbackCmd}
          </pre>
          <button
            type="button"
            onClick={copyCommand}
            className="inline-flex items-center gap-1.5 rounded border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap shrink-0"
          >
            {copiedCmd ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
            {copiedCmd ? 'کپی شد' : 'کپی دستور'}
          </button>
        </div>
      </section>
    </div>
  );
}
