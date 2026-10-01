import React from 'react';
import {
  Network,
  Activity,
  ShieldCheck,
  UserCheck,
  Terminal,
  Layers,
  Presentation,
  FlaskConical,
  Box,
} from 'lucide-react';
import type { UserRole } from '../api';

interface HeaderProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  userRole: UserRole;
  setUserRole: (role: UserRole) => void;
  apiHealthy: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  userRole,
  setUserRole,
  apiHealthy,
}) => {
  return (
    <header className="border-b border-white/[0.08] bg-[#08090c]/90 backdrop-blur-xl sticky top-0 z-50 px-4 md:px-6 py-2.5">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        {/* Brand Logo & System Status */}
        <div className="flex items-center space-x-3.5">
          <div className="h-8 w-8 rounded-lg bg-zinc-900 border border-white/[0.1] flex items-center justify-center shadow-inner">
            <Network className="h-4 w-4 text-cyan-400" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-mono font-bold text-sm tracking-wider text-white">CROC // NETOPS</span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">
                v2.6
              </span>
            </div>
            <div className="flex items-center space-x-1.5 text-[11px] text-zinc-400 font-mono">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
              </span>
              <span>6 Nodes CLOS Active</span>
            </div>
          </div>
        </div>

        {/* Navigation Tabs - Aeza pill group */}
        <nav className="hidden lg:flex items-center space-x-1 bg-zinc-950/80 p-1 rounded-xl border border-white/[0.08]">
          <button
            onClick={() => setActiveTab('slides')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center space-x-1.5 cursor-pointer ${
              activeTab === 'slides'
                ? 'bg-gradient-to-r from-cyan-500/20 to-indigo-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]'
            }`}
          >
            <Presentation className="w-3.5 h-3.5 text-cyan-400" />
            <span className="font-semibold">Слайды & Архитектура</span>
          </button>

          <button
            onClick={() => setActiveTab('3d')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center space-x-1.5 cursor-pointer ${
              activeTab === '3d'
                ? 'bg-zinc-800 text-white border border-white/[0.12] shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]'
            }`}
          >
            <Box className="w-3.5 h-3.5 text-cyan-400" />
            <span>3D Фабрика</span>
          </button>

          <button
            onClick={() => setActiveTab('devices')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center space-x-1.5 cursor-pointer ${
              activeTab === 'devices'
                ? 'bg-zinc-800 text-white border border-white/[0.12] shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Устройства</span>
          </button>

          <button
            onClick={() => setActiveTab('jobs')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center space-x-1.5 cursor-pointer ${
              activeTab === 'jobs'
                ? 'bg-zinc-800 text-white border border-white/[0.12] shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>Пайплайны</span>
          </button>

          <button
            onClick={() => setActiveTab('diff')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center space-x-1.5 cursor-pointer ${
              activeTab === 'diff'
                ? 'bg-zinc-800 text-white border border-white/[0.12] shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]'
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>Diff & AI Guard</span>
          </button>

          <button
            onClick={() => setActiveTab('drift')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center space-x-1.5 cursor-pointer ${
              activeTab === 'drift'
                ? 'bg-zinc-800 text-white border border-white/[0.12] shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Контроль дрейфа</span>
          </button>

          <button
            onClick={() => setActiveTab('lab')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center space-x-1.5 cursor-pointer ${
              activeTab === 'lab'
                ? 'bg-zinc-800 text-white border border-white/[0.12] shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]'
            }`}
          >
            <FlaskConical className="w-3.5 h-3.5 text-amber-400" />
            <span>Chaos Lab</span>
          </button>
        </nav>

        {/* Status & RBAC Selector */}
        <div className="flex items-center space-x-3">
          {/* Mobile Tab Select Dropdown */}
          <div className="lg:hidden">
            <select
              value={activeTab}
              onChange={(e) => setActiveTab(e.target.value)}
              className="bg-zinc-900 border border-white/[0.08] text-xs font-mono text-zinc-200 rounded-lg px-2 py-1"
            >
              <option value="slides">Слайды & Архитектура</option>
              <option value="3d">3D Фабрика</option>
              <option value="devices">Устройства</option>
              <option value="jobs">Пайплайны</option>
              <option value="diff">Diff & AI Guard</option>
              <option value="drift">Контроль дрейфа</option>
              <option value="lab">Chaos Lab</option>
            </select>
          </div>

          {/* API Health Indicator */}
          <div className="flex items-center space-x-1.5 text-[11px] font-mono text-zinc-400">
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                apiHealthy ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]' : 'bg-rose-500 animate-pulse'
              }`}
            />
            <span className="hidden sm:inline">{apiHealthy ? 'API Active' : 'API Down'}</span>
          </div>

          {/* RBAC Selector */}
          <div className="flex items-center space-x-1.5 bg-zinc-900 border border-white/[0.08] rounded-lg px-2 py-1">
            <UserCheck className="w-3 h-3 text-cyan-400" />
            <select
              value={userRole}
              onChange={(e) => setUserRole(e.target.value as UserRole)}
              className="bg-transparent text-[11px] font-mono font-medium text-zinc-200 focus:outline-none cursor-pointer"
            >
              <option value="admin" className="bg-[#08090c] text-zinc-200">
                admin (Full)
              </option>
              <option value="operator" className="bg-[#08090c] text-zinc-200">
                operator (Deploy)
              </option>
              <option value="viewer" className="bg-[#08090c] text-zinc-200">
                viewer (Read-only)
              </option>
            </select>
          </div>
        </div>
      </div>
    </header>
  );
};
