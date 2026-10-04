import React, { useMemo, useState } from 'react';
import {
  Search,
  Play,
  ShieldCheck,
  RefreshCw,
  FileCheck2,
  ArrowUpDown,
  GitCompare,
  ExternalLink,
} from 'lucide-react';
import type { Device } from '../api';
import {
  PLATFORM_NAMES,
  ROLE_NAMES,
  OperStatusBadge,
  IntentStatusBadge,
  Sparkline,
  StateTimeline,
} from './ui';

interface DeviceListProps {
  devices: Device[];
  loading: boolean;
  onRefresh: () => void;
  onRunDryRun: (deviceIds: number[]) => void;
  onScanDrift: (deviceIds?: number[]) => void;
  onSyncInventory: () => void;
  onLintIntent: () => void;
  onOpenDevice: (deviceId: number) => void;
  onOpenDiff?: (deviceId?: number) => void;
}

type SortKey = 'hostname' | 'role' | 'platform' | 'management_ip' | 'oper_status' | 'status';

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'hostname', label: 'Устройство' },
  { key: 'role', label: 'Роль' },
  { key: 'platform', label: 'Платформа' },
  { key: 'oper_status', label: 'Oper Status' },
  { key: 'status', label: 'Intent Status' },
];

const Filter: React.FC<{
  value: string;
  onChange: (v: string) => void;
  label: string;
  options: Record<string, string>;
}> = ({ value, onChange, label, options }) => (
  <select
    value={value}
    onChange={(e) => onChange(e.target.value)}
    className="bg-zinc-900 border border-white/[0.08] rounded-md px-2 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-cyan-500/50"
  >
    <option value="">{label}: все</option>
    {Object.entries(options).map(([k, v]) => (
      <option key={k} value={k}>
        {v}
      </option>
    ))}
  </select>
);

const ipKey = (ip: string) => ip.split('.').reduce((acc, p) => acc * 256 + Number(p), 0);

