import React from 'react';
import { Network, Presentation, Search, Sparkles, UserCheck } from 'lucide-react';
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
}) => (
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

      <button
        onClick={onToggleCopilot}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer transition-colors ${
          copilotOpen ? 'bg-indigo-500 text-white' : 'border border-indigo-400/40 text-indigo-300 hover:bg-indigo-500/10'
        }`}
      >
        <Sparkles className="w-3.5 h-3.5" /> Copilot
      </button>

      <div className="flex items-center gap-1.5 bg-white/[0.04] rounded-md px-2 py-1">
        <UserCheck className="w-3 h-3 text-zinc-400" />
        <select
          value={userRole}
          onChange={(e) => setUserRole(e.target.value as UserRole)}
          className="bg-transparent text-[11px] font-medium text-zinc-200 focus:outline-none cursor-pointer"
        >
          <option value="admin" className="bg-[#08090c]">admin</option>
          <option value="operator" className="bg-[#08090c]">operator</option>
          <option value="viewer" className="bg-[#08090c]">viewer</option>
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
