import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import type { Device } from '../api';
import { TABS } from './Sidebar';

interface Props {
  open: boolean;
  onClose: () => void;
  devices: Device[];
  onOpenDevice: (id: number) => void;
  onOpenTab: (tab: string) => void;
}

export const CommandPalette: React.FC<Props> = ({ open, onClose, devices, onOpenDevice, onOpenTab }) => {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = [
      ...devices.map((d) => ({ key: `d${d.id}`, label: d.hostname, hint: d.management_ip, run: () => onOpenDevice(d.id) })),
      ...TABS.map((t) => ({ key: t.id, label: t.label, hint: 'Раздел', run: () => onOpenTab(t.id) })),
    ];
    return all.filter((i) => !q || `${i.label} ${i.hint}`.toLowerCase().includes(q)).slice(0, 8);
  }, [query, devices, onOpenDevice, onOpenTab]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setIndex(0);
      input.current?.focus();
    }
  }, [open]);

  if (!open) return null;

  const pick = (i: number) => {
    items[i]?.run();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/60 flex items-start justify-center pt-24" onClick={onClose}>
      <div className="w-[520px] max-w-[92vw] rounded-xl bg-[#0c0e14] border border-white/[0.1] shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 border-b border-white/[0.06]">
          <Search className="w-4 h-4 text-zinc-500" />
          <input
            ref={input}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') setIndex((i) => Math.min(i + 1, items.length - 1));
              else if (e.key === 'ArrowUp') setIndex((i) => Math.max(i - 1, 0));
              else if (e.key === 'Enter') pick(index);
              else if (e.key === 'Escape') onClose();
            }}
            placeholder="Устройство, IP или раздел"
            className="flex-1 bg-transparent py-3 text-sm text-zinc-100 focus:outline-none"
          />
        </div>
        <ul className="py-1">
          {items.map((it, i) => (
            <li key={it.key}>
              <button
                onMouseEnter={() => setIndex(i)}
                onClick={() => pick(i)}
                className={`w-full flex justify-between px-4 py-2 text-[13px] cursor-pointer ${i === index ? 'bg-white/[0.06] text-white' : 'text-zinc-300'}`}
              >
                <span>{it.label}</span>
                <span className="text-xs text-zinc-500 font-mono">{it.hint}</span>
              </button>
            </li>
          ))}
          {items.length === 0 && <li className="px-4 py-6 text-center text-sm text-zinc-500">Ничего не найдено</li>}
        </ul>
      </div>
    </div>
  );
};
