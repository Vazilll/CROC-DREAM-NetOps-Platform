import React from 'react';
import {
  Network,
  Sparkles,
  Sun,
  Moon,
  Globe,
  Shield,
} from 'lucide-react';
import type { UserRole } from '../api';
import { translations, type Locale } from '../i18n';

export type AppTheme = 'dark' | 'light';

interface HeaderProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  userRole: UserRole;
  setUserRole: (role: UserRole) => void;
  apiHealthy: boolean;
  onToggleCopilot: () => void;
  copilotOpen: boolean;
  locale: Locale;
  setLocale: (l: Locale) => void;
  theme: AppTheme;
  setTheme: (t: AppTheme) => void;
  onOpenWelcomeModal?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  userRole,
  apiHealthy,
  onToggleCopilot,
  copilotOpen,
  locale,
  setLocale,
  theme,
  setTheme,
  onOpenWelcomeModal,
}) => {
  const t = translations[locale];

  return (
    <header className="border-b border-white/[0.08] bg-[#07080c]/80 backdrop-blur-2xl sticky top-0 z-50 px-4 sm:px-6 h-14 flex items-center justify-between transition-colors">
      {/* Brand & Connection Status (Aeza Style) */}
      <div className="flex items-center gap-3">
        <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-purple-500 via-indigo-600 to-cyan-500 flex items-center justify-center shadow-lg shadow-purple-600/20">
          <Network className="h-4 w-4 text-white" />
        </div>
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold tracking-tight text-white">
              {t.appName}
            </span>
            <span
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono ${
                apiHealthy
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                  : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  apiHealthy ? 'bg-emerald-400' : 'bg-rose-400'
                }`}
              />
              {apiHealthy ? t.online : t.offline}
            </span>
          </div>
          <span className="text-[10px] text-zinc-500 font-mono hidden sm:inline">
            {t.appSub}
          </span>
        </div>
      </div>

      {/* Right Controls: Only AI Assistant, 1-Click Dark/Light Theme, Language Switcher, and Role Badge */}
      <div className="flex items-center gap-2 sm:gap-3">
        {/* Flagship AI Copilot Button ("ИИ") */}
        <button
          onClick={onToggleCopilot}
          className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-semibold cursor-pointer transition-all duration-200 shadow-sm ${
            copilotOpen
              ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-purple-600/30 scale-105 border border-purple-400/50'
              : 'bg-white/[0.04] hover:bg-white/[0.08] text-purple-200 hover:text-white border border-purple-500/30 hover:border-purple-500/60 shadow-[0_0_15px_rgba(139,92,246,0.12)]'
          }`}
          title={t.aiAssistant}
        >
          <Sparkles className="w-3.5 h-3.5 text-purple-300 animate-pulse" />
          <span className="tracking-wide font-medium">{t.aiCopilot}</span>
          <span className="text-[9px] font-mono uppercase bg-purple-500/20 text-purple-300 px-1.5 py-0.2 rounded border border-purple-500/30">
            Copilot
          </span>
        </button>

        {/* 1-Click Dark / Light Theme Switcher */}
        <button
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-xs text-zinc-300 transition-all cursor-pointer shadow-sm"
          title={theme === 'dark' ? t.themeLight : t.themeDark}
        >
          {theme === 'dark' ? (
            <>
              <Sun className="w-3.5 h-3.5 text-amber-400" />
              <span className="hidden md:inline text-[11px] font-medium">{t.themeLight}</span>
            </>
          ) : (
            <>
              <Moon className="w-3.5 h-3.5 text-indigo-400" />
              <span className="hidden md:inline text-[11px] font-medium">{t.themeDark}</span>
            </>
          )}
        </button>

        {/* Language Switcher (RU / EN) */}
        <button
          onClick={() => setLocale(locale === 'ru' ? 'en' : 'ru')}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-xs text-zinc-300 font-mono transition-colors cursor-pointer"
          title={t.langSwitch}
        >
          <Globe className="w-3.5 h-3.5 text-cyan-400" />
          <span className="font-semibold uppercase tracking-wider text-[11px]">
            {locale === 'ru' ? 'RU' : 'EN'}
          </span>
        </button>

        {/* Role & Connection Badge (Click to open Welcome/Connect modal) */}
        {onOpenWelcomeModal && (
          <button
            onClick={onOpenWelcomeModal}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-[11px] font-mono transition-all cursor-pointer ${
              userRole === 'owner'
                ? 'bg-purple-500/10 border-purple-500/30 text-purple-300 hover:bg-purple-500/20'
                : userRole === 'admin'
                ? 'bg-amber-500/10 border-amber-500/30 text-amber-300 hover:bg-amber-500/20'
                : userRole === 'operator'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/20'
                : 'bg-cyan-500/10 border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/20'
            }`}
            title={t.openWelcome}
          >
            <Shield className="w-3 h-3" />
            <span className="capitalize font-semibold">{userRole}</span>
          </button>
        )}
      </div>
    </header>
  );
};