export const DeviceList: React.FC<DeviceListProps> = ({
  devices,
  loading,
  onRefresh,
  onRunDryRun,
  onScanDrift,
  onSyncInventory,
  onLintIntent,
  onOpenDevice,
  onOpenDiff,
}) => {
  const [query, setQuery] = useState('');
  const [platform, setPlatform] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [operStatus, setOperStatus] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'hostname', dir: 1 });
  const [selected, setSelected] = useState<number[]>([]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return devices
      .filter(
        (d) =>
          (!q || `${d.hostname} ${d.management_ip}`.toLowerCase().includes(q)) &&
          (!platform || d.platform === platform) &&
          (!role || d.role === role) &&
          (!status || d.status === status) &&
          (!operStatus || (d.oper_status ?? 'UP') === operStatus)
      )
      .sort((a, b) => {
        let x: any;
        let y: any;
        if (sort.key === 'management_ip') {
          x = ipKey(a.management_ip);
          y = ipKey(b.management_ip);
        } else if (sort.key === 'oper_status') {
          x = a.oper_status ?? 'UP';
          y = b.oper_status ?? 'UP';
        } else {
          x = a[sort.key];
          y = b[sort.key];
        }
        return (x > y ? 1 : x < y ? -1 : 0) * sort.dir;
      });
  }, [devices, query, platform, role, status, operStatus, sort]);

  const toggle = (id: number) =>
    setSelected((s) => (s.includes(id) ? s.filter((i) => i !== id) : [...s, id]));
  const allSelected = rows.length > 0 && rows.every((d) => selected.includes(d.id));
  const targets = selected.length ? selected : rows.map((d) => d.id);
  const scope = selected.length ? `выбрано: ${selected.length}` : 'все в списке';

  const btn =
    'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium cursor-pointer transition-colors disabled:opacity-40';

  return (
    <div className="space-y-4">
      {/* Title & Top Toolbar */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-white tracking-tight">
            Инвентарь оборудования{' '}
            <span className="text-zinc-500 font-normal text-sm ml-1 font-mono">
              {rows.length} из {devices.length}
            </span>
          </h1>
          <p className="text-xs text-zinc-400 mt-0.5">
            Учет физического состояния фабрики (Oper Status) и соответствия намерениям Git SoT (Intent Status)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onSyncInventory}
            className={`${btn} border border-white/[0.1] text-zinc-300 hover:bg-white/[0.05]`}
          >
            <RefreshCw className="w-3.5 h-3.5" /> Синхронизировать инвентарь
          </button>
          <button
            onClick={onLintIntent}
            className={`${btn} border border-white/[0.1] text-zinc-300 hover:bg-white/[0.05]`}
          >
            <FileCheck2 className="w-3.5 h-3.5" /> Pre-flight Lint
          </button>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Имя или IP…"
            className="bg-zinc-900 border border-white/[0.08] rounded-md pl-8 pr-3 py-1.5 text-xs text-zinc-200 w-48 focus:outline-none focus:border-cyan-500/50"
          />
        </div>
        <Filter value={role} onChange={setRole} label="Роль" options={ROLE_NAMES} />
        <Filter value={platform} onChange={setPlatform} label="Платформа" options={PLATFORM_NAMES} />
        <Filter
          value={operStatus}
          onChange={setOperStatus}
          label="Oper"
          options={{ UP: 'UP (Доступен)', DOWN: 'DOWN (Авария)', DEGRADED: 'DEGRADED (Снижен)' }}
        />
        <Filter
          value={status}
          onChange={setStatus}
          label="Intent"
          options={{
            IN_SYNC: 'В синхроне',
            DRIFT_DETECTED: 'Дрейф',
            UNREACHABLE: 'Недоступно',
            UNKNOWN: 'Неизвестно',
          }}
        />

        <div className="ml-auto flex items-center gap-2">
          <span className="text-[11px] text-zinc-500 font-mono">{scope}</span>
          <button
            disabled={!targets.length}
            onClick={() => onRunDryRun(targets)}
            className={`${btn} bg-cyan-500 text-zinc-950 hover:bg-cyan-400 font-semibold shadow-sm`}
          >
            <Play className="w-3.5 h-3.5 fill-current" /> Dry-run
          </button>
          <button
            disabled={!targets.length}
            onClick={() => onScanDrift(selected.length ? selected : undefined)}
            className={`${btn} border border-white/[0.1] text-zinc-200 hover:bg-white/[0.05]`}
          >
            <ShieldCheck className="w-3.5 h-3.5" /> Скан дрейфа
          </button>
          <button
            onClick={onRefresh}
            className={`${btn} text-zinc-400 hover:text-white p-2`}
            title="Обновить"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* High-Density Inventory Table */}
      <div className="rounded-lg border border-white/[0.08] bg-[#0c0e14] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-white/[0.03] text-[11px] uppercase tracking-wide text-zinc-400 border-b border-white/[0.06]">
                <th className="w-10 px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={() => setSelected(allSelected ? [] : rows.map((d) => d.id))}
                    className="rounded bg-zinc-900 border-zinc-700 cursor-pointer"
                  />
                </th>
                {COLUMNS.map((c) => (
                  <th key={c.key} className="px-3 py-2.5 font-medium">
                    <button
                      onClick={() =>
                        setSort((s) => ({
                          key: c.key,
                          dir: s.key === c.key ? (-s.dir as 1 | -1) : 1,
                        }))
                      }
                      className="flex items-center gap-1 uppercase tracking-wide cursor-pointer hover:text-white transition-colors"
                    >
                      {c.label}
                      <ArrowUpDown
                        className={`w-3 h-3 ${sort.key === c.key ? 'text-cyan-400' : 'opacity-30'}`}
                      />
                    </button>
                  </th>
                ))}
                <th className="px-3 py-2.5 font-medium">Нагрузка (тренд)</th>
                <th className="px-3 py-2.5 font-medium">24h Timeline</th>
                <th className="px-3 py-2.5 font-medium text-right">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04]">
              {rows.map((d) => (
                <tr
                  key={d.id}
                  onClick={() => onOpenDevice(d.id)}
                  className="hover:bg-white/[0.03] cursor-pointer transition-colors group"
                >
                  {/* Select Checkbox */}
                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selected.includes(d.id)}
                      onChange={() => toggle(d.id)}
                      className="rounded bg-zinc-900 border-zinc-700 cursor-pointer"
                    />
                  </td>

                  {/* Device Hostname & IP */}
                  <td className="px-3 py-2">
                    <div className="flex flex-col">
                      <span className="font-semibold text-cyan-300 font-mono tracking-tight group-hover:text-cyan-200">
                        {d.hostname}
                      </span>
                      <span className="font-mono text-[11px] text-zinc-500">
                        {d.management_ip}
                      </span>
                    </div>
                  </td>

                  {/* Role Pill */}
                  <td className="px-3 py-2">
                    <span className="inline-block px-2 py-0.5 rounded text-[11px] font-mono bg-white/[0.04] text-zinc-300 border border-white/[0.06]">
                      {ROLE_NAMES[d.role] ?? d.role}
                    </span>
                  </td>

                  {/* Platform Pill */}
                  <td className="px-3 py-2">
                    <span className="inline-block px-2 py-0.5 rounded text-[11px] font-mono bg-white/[0.04] text-zinc-400 border border-white/[0.06]">
                      {PLATFORM_NAMES[d.platform] ?? d.platform}
                    </span>
                  </td>

                  {/* Oper Status (Physical Link Reachability) */}
                  <td className="px-3 py-2">
                    <OperStatusBadge status={d.oper_status ?? 'UP'} />
                  </td>

                  {/* Intent Status (Git SoT Sync) */}
                  <td className="px-3 py-2">
                    <IntentStatusBadge status={d.status} />
                  </td>

                  {/* Micro-Sparkline */}
                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                    <div className="sparkline" data-testid="sparkline">
                      <Sparkline
                        className="sparkline"
                        points={
                          d.sparkline && d.sparkline.length > 0
                            ? d.sparkline
                            : [20, 22, 24, 25, 23, 27, 28, 26, 30, 32, 34, 33]
                        }
                        width={70}
                        height={18}
                      />
                    </div>
                  </td>

                  {/* 24h State Timeline */}
                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                    <div className="state-timeline" data-testid="state-timeline">
                      <StateTimeline
                        states={
                          d.state_timeline && d.state_timeline.length > 0
                            ? d.state_timeline
                            : Array(24).fill(
                                d.status === 'IN_SYNC' ? 'UP' : d.status === 'DRIFT_DETECTED' ? 'DRIFT' : 'DOWN'
                              )
                        }
                      />
                    </div>
                  </td>

                  {/* 1-Click Action Buttons */}
                  <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="inline-flex items-center gap-1.5">
                      <button
                        onClick={() => onOpenDevice(d.id)}
                        className="px-2 py-1 rounded bg-white/[0.04] hover:bg-white/[0.1] text-zinc-300 hover:text-white text-[11px] font-mono flex items-center gap-1 transition-colors cursor-pointer border border-white/[0.06]"
                        title="Открыть карточку устройства"
                      >
                        <ExternalLink className="w-3 h-3 text-cyan-400" />
                        <span>Карточка</span>
                      </button>

                      <button
                        onClick={() => {
                          if (onOpenDiff) onOpenDiff(d.id);
                          else onOpenDevice(d.id);
                        }}
                        className="px-2 py-1 rounded bg-white/[0.04] hover:bg-white/[0.1] text-zinc-300 hover:text-white text-[11px] font-mono flex items-center gap-1 transition-colors cursor-pointer border border-white/[0.06]"
                        title="Сверить конфигурации (Diff)"
                      >
                        <GitCompare className="w-3 h-3 text-amber-400" />
                        <span>Diff</span>
                      </button>

                      <button
                        onClick={() => onRunDryRun([d.id])}
                        className="px-2 py-1 rounded bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 hover:text-emerald-200 text-[11px] font-mono flex items-center gap-1 transition-colors cursor-pointer"
                        title="Запустить префлайт Dry-run"
                      >
                        <Play className="w-3 h-3 text-emerald-400" />
                        <span>Dry-run</span>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-3 py-12 text-center text-zinc-500">
                    {devices.length
                      ? 'Нет устройств под выбранные фильтры'
                      : 'Инвентарь пуст — нажмите «Синхронизировать инвентарь»'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
