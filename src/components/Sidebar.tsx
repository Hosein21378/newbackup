import { Activity, Archive, Server, ShieldCheck, SlidersHorizontal, X } from 'lucide-react';

export type NavTab = 'backups' | 'servers' | 'policy' | 'jobs';

interface SidebarProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  backupsCount: number;
  serversCount: number;
  activeJobsCount: number;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

export function Sidebar({
  activeTab,
  onSelectTab,
  backupsCount,
  serversCount,
  activeJobsCount,
  mobileOpen,
  onCloseMobile,
}: SidebarProps) {
  const navItems: Array<{
    id: NavTab;
    label: string;
    icon: typeof Archive;
    count?: number;
  }> = [
    { id: 'backups', label: 'مخزن بکاپ و بازیابی', icon: Archive, count: backupsCount },
    { id: 'servers', label: 'سرورها و نصب تک‌خطی', icon: Server, count: serversCount },
    { id: 'policy', label: 'فیلتر لاگ و زمان‌بندی', icon: SlidersHorizontal },
    { id: 'jobs', label: 'صف عملیات سرور', icon: Activity, count: activeJobsCount > 0 ? activeJobsCount : undefined },
  ];

  const handleSelect = (id: NavTab) => {
    onSelectTab(id);
    onCloseMobile();
  };

  return (
    <>
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-950/70 backdrop-blur-xs lg:hidden"
          onClick={onCloseMobile}
        />
      )}
      <aside
        className={`fixed inset-y-0 right-0 z-50 flex w-64 flex-col border-l border-slate-800 bg-[#0F172A] transition-transform duration-200 lg:static lg:translate-x-0 ${
          mobileOpen ? 'translate-x-0' : 'translate-x-full lg:translate-x-0'
        }`}
      >
        <div className="flex h-16 items-center justify-between border-b border-slate-800 px-5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-md border border-sky-500/30 bg-sky-500/10 text-sky-400">
              <ShieldCheck className="h-4.5 w-4.5" />
            </div>
            <span className="text-base font-bold tracking-tight text-slate-100 whitespace-nowrap">
              PasarGuard Vault
            </span>
          </div>
          <button
            type="button"
            onClick={onCloseMobile}
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100 lg:hidden"
            aria-label="بستن منو"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 p-3">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelect(item.id)}
                className={`flex w-full items-center justify-between rounded-md px-3.5 py-2.5 text-sm font-medium transition-colors whitespace-nowrap ${
                  isActive
                    ? 'bg-sky-500/12 text-sky-300 border border-sky-500/25'
                    : 'text-slate-400 border border-transparent hover:bg-slate-800/60 hover:text-slate-200'
                }`}
              >
                <span className="flex items-center gap-2.5 truncate">
                  <Icon className={`h-4 w-4 shrink-0 ${isActive ? 'text-sky-400' : 'text-slate-500'}`} />
                  <span className="truncate">{item.label}</span>
                </span>
                {typeof item.count === 'number' && (
                  <span className="font-mono text-xs tabular-nums text-slate-400">
                    {item.count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="border-t border-slate-800 p-4 text-xs leading-relaxed text-slate-400">
          <div className="font-medium text-slate-300">پشتیبانی اختصاصی PasarGuard</div>
          <p className="mt-1 text-slate-500">
            پشتیبان‌گیری از دیتابیس، <span className="font-mono text-slate-400">.env</span>، گواهی‌ها و قالب‌ها با حذف کامل پوشه لاگ‌ها.
          </p>
        </div>
      </aside>
    </>
  );
}
