import React from 'react';
import { translations, type Locale } from '../../i18n';
import { TAB_DEFINITIONS, type TabItem } from '../../constants';

export type { TabItem };

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  locale?: Locale;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  setActiveTab,
  locale = 'ru',
}) => {
  const t = translations[locale];

  const groups = [
    {
      title: t.groupOverview,
      tabs: TAB_DEFINITIONS.filter((item) => item.groupKey === 'overview'),
    },
    {
      title: t.groupInventory,
      tabs: TAB_DEFINITIONS.filter((item) => item.groupKey === 'inventory'),
    },
    {
      title: t.groupAutomation,
      tabs: TAB_DEFINITIONS.filter((item) => item.groupKey === 'automation'),
    },
    {
      title: t.groupTesting,
      tabs: TAB_DEFINITIONS.filter((item) => item.groupKey === 'testing'),
    },
  ];

  return (
    <aside className="hidden lg:flex flex-col justify-between w-56 2xl:w-64 shrink-0 border-r border-[var(--border-subtle)] bg-[var(--bg-main)] sticky top-13 h-[calc(100dvh-3.25rem)] overflow-y-auto py-3.5 px-2.5 transition-colors select-none">
      <nav className="space-y-5" aria-label="Primary Navigation">
        {groups.map((g) => (
          <div key={g.title}>
            <div className="px-2.5 mb-1.5 text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)] font-mono">
              {g.title}
            </div>
            <div className="space-y-0.5">
              {g.tabs.map(({ id, labelKey, Icon }) => {
                const isActive = activeTab === id;
                return (
                  <button
                    key={id}
                    onClick={() => setActiveTab(id)}
                    className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[13px] cursor-pointer transition-colors ${
                      isActive
                        ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)] font-medium border border-[var(--border-subtle)]'
                        : 'border border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-subtle)]'
                    }`}
                  >
                    <Icon
                      className={`w-3.5 h-3.5 shrink-0 transition-colors ${
                        isActive ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'
                      }`}
                    />
                    <span className="truncate">{t[labelKey]}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Bottom Keyboard Hint Strip */}
      <div className="pt-3 mt-4 border-t border-[var(--border-subtle)] px-2.5 flex items-center justify-between text-[11px] text-[var(--text-muted)] font-mono">
        <span>Command Palette</span>
        <kbd className="px-1.5 py-0.5 rounded bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[10px] text-[var(--text-secondary)]">
          Ctrl+K
        </kbd>
      </div>
    </aside>
  );
};
