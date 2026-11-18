import { AlertTriangle, CheckCircle2, FileCode2, FolderArchive, Loader2, RotateCcw, Upload, X } from 'lucide-react';
import { useState } from 'react';
import type { ArchiveInspection, BackupArchive, PasarGuardServer } from '../types.ts';
import { formatBytes } from '../utils/format.ts';

interface InspectModalProps {
  inspection: ArchiveInspection | null;
  loading: boolean;
  onClose: () => void;
}

export function InspectArchiveModal({ inspection, loading, onClose }: InspectModalProps) {
  if (!loading && !inspection) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-xs">
      <div className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-lg border border-slate-800 bg-[#0F172A]">
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <FolderArchive className="h-4.5 w-4.5 text-sky-400" />
            <h3 className="text-base font-semibold text-slate-100">
              بازرسی محتوای آرشیو بکاپ
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {loading || !inspection ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin text-sky-400" />
              در حال خواندن ساختار فایل‌های داخل آرشیو...
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-800 bg-[#0B1120] p-4">
                <div>
                  <div className="font-mono text-xs text-slate-200" dir="ltr">
                    {inspection.archive.filename}
                  </div>
                  <div className="mt-1 text-xs text-slate-400">
                    حجم فشرده: <span className="font-mono tabular-nums" dir="ltr">{formatBytes(inspection.archive.sizeBytes)}</span>
                    {' · '}
                    حجم غیرفشرده: <span className="font-mono tabular-nums" dir="ltr">{formatBytes(inspection.totalUncompressed)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 text-xs font-medium">
                  {inspection.logEntries.length === 0 ? (
                    <span className="inline-flex items-center gap-1.5 text-emerald-400">
                      <CheckCircle2 className="h-4 w-4" />
                      صفر فایل لاگ در آرشیو (تاییدشده)
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-amber-400">
                      <AlertTriangle className="h-4 w-4" />
                      {inspection.logEntries.length} فایل لاگ شناسایی شد
                    </span>
                  )}
                </div>
              </div>

              <div className="overflow-hidden rounded-md border border-slate-800 bg-[#0B1120]">
                <table className="w-full border-collapse text-right text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-900/60 text-slate-400">
                      <th className="px-4 py-2.5">مسیر فایل داخل آرشیو</th>
                      <th className="px-4 py-2.5 text-left">حجم</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {inspection.entries
                      .filter((e) => e.type === 'File')
                      .map((entry) => (
                        <tr key={entry.path} className="hover:bg-slate-900/50">
                          <td className="px-4 py-2 font-mono text-slate-200" dir="ltr">
                            <span className="inline-flex items-center gap-2">
                              <FileCode2 className="h-3.5 w-3.5 text-slate-500" />
                              {entry.path}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-left font-mono tabular-nums text-slate-400" dir="ltr">
                            {formatBytes(entry.size)}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface RestoreModalProps {
  backup: BackupArchive | null;
  servers: PasarGuardServer[];
  onClose: () => void;
  onConfirmRestore: (backupId: string, targetServerId: string) => Promise<void>;
}

export function RestoreModal({ backup, servers, onClose, onConfirmRestore }: RestoreModalProps) {
  const [targetServerId, setTargetServerId] = useState<string>(
    backup ? servers.find((s) => s.id === backup.serverId)?.id || servers[0]?.id || '' : ''
  );
  const [submitting, setSubmitting] = useState(false);

  if (!backup) return null;

  const effectiveTarget = targetServerId || servers.find((s) => s.id === backup.serverId)?.id || servers[0]?.id || '';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!effectiveTarget) return;
    setSubmitting(true);
    try {
      await onConfirmRestore(backup.id, effectiveTarget);
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-xs">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-lg rounded-lg border border-slate-800 bg-[#0F172A] p-6"
      >
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-2.5">
            <RotateCcw className="h-4.5 w-4.5 text-sky-400" />
            <h3 className="text-base font-semibold text-slate-100">بازیابی بکاپ روی سرور PasarGuard</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 space-y-4">
          <div className="rounded-md border border-slate-800 bg-[#0B1120] p-3.5 text-xs">
            <div className="text-slate-400">آرشیو انتخاب‌شده:</div>
            <div className="mt-1 font-mono text-slate-100" dir="ltr">
              {backup.filename}
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-300">
              انتخاب سرور مقصد برای بازیابی (همان سرور یا انتقال به سرور جدید)
            </label>
            {servers.length === 0 ? (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">
                هیچ سروری متصل نیست. ابتدا در بخش «سرورها و نصب تک‌خطی» سرور مقصد را اضافه و دستور نصب را روی آن اجرا کنید، یا فایل بکاپ را دانلود کرده و با <span className="font-mono">pgbackup restore</span> روی سرور بازیابی نمایید.
              </div>
            ) : (
              <select
                value={effectiveTarget}
                onChange={(e) => setTargetServerId(e.target.value)}
                className="w-full rounded-md border border-slate-800 bg-[#0B1120] px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
              >
                {servers.map((srv) => (
                  <option key={srv.id} value={srv.id}>
                    {srv.name} ({srv.host}) — {srv.status === 'online' ? 'آنلاین' : 'در انتظار اتصال'}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="rounded-md border border-slate-800 bg-[#0B1120] p-3.5 text-xs leading-relaxed text-slate-300">
            <div className="font-semibold text-amber-400">مراحل ایمنی بازیابی خودکار:</div>
            <ol className="mt-1.5 list-inside list-decimal space-y-1 text-slate-400">
              <li>تهیه یک نسخه پشتیبان اضطراری (Pre-Restore Snapshot) از وضعیت فعلی سرور</li>
              <li>توقف امن سرویس‌های داکر PasarGuard و پاکسازی فایل‌های موقت WAL</li>
              <li>جایگزینی <span className="font-mono text-slate-300">.env</span>، دیتابیس، گواهی‌ها و قالب‌ها</li>
              <li>راه‌اندازی مجدد <span className="font-mono text-slate-300">docker compose up -d</span></li>
            </ol>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-3 border-t border-slate-800 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-700 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-800 whitespace-nowrap shrink-0"
          >
            انصراف
          </button>
          <button
            type="submit"
            disabled={submitting || servers.length === 0 || !effectiveTarget}
            className="inline-flex items-center gap-2 rounded-md bg-sky-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-sky-400 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <RotateCcw className="h-4 w-4" />
            {submitting ? 'در حال ارسال دستور...' : 'تایید و ارسال دستور بازیابی'}
          </button>
        </div>
      </form>
    </div>
  );
}

interface UploadModalProps {
  open: boolean;
  servers: PasarGuardServer[];
  onClose: () => void;
  onUpload: (file: File, serverId: string, stripLogs: boolean) => Promise<void>;
}

export function UploadModal({ open, servers, onClose, onUpload }: UploadModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [serverId, setServerId] = useState<string>('uploaded');
  const [stripLogs, setStripLogs] = useState<boolean>(true);
  const [uploading, setUploading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      await onUpload(file, serverId, stripLogs);
      setFile(null);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در آپلود فایل');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-xs">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-lg rounded-lg border border-slate-800 bg-[#0F172A] p-6"
      >
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-2.5">
            <Upload className="h-4.5 w-4.5 text-sky-400" />
            <h3 className="text-base font-semibold text-slate-100">آپلود آرشیو بکاپ PasarGuard</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-300">
              انتخاب فایل فشرده (.tar.gz یا .tgz)
            </label>
            <input
              type="file"
              accept=".tar.gz,.tgz,application/gzip,application/x-gzip"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="w-full rounded-md border border-slate-800 bg-[#0B1120] p-2.5 text-xs text-slate-300 file:ml-3 file:rounded file:border-0 file:bg-slate-800 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-slate-200 hover:file:bg-slate-700"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-300">
              انتساب به سرور (اختیاری)
            </label>
            <select
              value={serverId}
              onChange={(e) => setServerId(e.target.value)}
              className="w-full rounded-md border border-slate-800 bg-[#0B1120] px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
            >
              <option value="uploaded">آرشیو عمومی / مستقل</option>
              {servers.map((srv) => (
                <option key={srv.id} value={srv.id}>
                  {srv.name}
                </option>
              ))}
            </select>
          </div>

          <label className="flex cursor-pointer items-center justify-between gap-3 rounded-md border border-slate-800 bg-[#0B1120] p-3.5">
            <div>
              <div className="text-sm font-medium text-slate-200">پاکسازی خودکار لاگ‌ها هنگام ورود به مخزن</div>
              <div className="mt-0.5 text-xs text-slate-400">
                فایل‌های logs/ و *.log داخل آرشیو قبل از ذخیره حذف می‌شوند.
              </div>
            </div>
            <input
              type="checkbox"
              checked={stripLogs}
              onChange={(e) => setStripLogs(e.target.checked)}
              className="h-4 w-4 rounded border-slate-700 bg-slate-900 accent-emerald-500"
            />
          </label>

          {error && (
            <div className="rounded-md border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300">
              {error}
            </div>
          )}
        </div>

        <div className="mt-6 flex items-center justify-end gap-3 border-t border-slate-800 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-700 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-800 whitespace-nowrap shrink-0"
          >
            انصراف
          </button>
          <button
            type="submit"
            disabled={!file || uploading}
            className="inline-flex items-center gap-2 rounded-md bg-sky-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-sky-400 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <Upload className="h-4 w-4" />
            {uploading ? 'در حال آپلود و بررسی...' : 'آپلود در مخزن'}
          </button>
        </div>
      </form>
    </div>
  );
}
