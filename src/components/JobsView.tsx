import { AlertTriangle, CheckCircle2, Clock, Loader2 } from 'lucide-react';
import type { BackupJob } from '../types.ts';
import { formatDateTimeFa, jobStatusInfo } from '../utils/format.ts';

interface JobsViewProps {
  jobs: BackupJob[];
}

export function JobsView({ jobs }: JobsViewProps) {
  return (
    <section className="overflow-hidden rounded-lg border border-slate-800 bg-[#0F172A]">
      <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
        <div>
          <h2 className="text-base font-semibold text-slate-100">صف عملیات بکاپ و بازیابی سرورها</h2>
          <p className="mt-1 text-xs text-slate-400">
            دستورات ارسالی به ایجنت‌های متصل (بکاپ فوری یا بازیابی آرشیو) و گزارش اجرای آن‌ها در این بخش ثبت می‌شود.
          </p>
        </div>
        <span className="font-mono text-xs tabular-nums text-slate-400">{jobs.length} عملیات</span>
      </div>

      {jobs.length === 0 ? (
        <div className="px-6 py-14 text-center text-sm text-slate-400">
          هنوز هیچ عملیات بکاپ یا بازیابی در صف ثبت نشده است.
        </div>
      ) : (
        <div className="divide-y divide-slate-800">
          {jobs.map((job) => {
            const statusMeta = jobStatusInfo(job.status);
            return (
              <div key={job.id} className="p-5">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    {job.status === 'completed' && <CheckCircle2 className="h-4 w-4 text-emerald-400" />}
                    {job.status === 'failed' && <AlertTriangle className="h-4 w-4 text-rose-400" />}
                    {job.status === 'pending' && <Clock className="h-4 w-4 text-amber-400" />}
                    {job.status === 'running' && <Loader2 className="h-4 w-4 animate-spin text-sky-400" />}

                    <span className="font-semibold text-slate-100">
                      {job.action === 'backup_now' ? 'بکاپ‌گیری بدون لاگ' : 'بازیابی آرشیو بکاپ'}
                    </span>
                    <span className="text-slate-600" aria-hidden="true">·</span>
                    <span className="text-slate-300">{job.serverName}</span>
                    <span className="text-slate-600" aria-hidden="true">·</span>
                    <span className={`text-xs font-medium ${statusMeta.colorClass}`}>
                      {statusMeta.label}
                    </span>
                  </div>
                  <div className="font-mono text-xs tabular-nums text-slate-500">
                    {formatDateTimeFa(job.updatedAt)}
                  </div>
                </div>

                <p className="mt-2 text-xs text-slate-300">{job.message}</p>

                {job.backupFilename && (
                  <div className="mt-1.5 font-mono text-xs text-slate-400" dir="ltr">
                    Archive: {job.backupFilename}
                  </div>
                )}

                {job.outputLog && (
                  <pre
                    className="mt-3 overflow-x-auto rounded-md border border-slate-800 bg-[#0B1120] p-3 font-mono text-xs leading-relaxed text-slate-300"
                    dir="ltr"
                  >
                    {job.outputLog}
                  </pre>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
