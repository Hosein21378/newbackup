import { Check, Save, Send, ShieldAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ExclusionPolicy, TelegramConfig } from '../types.ts';

interface PolicySettingsViewProps {
  policy: ExclusionPolicy;
  telegram: TelegramConfig;
  onSavePolicy: (policy: ExclusionPolicy) => Promise<void>;
  onSaveTelegram: (telegram: TelegramConfig) => Promise<void>;
}

export function PolicySettingsView({
  policy,
  telegram,
  onSavePolicy,
  onSaveTelegram,
}: PolicySettingsViewProps) {
  const [draftPolicy, setDraftPolicy] = useState<ExclusionPolicy>(policy);
  const [draftTelegram, setDraftTelegram] = useState<TelegramConfig>(telegram);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [savingTg, setSavingTg] = useState(false);
  const [savedNotice, setSavedNotice] = useState<'policy' | 'telegram' | null>(null);

  useEffect(() => {
    setDraftPolicy(policy);
  }, [policy]);

  useEffect(() => {
    setDraftTelegram(telegram);
  }, [telegram]);

  const handleSavePolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingPolicy(true);
    try {
      await onSavePolicy(draftPolicy);
      setSavedNotice('policy');
      setTimeout(() => setSavedNotice(null), 2500);
    } finally {
      setSavingPolicy(false);
    }
  };

  const handleSaveTelegram = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingTg(true);
    try {
      await onSaveTelegram(draftTelegram);
      setSavedNotice('telegram');
      setTimeout(() => setSavedNotice(null), 2500);
    } finally {
      setSavingTg(false);
    }
  };

  const toggleInclude = (key: keyof ExclusionPolicy['includePaths']) => {
    setDraftPolicy((prev) => ({
      ...prev,
      includePaths: {
        ...prev.includePaths,
        [key]: !prev.includePaths[key],
      },
    }));
  };

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
      <form
        onSubmit={handleSavePolicy}
        className="space-y-6 rounded-lg border border-slate-800 bg-[#0F172A] p-6 xl:col-span-7"
      >
        <div className="border-b border-slate-800 pb-4">
          <h2 className="text-base font-semibold text-slate-100">
            سیاست بکاپ‌گیری داده‌های مهم و حذف لاگ‌های PasarGuard
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            تنظیمات این بخش مستقیماً در اسکریپت نصب تک‌خطی و ایجنت‌های متصل اعمال می‌شود.
          </p>
        </div>

        {/* Critical Includes */}
        <div>
          <h3 className="text-sm font-medium text-slate-200">داده‌های حیاتی شامل‌شده در بکاپ</h3>
          <div className="mt-3 divide-y divide-slate-800/80 rounded-md border border-slate-800 bg-[#0B1120]">
            {(
              [
                {
                  key: 'database',
                  title: 'دیتابیس اصلی پنل (کاربران، ادمین‌ها، نودها و اینباندها)',
                  path: 'SQLite .backup / mysqldump / pg_dump',
                },
                {
                  key: 'envFile',
                  title: 'فایل متغیرهای محیطی و کلیدهای امنیتی',
                  path: '/opt/pasarguard/.env',
                },
                {
                  key: 'dockerCompose',
                  title: 'پیکربندی سرویس و کانتینرها',
                  path: '/opt/pasarguard/docker-compose.yml',
                },
                {
                  key: 'certs',
                  title: 'گواهی‌های SSL/TLS و کلیدهای خصوصی دامنه‌ها',
                  path: '/var/lib/pasarguard/certs/',
                },
                {
                  key: 'templates',
                  title: 'قالب‌های سفارشی صفحه اشتراک کاربران',
                  path: '/var/lib/pasarguard/templates/',
                },
                {
                  key: 'xrayConfig',
                  title: 'فایل هسته و قوانین مسیریابی Xray-core',
                  path: '/var/lib/pasarguard/xray_config.json',
                },
              ] as const
            ).map((item) => (
              <label
                key={item.key}
                className="flex cursor-pointer items-center justify-between gap-4 px-4 py-3 hover:bg-slate-900/50"
              >
                <div>
                  <div className="text-sm font-medium text-slate-200">{item.title}</div>
                  <div className="mt-0.5 font-mono text-xs text-slate-500" dir="ltr">
                    {item.path}
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={draftPolicy.includePaths[item.key]}
                  onChange={() => toggleInclude(item.key)}
                  className="h-4 w-4 rounded border-slate-700 bg-slate-900 accent-sky-500"
                />
              </label>
            ))}
          </div>
        </div>

        {/* Strict Log Exclusions */}
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-slate-200">
            <ShieldAlert className="h-4 w-4 text-emerald-400" />
            قوانین حذف قطعی لاگ‌ها (Log Exclusion)
          </div>
          <div className="mt-3 divide-y divide-slate-800/80 rounded-md border border-slate-800 bg-[#0B1120]">
            <label className="flex cursor-pointer items-center justify-between gap-4 px-4 py-3 hover:bg-slate-900/50">
              <div>
                <div className="text-sm font-medium text-slate-200">حذف کامل پوشه لاگ‌های Xray و پنل</div>
                <div className="mt-0.5 font-mono text-xs text-slate-500" dir="ltr">
                  --exclude=&quot;/var/lib/pasarguard/logs&quot; (access.log, error.log)
                </div>
              </div>
              <input
                type="checkbox"
                checked={draftPolicy.excludeLogsDir}
                onChange={(e) => setDraftPolicy({ ...draftPolicy, excludeLogsDir: e.target.checked })}
                className="h-4 w-4 rounded border-slate-700 bg-slate-900 accent-emerald-500"
              />
            </label>

            <label className="flex cursor-pointer items-center justify-between gap-4 px-4 py-3 hover:bg-slate-900/50">
              <div>
                <div className="text-sm font-medium text-slate-200">حذف تمامی فایل‌های با پسوند لاگ و چرخش لاگ</div>
                <div className="mt-0.5 font-mono text-xs text-slate-500" dir="ltr">
                  --exclude=&quot;*.log&quot; --exclude=&quot;*.log.*&quot; --exclude=&quot;*.tmp&quot;
                </div>
              </div>
              <input
                type="checkbox"
                checked={draftPolicy.excludeLogExtensions}
                onChange={(e) => setDraftPolicy({ ...draftPolicy, excludeLogExtensions: e.target.checked })}
                className="h-4 w-4 rounded border-slate-700 bg-slate-900 accent-emerald-500"
              />
            </label>

            <label className="flex cursor-pointer items-center justify-between gap-4 px-4 py-3 hover:bg-slate-900/50">
              <div>
                <div className="text-sm font-medium text-slate-200">نادیده‌گرفتن جداول لاگ ترافیک در دامپ MySQL/Postgres</div>
                <div className="mt-0.5 font-mono text-xs text-slate-500" dir="ltr">
                  Skip node_traffic_logs, user_usage_logs, system_logs data
                </div>
              </div>
              <input
                type="checkbox"
                checked={draftPolicy.excludeDbUsageLogs}
                onChange={(e) => setDraftPolicy({ ...draftPolicy, excludeDbUsageLogs: e.target.checked })}
                className="h-4 w-4 rounded border-slate-700 bg-slate-900 accent-emerald-500"
              />
            </label>

            <label className="flex cursor-pointer items-center justify-between gap-4 px-4 py-3 hover:bg-slate-900/50">
              <div>
                <div className="text-sm font-medium text-slate-200">حذف فایل‌های GeoIP و GeoSite جهت کاهش حجم آرشیو</div>
                <div className="mt-0.5 font-mono text-xs text-slate-500" dir="ltr">
                  --exclude=&quot;assets/*.dat&quot;
                </div>
              </div>
              <input
                type="checkbox"
                checked={draftPolicy.excludeGeoAssets}
                onChange={(e) => setDraftPolicy({ ...draftPolicy, excludeGeoAssets: e.target.checked })}
                className="h-4 w-4 rounded border-slate-700 bg-slate-900 accent-sky-500"
              />
            </label>
          </div>
        </div>

        {/* Retention & Schedule */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-300">
              تعداد نگهداری بکاپ محلی روی سرور (Retention)
            </label>
            <input
              type="number"
              min={1}
              max={100}
              value={draftPolicy.retentionCount}
              onChange={(e) =>
                setDraftPolicy({ ...draftPolicy, retentionCount: Math.max(1, Number(e.target.value) || 14) })
              }
              className="w-full rounded-md border border-slate-800 bg-[#0B1120] px-3 py-2 font-mono text-sm tabular-nums text-slate-100 focus:border-sky-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-300">
              زمان‌بندی بکاپ خودکار روزانه (Cron / Systemd)
            </label>
            <div className="flex items-center gap-3">
              <input
                type="text"
                value={draftPolicy.scheduleCron}
                onChange={(e) => setDraftPolicy({ ...draftPolicy, scheduleCron: e.target.value })}
                dir="ltr"
                className="w-full rounded-md border border-slate-800 bg-[#0B1120] px-3 py-2 font-mono text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
              />
              <label className="flex items-center gap-2 text-xs text-slate-300 whitespace-nowrap shrink-0">
                <input
                  type="checkbox"
                  checked={draftPolicy.scheduleEnabled}
                  onChange={(e) => setDraftPolicy({ ...draftPolicy, scheduleEnabled: e.target.checked })}
                  className="h-4 w-4 rounded border-slate-700 bg-slate-900 accent-sky-500"
                />
                فعال
              </label>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-slate-800 pt-4">
          <div className="text-xs text-emerald-400">
            {savedNotice === 'policy' && (
              <span className="inline-flex items-center gap-1.5">
                <Check className="h-4 w-4" />
                تنظیمات فیلتر لاگ و زمان‌بندی ذخیره شد.
              </span>
            )}
          </div>
          <button
            type="submit"
            disabled={savingPolicy}
            className="inline-flex items-center gap-2 rounded-md bg-sky-500 px-5 py-2 text-sm font-medium text-slate-950 hover:bg-sky-400 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <Save className="h-4 w-4" />
            {savingPolicy ? 'در حال ذخیره...' : 'ذخیره تنظیمات بکاپ'}
          </button>
        </div>
      </form>

      {/* Telegram Forwarding Form */}
      <form
        onSubmit={handleSaveTelegram}
        className="flex flex-col justify-between rounded-lg border border-slate-800 bg-[#0F172A] p-6 xl:col-span-5"
      >
        <div className="space-y-4">
          <div className="border-b border-slate-800 pb-4">
            <h2 className="flex items-center gap-2 text-base font-semibold text-slate-100">
              <Send className="h-4 w-4 text-sky-400" />
              ارسال همزمان بکاپ به ربات تلگرام (اختیاری)
            </h2>
            <p className="mt-1 text-xs text-slate-400">
              در صورت فعال‌سازی، ایجنت روی سرور علاوه بر ارسال آرشیو به این پنل، یک کپی بدون لاگ را مستقیم به چت یا کانال تلگرام شما می‌فرستد.
            </p>
          </div>

          <label className="flex cursor-pointer items-center justify-between rounded-md border border-slate-800 bg-[#0B1120] px-4 py-3">
            <span className="text-sm font-medium text-slate-200">ارسال خودکار به ربات تلگرام</span>
            <input
              type="checkbox"
              checked={draftTelegram.enabled}
              onChange={(e) => setDraftTelegram({ ...draftTelegram, enabled: e.target.checked })}
              className="h-4 w-4 rounded border-slate-700 bg-slate-900 accent-sky-500"
            />
          </label>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-300">
              توکن ربات تلگرام (Bot Token)
            </label>
            <input
              type="password"
              value={draftTelegram.botToken}
              onChange={(e) => setDraftTelegram({ ...draftTelegram, botToken: e.target.value })}
              placeholder="123456789:AAH..."
              dir="ltr"
              className="w-full rounded-md border border-slate-800 bg-[#0B1120] px-3 py-2 font-mono text-sm text-slate-100 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-300">
              شناسه چت یا کانال (Chat ID)
            </label>
            <input
              type="text"
              value={draftTelegram.chatId}
              onChange={(e) => setDraftTelegram({ ...draftTelegram, chatId: e.target.value })}
              placeholder="-1001234567890"
              dir="ltr"
              className="w-full rounded-md border border-slate-800 bg-[#0B1120] px-3 py-2 font-mono text-sm text-slate-100 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none"
            />
          </div>
        </div>

        <div className="mt-6 flex items-center justify-between border-t border-slate-800 pt-4">
          <div className="text-xs text-emerald-400">
            {savedNotice === 'telegram' && (
              <span className="inline-flex items-center gap-1.5">
                <Check className="h-4 w-4" />
                تنظیمات تلگرام ذخیره شد.
              </span>
            )}
          </div>
          <button
            type="submit"
            disabled={savingTg}
            className="inline-flex items-center gap-2 rounded-md border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-100 hover:bg-slate-700 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <Save className="h-4 w-4" />
            {savingTg ? 'در حال ذخیره...' : 'ذخیره تنظیمات تلگرام'}
          </button>
        </div>
      </form>
    </div>
  );
}
