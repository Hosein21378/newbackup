import { Menu, Plus, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { BackupsView } from './components/BackupsView.tsx';
import { JobsView } from './components/JobsView.tsx';
import { InspectArchiveModal, RestoreModal, UploadModal } from './components/Modals.tsx';
import { PolicySettingsView } from './components/PolicySettingsView.tsx';
import { ServersInstallView } from './components/ServersInstallView.tsx';
import { Sidebar, type NavTab } from './components/Sidebar.tsx';
import type {
  ArchiveInspection,
  BackupArchive,
  DbEngine,
  ExclusionPolicy,
  TelegramConfig,
  VaultStateResponse,
} from './types.ts';

interface ToastMessage {
  id: number;
  text: string;
  tone: 'success' | 'error';
}

const TAB_TITLES: Record<NavTab, string> = {
  backups: 'مخزن بکاپ و بازیابی',
  servers: 'سرورها و نصب تک‌خطی',
  policy: 'فیلتر لاگ و زمان‌بندی',
  jobs: 'صف عملیات سرور',
};

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('backups');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [state, setState] = useState<VaultStateResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyActionId, setBusyActionId] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<BackupArchive | null>(null);
  const [inspectionData, setInspectionData] = useState<ArchiveInspection | null>(null);
  const [inspectLoading, setInspectLoading] = useState(false);
  const [deleteCandidate, setDeleteCandidate] = useState<
    { type: 'backup'; id: string; label: string } | { type: 'server'; id: string; label: string } | null
  >(null);

  const showToast = useCallback((text: string, tone: 'success' | 'error' = 'success') => {
    const id = Date.now();
    setToast({ id, text, tone });
    setTimeout(() => {
      setToast((curr) => (curr?.id === id ? null : curr));
    }, 3500);
  }, []);

  const fetchState = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      const res = await fetch('/api/state');
      if (!res.ok) throw new Error('خطا در دریافت اطلاعات پنل');
      const data = (await res.json()) as VaultStateResponse;
      const browserOrigin = typeof window !== 'undefined' ? window.location.origin : '';
      const resolvedUrl =
        data.panelUrl && !data.panelUrl.includes('localhost') && !data.panelUrl.includes('127.0.0.1')
          ? data.panelUrl
          : browserOrigin || data.panelUrl;
      setState({ ...data, panelUrl: resolvedUrl });
    } catch (err) {
      if (manual) {
        showToast(err instanceof Error ? err.message : 'خطا در اتصال به سرور', 'error');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [showToast]);

  useEffect(() => {
    void fetchState(false);
    const timer = setInterval(() => {
      void fetchState(false);
    }, 5000);
    return () => clearInterval(timer);
  }, [fetchState]);

  const handleAddServer = async (payload: {
    name: string;
    host: string;
    optPath: string;
    dataPath: string;
    dbEngine: DbEngine;
  }) => {
    const res = await fetch('/api/servers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'خطا در ثبت سرور', 'error');
      return;
    }
    await fetchState(false);
    showToast(`سرور «${payload.name}» ثبت شد. دستور نصب تک‌خطی آماده کپی است.`);
  };

  const handleTriggerBackup = async (serverId: string) => {
    setBusyActionId(`backup:${serverId}`);
    try {
      const res = await fetch(`/api/servers/${serverId}/backup`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'خطا در ثبت دستور بکاپ', 'error');
        return;
      }
      await fetchState(false);
      showToast('دستور بکاپ بدون لاگ در صف سرور ثبت شد.');
    } finally {
      setBusyActionId(null);
    }
  };

  const handleRunSandboxBackup = async (serverId: string) => {
    setBusyActionId(`sandbox:${serverId}`);
    try {
      const res = await fetch(`/api/servers/${serverId}/sandbox-backup`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'خطا در تست ساخت بکاپ', 'error');
        return;
      }
      await fetchState(false);
      showToast(
        `بکاپ آزمایشی بدون لاگ ساخته شد (${data.excludedLogFiles?.length || 0} فایل لاگ حذف گردید).`
      );
    } finally {
      setBusyActionId(null);
    }
  };

  const handleUploadArchive = async (file: File, serverId: string, stripLogs: boolean) => {
    const formData = new FormData();
    formData.append('archive', file);
    formData.append('serverId', serverId);
    formData.append('stripLogs', stripLogs ? 'true' : 'false');

    const res = await fetch('/api/backups/upload', {
      method: 'POST',
      body: formData,
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'خطا در آپلود آرشیو');
    }
    await fetchState(false);
    showToast('آرشیو بکاپ با موفقیت در مخزن ثبت و بررسی شد.');
  };

  const handleInspectArchive = async (backup: BackupArchive) => {
    setInspectLoading(true);
    setInspectionData(null);
    try {
      const res = await fetch(`/api/backups/${backup.id}/contents`);
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'خطا در خواندن محتوای آرشیو', 'error');
        return;
      }
      setInspectionData(data as ArchiveInspection);
    } finally {
      setInspectLoading(false);
    }
  };

  const handleConfirmRestore = async (backupId: string, targetServerId: string) => {
    const res = await fetch(`/api/backups/${backupId}/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetServerId }),
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'خطا در ارسال دستور بازیابی', 'error');
      return;
    }
    await fetchState(false);
    setActiveTab('jobs');
    showToast('دستور بازیابی امن در صف عملیات سرور قرار گرفت.');
  };

  const handleExecuteDelete = async () => {
    if (!deleteCandidate) return;
    const target = deleteCandidate;
    setDeleteCandidate(null);
    const url = target.type === 'backup' ? `/api/backups/${target.id}` : `/api/servers/${target.id}`;
    const res = await fetch(url, { method: 'DELETE' });
    if (!res.ok) {
      showToast('خطا در حذف مورد انتخاب‌شده', 'error');
      return;
    }
    await fetchState(false);
    showToast(target.type === 'backup' ? 'آرشیو بکاپ حذف شد.' : 'سرور از فهرست حذف شد.');
  };

  const handleSavePolicy = async (policy: ExclusionPolicy) => {
    const res = await fetch('/api/policy', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(policy),
    });
    if (!res.ok) {
      showToast('خطا در ذخیره تنظیمات فیلتر', 'error');
      return;
    }
    await fetchState(false);
    showToast('سیاست بکاپ‌گیری و حذف لاگ‌ها ذخیره شد.');
  };

  const handleSaveTelegram = async (telegram: TelegramConfig) => {
    const res = await fetch('/api/telegram', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(telegram),
    });
    if (!res.ok) {
      showToast('خطا در ذخیره تنظیمات تلگرام', 'error');
      return;
    }
    await fetchState(false);
    showToast('تنظیمات ربات تلگرام ذخیره شد.');
  };

  const activeJobsCount =
    state?.jobs.filter((j) => j.status === 'pending' || j.status === 'running').length ?? 0;

  return (
    <div className="flex min-h-screen bg-[#0B1120] text-slate-100">
      <Sidebar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        backupsCount={state?.backups.length ?? 0}
        serversCount={state?.servers.length ?? 0}
        activeJobsCount={activeJobsCount}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top Bar Contract: Breadcrumb on right (RTL start), concise actions on left (RTL end) */}
        <header className="flex h-16 items-center justify-between gap-4 border-b border-slate-800 bg-[#0F172A]/80 px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="rounded-md border border-slate-800 p-2 text-slate-400 hover:bg-slate-800 hover:text-slate-100 lg:hidden"
              aria-label="باز کردن منو"
            >
              <Menu className="h-4 w-4" />
            </button>
            <div className="flex items-center gap-2 text-sm truncate">
              <span className="text-slate-500 whitespace-nowrap">PasarGuard/panel</span>
              <span className="text-slate-700" aria-hidden="true">/</span>
              <h1 className="font-semibold text-slate-100 truncate">{TAB_TITLES[activeTab]}</h1>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => void fetchState(true)}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-800 bg-[#0B1120] px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              بروزرسانی
            </button>
            {activeTab !== 'servers' && (
              <button
                type="button"
                onClick={() => setActiveTab('servers')}
                className="inline-flex items-center gap-1.5 rounded-md bg-sky-500 px-3.5 py-1.5 text-xs font-medium text-slate-950 hover:bg-sky-400 whitespace-nowrap shrink-0"
              >
                <Plus className="h-3.5 w-3.5" />
                نصب تک‌خطی سرور
              </button>
            )}
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1440px] flex-1 p-6">
          {loading || !state ? (
            <div className="space-y-4">
              <div className="h-24 animate-pulse rounded-lg border border-slate-800 bg-[#0F172A]" />
              <div className="h-64 animate-pulse rounded-lg border border-slate-800 bg-[#0F172A]" />
            </div>
          ) : (
            <>
              {activeTab === 'backups' && (
                <BackupsView
                  backups={state.backups}
                  servers={state.servers}
                  panelUrl={state.panelUrl}
                  busyActionId={busyActionId}
                  onTriggerBackup={handleTriggerBackup}
                  onRunSandboxBackup={handleRunSandboxBackup}
                  onOpenUploadModal={() => setUploadModalOpen(true)}
                  onInspectArchive={handleInspectArchive}
                  onOpenRestoreModal={setRestoreTarget}
                  onDeleteArchive={(b) =>
                    setDeleteCandidate({ type: 'backup', id: b.id, label: b.filename })
                  }
                  onNavigateServers={() => setActiveTab('servers')}
                />
              )}

              {activeTab === 'servers' && (
                <ServersInstallView
                  servers={state.servers}
                  panelUrl={state.panelUrl}
                  busyActionId={busyActionId}
                  onAddServer={handleAddServer}
                  onDeleteServer={(id) => {
                    const srv = state.servers.find((s) => s.id === id);
                    if (srv) setDeleteCandidate({ type: 'server', id: srv.id, label: srv.name });
                  }}
                  onTriggerBackup={handleTriggerBackup}
                  onRunSandboxBackup={handleRunSandboxBackup}
                />
              )}

              {activeTab === 'policy' && (
                <PolicySettingsView
                  policy={state.policy}
                  telegram={state.telegram}
                  onSavePolicy={handleSavePolicy}
                  onSaveTelegram={handleSaveTelegram}
                />
              )}

              {activeTab === 'jobs' && <JobsView jobs={state.jobs} />}
            </>
          )}
        </main>
      </div>

      {/* Modals */}
      <InspectArchiveModal
        inspection={inspectionData}
        loading={inspectLoading}
        onClose={() => {
          setInspectLoading(false);
          setInspectionData(null);
        }}
      />

      <RestoreModal
        backup={restoreTarget}
        servers={state?.servers ?? []}
        onClose={() => setRestoreTarget(null)}
        onConfirmRestore={handleConfirmRestore}
      />

      <UploadModal
        open={uploadModalOpen}
        servers={state?.servers ?? []}
        onClose={() => setUploadModalOpen(false)}
        onUpload={handleUploadArchive}
      />

      {deleteCandidate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-lg border border-slate-800 bg-[#0F172A] p-6">
            <h3 className="text-base font-semibold text-slate-100">تایید حذف</h3>
            <p className="mt-2 text-sm text-slate-400">
              آیا از حذف{' '}
              <span className="font-mono text-slate-200" dir="ltr">
                {deleteCandidate.label}
              </span>{' '}
              اطمینان دارید؟ این عملیات قابل بازگشت نیست.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setDeleteCandidate(null)}
                className="rounded-md border border-slate-700 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-800"
              >
                انصراف
              </button>
              <button
                type="button"
                onClick={() => void handleExecuteDelete()}
                className="rounded-md bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-500"
              >
                حذف قطعی
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Non-blocking Toast */}
      {toast && (
        <div
          className={`fixed bottom-5 left-5 z-50 rounded-md border px-4 py-3 text-sm font-medium shadow-lg ${
            toast.tone === 'error'
              ? 'border-rose-500/40 bg-rose-950/90 text-rose-200'
              : 'border-emerald-500/40 bg-slate-900 text-emerald-300'
          }`}
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}
