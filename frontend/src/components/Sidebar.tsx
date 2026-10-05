import React from 'react';
import {
  Activity,
  LayoutDashboard,
  FlaskConical,
  Layers,
  ShieldCheck,
  Terminal,
} from 'lucide-react';
import { translations, type Locale } from '../i18n';

export interface TabItem {
  groupKey: 'overview' | 'inventory' | 'automation' | 'testing';
  id: string;
  labelKey: 'tabDashboard' | 'tabDevices' | 'tabJobs' | 'tabDiff' | 'tabDrift' | 'tabLab';
  Icon: React.ComponentType<{ className?: string }>;
}

export const TAB_DEFINITIONS: TabItem[] = [
  { groupKey: 'overview', id: 'dashboard', labelKey: 'tabDashboard', Icon: LayoutDashboard },
  { groupKey: 'inventory', id: 'devices', labelKey: 'tabDevices', Icon: Layers },
  { groupKey: 'automation', id: 'jobs', labelKey: 'tabJobs', Icon: Activity },
  { groupKey: 'automation', id: 'diff', labelKey: 'tabDiff', Icon: Terminal },
  { groupKey: 'automation', id: 'drift', labelKey: 'tabDrift', Icon: ShieldCheck },
  { groupKey: 'testing', id: 'lab', labelKey: 'tabLab', Icon: FlaskConical },
];

export const TABS = [
  { group: 'Обзор', id: 'dashboard', label: 'Дашборд', Icon: LayoutDashboard },
  { group: 'Инвентарь', id: 'devices', label: 'Устройства', Icon: Layers },
  { group: 'Автоматизация', id: 'jobs', label: 'Пайплайны', Icon: Activity },
  { group: 'Автоматизация', id: 'diff', label: 'Diff & AI Guard', Icon: Terminal },
  { group: 'Автоматизация', id: 'drift', label: 'Контроль дрейфа', Icon: ShieldCheck },
  { group: 'Тестирование', id: 'lab', label: 'Chaos Lab', Icon: FlaskConical },
];

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
    <aside className="hidden lg:block w-56 shrink-0 border-r border-white/[0.08] bg-[#090a0f]/90 sticky top-14 h-[calc(100vh-3.5rem)] overflow-y-auto py-4 transition-colors select-none">
      {groups.map((g) => (
        <div key={g.title} className="mb-4">
          <div className="px-5 mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 font-mono">
            {g.title}
          </div>
          {g.tabs.map(({ id, labelKey, Icon }) => {
            const isActive = activeTab === id;
            return (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={`w-full flex items-center gap-2.5 px-5 py-2 text-[13px] border-l-2 cursor-pointer transition-all ${
                  isActive
                    ? 'border-cyan-400 bg-white/[0.05] text-white font-semibold shadow-inner'
                    : 'border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.03]'
                }`}
              >
                <Icon
                  className={`w-4 h-4 transition-colors ${
                    isActive ? 'text-cyan-400' : 'text-zinc-500'
                  }`}
                />
                <span>{t[labelKey]}</span>
              </button>
            );
          })}
        </div>
      ))}
    </aside>
  );
};
