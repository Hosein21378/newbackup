import type { BackupTrigger, DbEngine, JobStatus, ServerStatus } from '../types.ts';

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const idx = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / Math.pow(1024, idx);
  return `${val >= 100 || idx === 0 ? val.toFixed(0) : val.toFixed(1)} ${units[idx]}`;
}

export function formatDateTimeFa(iso: string | null): string {
  if (!iso) return '—';
  try {
    const date = new Date(iso);
    return new Intl.DateTimeFormat('fa-IR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  } catch {
    return iso;
  }
}

export function dbEngineLabel(engine: DbEngine): string {
  switch (engine) {
    case 'sqlite':
      return 'SQLite (WAL)';
    case 'mysql':
      return 'MySQL';
    case 'mariadb':
      return 'MariaDB';
    case 'postgres':
      return 'PostgreSQL';
    case 'timescaledb':
      return 'TimescaleDB';
    default:
      return 'نامشخص';
  }
}

export function triggerLabel(trigger: BackupTrigger): string {
  switch (trigger) {
    case 'manual':
      return 'دستی از پنل';
    case 'scheduled':
      return 'زمان‌بندی خودکار';
    case 'upload':
      return 'آپلود آرشیو';
    case 'pre_restore':
      return 'اسنپ‌شات پیش از بازیابی';
    case 'sandbox_test':
      return 'تست ساختار ایزوله';
  }
}

export function serverStatusInfo(status: ServerStatus): { label: string; colorClass: string } {
  switch (status) {
    case 'online':
      return { label: 'متصل و آماده', colorClass: 'text-emerald-400' };
    case 'pending':
      return { label: 'در انتظار اجرای دستور نصب', colorClass: 'text-amber-400' };
    case 'offline':
      return { label: 'عدم دریافت سیگنال', colorClass: 'text-rose-400' };
  }
}

export function jobStatusInfo(status: JobStatus): { label: string; colorClass: string } {
  switch (status) {
    case 'pending':
      return { label: 'در صف انتظار', colorClass: 'text-amber-400' };
    case 'running':
      return { label: 'در حال اجرا روی سرور', colorClass: 'text-sky-400' };
    case 'completed':
      return { label: 'تکمیل‌شده', colorClass: 'text-emerald-400' };
    case 'failed':
      return { label: 'ناموفق', colorClass: 'text-rose-400' };
  }
}
