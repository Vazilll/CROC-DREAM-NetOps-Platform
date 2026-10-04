import React, { useEffect, useState } from 'react';
import { AlertOctagon, Network, Presentation, Search, Sparkles, Shield, Activity, HelpCircle } from 'lucide-react';
import { api } from '../api';
import type { UserRole } from '../api';
import { TABS } from './Sidebar';

interface HeaderProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  userRole: UserRole;
  setUserRole: (role: UserRole) => void;
  apiHealthy: boolean;
  onOpenSearch: () => void;
  onToggleCopilot: () => void;
  copilotOpen: boolean;
  onOpenWelcomeModal?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  userRole,
  setUserRole,
  apiHealthy,
  onOpenSearch,
  onToggleCopilot,
  copilotOpen,
  onOpenWelcomeModal,
}) => {
  const [frozen, setFrozen] = useState<boolean>(false);
  const [freezeLoading, setFreezeLoading] = useState<boolean>(false);

  useEffect(() => {
    let mounted = true;
    const fetchFreeze = () => {
      api.getFreezeStatus().then((st) => {
        if (mounted) setFrozen(st.frozen);
      }).catch(() => {});
    };
    fetchFreeze();
    const timer = setInterval(fetchFreeze, 8000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, []);

  const handleToggleFreeze = async () => {
    setFreezeLoading(true);
    try {
      const next = !frozen;
      const res = await api.toggleFreeze(next, next ? 'Активировано оператором в Header' : undefined);
      setFrozen(res.frozen);
    } catch {
      // noop
    } finally {
      setFreezeLoading(false);
    }
  };

  return (
    <header className="border-b border-white/[0.06] bg-[#08090c]/90 backdrop-blur-xl sticky top-0 z-50 px-4 md:px-5 h-14 flex items-center gap-4">

    <div className="flex items-center gap-2.5 lg:w-48 shrink-0">
      <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-cyan-500 to-indigo-600 flex items-center justify-center">
        <Network className="h-4 w-4 text-white" />
      </div>
      <span className="text-sm font-semibold tracking-tight text-white whitespace-nowrap">NetOps Platform</span>
    </div>

    <button
      onClick={onOpenSearch}
      className="hidden sm:flex items-center gap-2 flex-1 max-w-md bg-white/[0.04] hover:bg-white/[0.07] border border-white/[0.06] rounded-md px-3 py-1.5 text-xs text-zinc-500 cursor-pointer"
    >
      <Search className="w-3.5 h-3.5" />
      <span className="flex-1 text-left">Поиск устройств и разделов</span>
      <kbd className="text-[10px] border border-white/[0.12] rounded px-1">Ctrl K</kbd>
    </button>

    <div className="flex items-center gap-3 ml-auto">
      <button
        onClick={() => setActiveTab('slides')}
        className={`hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer transition-colors ${
          activeTab === 'slides'
            ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30'
            : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]'
        }`}
        title="Слайды архитектурного проекта"
      >
        <Presentation className="w-3.5 h-3.5" />
        <span>Архитектура</span>
      </button>

      <select
        value={activeTab}
        onChange={(e) => setActiveTab(e.target.value)}
        className="lg:hidden bg-zinc-900 border border-white/[0.08] text-xs text-zinc-200 rounded-md px-2 py-1"
      >
        {TABS.map((t) => (
          <option key={t.id} value={t.id}>
            {t.label}
          </option>
        ))}
        <option value="slides">Архитектура (слайды)</option>
      </select>

      {frozen ? (
        <button
          onClick={handleToggleFreeze}
          disabled={freezeLoading}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white shadow-[0_0_12px_rgba(225,29,72,0.8)] animate-pulse cursor-pointer transition-all"
          title="Фабрика экстренно заморожена! Нажмите для снятия блокировки."
        >
          <AlertOctagon className="w-3.5 h-3.5" />
          <span>FREEZE: ACTIVE</span>
        </button>
      ) : (
        <button
          onClick={handleToggleFreeze}
          disabled={freezeLoading}
          className="hidden xl:flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium text-zinc-400 border border-white/[0.08] hover:border-rose-500/50 hover:text-rose-400 hover:bg-rose-500/10 cursor-pointer transition-colors"
          title="Экстренная остановка деплоев и устранений дрейфа (Kill Switch)"
        >
          <AlertOctagon className="w-3.5 h-3.5" />
          <span>Freeze Factory</span>
        </button>
      )}

      <button
        onClick={onToggleCopilot}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer transition-colors ${
          copilotOpen ? 'bg-indigo-500 text-white' : 'border border-indigo-400/40 text-indigo-300 hover:bg-indigo-500/10'
        }`}
      >
        <Sparkles className="w-3.5 h-3.5" /> Copilot
      </button>

      {onOpenWelcomeModal && (
        <button
          onClick={onOpenWelcomeModal}
          className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium text-zinc-400 hover:text-cyan-300 hover:bg-white/[0.04] border border-white/[0.08] cursor-pointer transition-colors"
          title="Открыть руководство платформы и выбор роли"
        >
          <HelpCircle className="w-3.5 h-3.5" />
          <span>Гид / Роли</span>
        </button>
      )}

      {/* Styled Role Picker Badge */}
      <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] font-medium transition-all ${
        userRole === 'admin'
          ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
          : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
      }`}>
        {userRole === 'admin' ? (
          <Shield className="w-3.5 h-3.5 text-amber-400" />
        ) : (
          <Activity className="w-3.5 h-3.5 text-emerald-400" />
        )}
        <select
          value={userRole}
          onChange={(e) => {
            const newRole = e.target.value as UserRole;
            setUserRole(newRole);
            if (newRole === 'admin' || newRole === 'operator') {
              api.setRole(newRole);
            }
          }}
          className="bg-transparent text-[11px] font-semibold text-current focus:outline-none cursor-pointer"
        >
          <option value="operator" className="bg-[#0d0f14] text-emerald-400">Оператор</option>
          <option value="admin" className="bg-[#0d0f14] text-amber-400">Администратор</option>
          <option value="viewer" className="bg-[#0d0f14] text-zinc-400">Наблюдатель</option>
        </select>
      </div>

      <div className="flex items-center gap-1.5 text-[11px] text-zinc-400 pl-3 border-l border-white/[0.08]">
        <span
          className={`w-1.5 h-1.5 rounded-full ${
            apiHealthy ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]' : 'bg-rose-500 animate-pulse'
          }`}
        />
        <span className="hidden sm:inline">{apiHealthy ? 'API' : 'API offline'}</span>
      </div>
    </div>
  </header>
  );
};

