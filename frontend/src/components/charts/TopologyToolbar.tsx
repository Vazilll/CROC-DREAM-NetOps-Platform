import React from 'react';
import { Layers, Plus, RefreshCw, Search, X } from 'lucide-react';
import { LAYER_FILTERS } from './topologyLayout';

export interface TopologyToolbarProps {
  activeLayer: string;
  onSelectLayer: (layer: string) => void;
  onSyncStands?: () => void;
  syncingStands: boolean;
  onOpenStandsModal?: () => void;
  standCount: number;
  searchQuery: string;
  onSearchChange: (q: string) => void;
}

export const TopologyToolbar: React.FC<TopologyToolbarProps> = ({
  activeLayer,
  onSelectLayer,
  onSyncStands,
  syncingStands,
  onOpenStandsModal,
  standCount,
  searchQuery,
  onSearchChange,
}) => {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 pb-1">
      <div className="flex flex-wrap items-center gap-1" data-testid="topology-layer-tabs">
        <Layers className="w-3.5 h-3.5 text-zinc-400 mr-1" />
        {LAYER_FILTERS.map((lf) => (
          <button
            key={lf.id}
            type="button"
            onClick={() => onSelectLayer(lf.id)}
            data-testid={`layer-tab-${lf.id}`}
            className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors border cursor-pointer ${
              activeLayer === lf.id
                ? 'bg-zinc-800 text-zinc-100 border-zinc-600'
                : 'bg-[var(--bg-main)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:border-[var(--border-hover)]'
            }`}
          >
            {lf.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {onSyncStands && (
          <button
            type="button"
            onClick={onSyncStands}
            disabled={syncingStands}
            data-testid="topology-sync-stands-btn"
            title="Подхватить новые стенды и коммутаторы из Git SoT, Containerlab и SSH без перезапуска"
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-700 text-[11px] font-medium transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${syncingStands ? 'animate-spin' : ''}`} />
            <span>{syncingStands ? 'Синхронизация...' : 'Найти стенды'}</span>
          </button>
        )}
        {onOpenStandsModal && (
          <button
            type="button"
            onClick={onOpenStandsModal}
            data-testid="topology-add-stand-btn"
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-[var(--bg-main)] hover:border-zinc-600 text-[var(--text-secondary)] hover:text-zinc-100 border border-[var(--border-subtle)] text-[11px] font-medium transition-colors cursor-pointer"
          >
            <Plus className="w-3 h-3 text-zinc-400" />
            <span>Стенды ({standCount})</span>
          </button>
        )}
        <div className="relative w-48 sm:w-52">
          <Search className="w-3.5 h-3.5 text-[var(--text-muted)] absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Поиск узла, IP, порта..."
            data-testid="topology-search-input"
            className="w-full pl-8 pr-6 py-1 rounded bg-[var(--bg-main)] border border-[var(--border-subtle)] focus:border-zinc-600 text-[11px] font-mono text-[var(--text-primary)] outline-none"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-white cursor-pointer"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
