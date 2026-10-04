import React from 'react';
import { Activity, LayoutDashboard, FlaskConical, Layers, ShieldCheck, Terminal, ShieldAlert } from 'lucide-react';

export const TABS = [
  { group: 'Обзор', id: 'dashboard', label: 'Дашборд', Icon: LayoutDashboard },
  { group: 'Инвентарь', id: 'devices', label: 'Устройства', Icon: Layers },
  { group: 'Автоматизация', id: 'jobs', label: 'Пайплайны', Icon: Activity },
  { group: 'Автоматизация', id: 'diff', label: 'Diff & AI Guard', Icon: Terminal },
  { group: 'Автоматизация', id: 'drift', label: 'Контроль дрейфа', Icon: ShieldCheck },
  { group: 'Безопасность', id: 'emergency', label: 'Аварийный пульт', Icon: ShieldAlert },
  { group: 'Тестирование', id: 'lab', label: 'Chaos Lab', Icon: FlaskConical },
];

const GROUPS = [...new Set(TABS.map((t) => t.group))];

export const Sidebar: React.FC<{ activeTab: string; setActiveTab: (tab: string) => void }> = ({
  activeTab,
  setActiveTab,
}) => (
  <aside className="hidden lg:block w-56 shrink-0 border-r border-white/[0.06] bg-[#0a0b0f] sticky top-14 h-[calc(100vh-3.5rem)] overflow-y-auto py-4">
    {GROUPS.map((g) => (
      <div key={g} className="mb-4">
        <div className="px-5 mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">{g}</div>
        {TABS.filter((t) => t.group === g).map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`w-full flex items-center gap-2.5 px-5 py-2 text-[13px] border-l-2 cursor-pointer transition-colors ${
              activeTab === id
                ? 'border-cyan-400 bg-white/[0.04] text-white font-medium'
                : 'border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.03]'
            }`}
          >
            <Icon className={`w-4 h-4 ${activeTab === id ? 'text-cyan-400' : ''}`} />
            {label}
          </button>
        ))}
      </div>
    ))}
  </aside>
);
