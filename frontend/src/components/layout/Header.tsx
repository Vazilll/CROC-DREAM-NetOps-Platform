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
  SlidersHorizontal,
} from 'lucide-react';
import type { UserRole } from '../../api';
import { translations, type Locale } from '../../i18n';

export type AppTheme = 'dark' | 'light';

interface HeaderProps {
  userRole: UserRole;
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

  const ghostBtn =
    'h-8 flex items-center gap-1.5 px-2.5 rounded-md border border-[var(--border-subtle)] hover:border-[var(--border-hover)] bg-[var(--bg-elevated)]/50 hover:bg-[var(--bg-elevated)] text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer';

  return (
    <header className="border-b border-[var(--border-subtle)] bg-[var(--bg-main)]/90 backdrop-blur-md sticky top-0 z-50 px-3 sm:px-5 h-13 flex items-center justify-between gap-2 transition-colors">
      {/* Brand & Connection Status (Geist / Linear Monochrome) */}
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="h-7 w-7 rounded-md bg-[var(--bg-elevated)] border border-[var(--border-subtle)] flex items-center justify-center text-[var(--text-primary)] shrink-0">
          <Network className="h-3.5 w-3.5" />
        </div>
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs sm:text-[13px] font-semibold tracking-tight text-[var(--text-primary)] truncate">
            {t.appName}
          </span>
          <span className="text-[var(--border-hover)] hidden sm:inline">/</span>
          <span className="text-[11px] text-[var(--text-muted)] font-mono hidden md:inline truncate">
            {t.appSub}
          </span>
          <span
            className={`inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded text-[10px] font-mono shrink-0 border ${
              apiHealthy
                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                : 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                apiHealthy ? 'bg-emerald-400' : 'bg-rose-400'
              }`}
            />
            <span className="hidden sm:inline">{apiHealthy ? t.online : t.offline}</span>
          </span>
        </div>
      </div>

      {/* Right Controls: Unified Monochrome Action Strip */}
      <div className="flex items-center gap-1.5 shrink-0">
        {/* AI Copilot Button */}
        <button
          onClick={onToggleCopilot}
          className={`h-8 flex items-center gap-1.5 px-2.5 rounded-md text-xs font-medium cursor-pointer transition-colors border ${
            copilotOpen
              ? 'bg-[var(--text-primary)] text-[var(--bg-main)] border-[var(--text-primary)]'
              : 'bg-[var(--bg-elevated)]/50 hover:bg-[var(--bg-elevated)] text-[var(--text-primary)] border-[var(--border-subtle)] hover:border-[var(--border-hover)]'
          }`}
          title={t.aiAssistant}
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span className="tracking-tight hidden sm:inline">{t.aiCopilot}</span>
          <span
            className={`text-[9px] font-mono uppercase px-1 py-0.2 rounded border ${
              copilotOpen
                ? 'bg-black/15 border-black/20 text-current'
                : 'bg-[var(--bg-subtle)] text-[var(--text-secondary)] border-[var(--border-subtle)]'
            }`}
          >
            AI
          </span>
        </button>

        {/* Share Button */}
        {onOpenShareModal && (
          <button
            onClick={onOpenShareModal}
            className={ghostBtn}
            title={locale === 'en' ? 'Share Canvas (Jury / Team)' : 'Поделиться доступом (Жюри / Команда)'}
          >
            <Share2 className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
            <span className="hidden sm:inline text-[11px] font-medium">
              {locale === 'en' ? 'Share' : 'Поделиться'}
            </span>
          </button>
        )}

        {/* Shortcuts Help Button ('?') */}
        {onOpenShortcutsModal && (
          <button
            onClick={onOpenShortcutsModal}
            className={`hidden sm:flex ${ghostBtn}`}
            title={locale === 'en' ? 'Keyboard Shortcuts & Roles (?)' : 'Горячие клавиши и роли (?)'}
          >
            <HelpCircle className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
            <kbd className="hidden sm:inline text-[10px] font-mono px-1 rounded bg-[var(--bg-subtle)] border border-[var(--border-subtle)] text-[var(--text-muted)]">
              ?
            </kbd>
          </button>
        )}

        {/* Theme Switcher */}
        <button
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className={ghostBtn}
          title={theme === 'dark' ? t.themeLight : t.themeDark}
        >
          {theme === 'dark' ? (
            <>
              <Sun className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
              <span className="hidden md:inline text-[11px] font-medium">{t.themeLight}</span>
            </>
          ) : (
            <>
              <Moon className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
              <span className="hidden md:inline text-[11px] font-medium">{t.themeDark}</span>
            </>
          )}
        </button>

        {/* Language Switcher (RU / EN) */}
        <button
          onClick={() => setLocale(locale === 'ru' ? 'en' : 'ru')}
          className={`${ghostBtn} font-mono`}
          title={t.langSwitch}
        >
          <Globe className="w-3.5 h-3.5 text-[var(--text-muted)]" />
          <span className="font-medium uppercase tracking-wider text-[11px]">
            {locale === 'ru' ? 'RU' : 'EN'}
          </span>
        </button>

        {/* Cluster Settings & Role Button */}
        {onOpenWelcomeModal && (
          <button
            onClick={onOpenWelcomeModal}
            className={`${ghostBtn} font-mono`}
            title={t.openWelcome}
          >
            <SlidersHorizontal className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
            <span className="hidden md:inline text-[11px] text-[var(--text-secondary)]">
              {locale === 'en' ? 'Setup ·' : 'Настройки ·'}
            </span>
            <Shield className="w-3 h-3 text-emerald-500" />
            <span className="capitalize font-medium text-[var(--text-primary)] hidden xs:inline">
              {userRole}
            </span>
          </button>
        )}
      </div>
    </header>
  );
};
