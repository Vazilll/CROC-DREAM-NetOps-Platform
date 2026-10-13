import React from 'react';
import {
  Network,
  Sparkles,
  Sun,
  Moon,
  Globe,
  Shield,
  Share2,
  HelpCircle,
} from 'lucide-react';
import type { UserRole } from '../api';
import { translations, type Locale } from '../i18n';

export type AppTheme = 'dark' | 'light';

interface HeaderProps {
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
  onOpenShareModal?: () => void;
  onOpenShortcutsModal?: () => void;
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
  onOpenShareModal,
  onOpenShortcutsModal,
}) => {
  const t = translations[locale];

  return (
    <header className="border-b border-white/[0.08] bg-[#07080c]/85 backdrop-blur-2xl sticky top-0 z-50 px-4 sm:px-6 h-14 flex items-center justify-between transition-colors">
      {/* Brand & Connection Status (Aeza Obsidian Style) */}
      <div className="flex items-center gap-3">
        <div className="h-8 w-8 rounded-xl bg-slate-100 dark:bg-[#12141c] border border-slate-200 dark:border-white/[0.1] flex items-center justify-center text-slate-700 dark:text-zinc-200 shadow-sm">
          <Network className="h-4 w-4 text-slate-700 dark:text-zinc-300" />
        </div>
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold tracking-tight text-white">
              {t.appName}
            </span>
            <span
              className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono ${
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

      {/* Right Controls: AI Assistant, Theme, Language, Share, and Role Badge */}
      <div className="flex items-center gap-1.5 sm:gap-2.5">
        {/* Flagship AI Copilot Button ("ИИ") */}
        <button
          onClick={onToggleCopilot}
          className={`flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1.5 rounded-xl text-xs font-medium cursor-pointer transition-all duration-200 shadow-sm ${
            copilotOpen
              ? 'bg-white/[0.12] text-white border border-white/[0.22] shadow-sm'
              : 'bg-white/[0.04] hover:bg-white/[0.08] text-zinc-300 hover:text-white border border-white/[0.08] hover:border-white/[0.14]'
          }`}
          title={t.aiAssistant}
        >
          <Sparkles className="w-3.5 h-3.5 text-zinc-300" />
          <span className="tracking-tight font-medium hidden sm:inline">{t.aiCopilot}</span>
          <span className="text-[9px] font-mono uppercase bg-white/[0.08] text-zinc-300 px-1 sm:px-1.5 py-0.5 rounded border border-white/[0.1]">
            AI
          </span>
        </button>

        {/* Share Button (Jury / Team Link Generator) */}
        {onOpenShareModal && (
          <button
            onClick={onOpenShareModal}
            className="flex items-center gap-1.5 p-1.5 sm:px-3 sm:py-1.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-xs text-zinc-300 hover:text-white transition-all cursor-pointer shadow-sm hover:border-white/[0.15]"
            title={locale === 'en' ? 'Share Canvas (Jury / Team)' : 'Поделиться доступом (Жюри / Команда)'}
          >
            <Share2 className="w-3.5 h-3.5 text-emerald-400" />
            <span className="hidden sm:inline text-[11px] font-medium">
              {locale === 'en' ? 'Share' : 'Поделиться'}
            </span>
          </button>
        )}

        {/* Shortcuts Help Button ('?') */}
        {onOpenShortcutsModal && (
          <button
            onClick={onOpenShortcutsModal}
            className="flex items-center gap-1 p-1.5 sm:px-2.5 sm:py-1.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-xs text-zinc-300 hover:text-white transition-all cursor-pointer shadow-sm hover:border-white/[0.15]"
            title={locale === 'en' ? 'Keyboard Shortcuts & Roles (?)' : 'Горячие клавиши и роли (?)'}
          >
            <HelpCircle className="w-3.5 h-3.5 text-cyan-400" />
            <kbd className="hidden sm:inline text-[10px] font-mono px-1 py-0.2 bg-white/[0.06] rounded border border-white/[0.1] text-zinc-400">
              ?
            </kbd>
          </button>
        )}

        {/* 1-Click Dark / Light Theme Switcher */}
        <button
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className="flex items-center gap-1.5 p-1.5 sm:px-2.5 sm:py-1.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-xs text-zinc-300 transition-all cursor-pointer shadow-sm"
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
          className="flex items-center gap-1 p-1.5 sm:px-2.5 sm:py-1.5 rounded-xl bg-black/5 dark:bg-white/[0.04] hover:bg-black/10 dark:hover:bg-white/[0.08] border border-slate-200 dark:border-white/[0.08] text-xs text-slate-700 dark:text-zinc-300 font-mono transition-colors cursor-pointer"
          title={t.langSwitch}
        >
          <Globe className="w-3.5 h-3.5 text-slate-500 dark:text-zinc-400" />
          <span className="font-semibold uppercase tracking-wider text-[11px]">
            {locale === 'ru' ? 'RU' : 'EN'}
          </span>
        </button>

        {/* Role & Connection Badge (Click to open Welcome/Connect modal) */}
        {onOpenWelcomeModal && (
          <button
            onClick={onOpenWelcomeModal}
            className={`flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1.5 rounded-xl border text-[11px] font-mono transition-all cursor-pointer ${
              userRole === 'owner'
                ? 'bg-slate-100 dark:bg-zinc-800/60 border-slate-200 dark:border-zinc-700/60 text-slate-800 dark:text-zinc-200 hover:bg-slate-200 dark:hover:bg-zinc-750'
                : userRole === 'admin'
                ? 'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20'
                : userRole === 'operator'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20'
                : 'bg-cyan-500/10 border-cyan-500/30 text-cyan-700 dark:text-cyan-300 hover:bg-cyan-500/20'
            }`}
            title={t.openWelcome}
          >
            <Shield className="w-3 h-3" />
            <span className="capitalize font-semibold hidden xs:inline">{userRole}</span>
          </button>
        )}
      </div>
    </header>
  );
};
