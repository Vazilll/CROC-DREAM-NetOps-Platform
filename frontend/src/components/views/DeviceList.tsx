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
  Plus,
  Zap,
  Trash2,
} from 'lucide-react';
import { api, getErrorMessage } from '../../api';
import type { Device, UserRole } from '../../api';
import { translations, type Locale } from '../../i18n';
import {
  OperStatusBadge,
  StatusBadge,
  ManagementModeBadge,
  Sparkline,
  StateTimeline,
} from '../layout/ui';
import { PLATFORM_NAMES, ROLE_NAMES } from '../../constants';
import { AddDeviceModal } from '../modals/AddDeviceModal';

interface DeviceListProps {
  devices: Device[];
  loading: boolean;
  userRole?: UserRole;
  locale?: Locale;
  onRefresh: () => void;
  onRunDryRun: (deviceIds: number[]) => void;
  onScanDrift: (deviceIds?: number[]) => void;
  onSyncInventory: () => void;
  onLintIntent: () => void;
  onOpenDevice: (deviceId: number) => void;
  onOpenDiff?: (deviceId?: number) => void;
  onDeleteDevice?: (deviceId: number) => void;
}

type SortKey = 'hostname' | 'role' | 'platform' | 'management_ip' | 'management_mode' | 'oper_status' | 'status';

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'hostname', label: 'Устройство' },
  { key: 'role', label: 'Роль' },
  { key: 'platform', label: 'Платформа' },
  { key: 'management_mode', label: 'Режим' },
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
    className="bg-[var(--bg-card)] border border-[var(--border-subtle)] hover:border-[var(--border-hover)] rounded-md px-2.5 py-1.5 text-xs text-[var(--text-primary)] focus:outline-none cursor-pointer"
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
  userRole,
  locale = 'ru',
  onRefresh,
  onRunDryRun,
  onScanDrift,
  onSyncInventory,
  onLintIntent,
  onOpenDevice,
  onOpenDiff,
  onDeleteDevice,
}) => {
  const t = translations[locale];
  const [query, setQuery] = useState('');
  const [platform, setPlatform] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [operStatus, setOperStatus] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'hostname', dir: 1 });
  const [selected, setSelected] = useState<number[]>([]);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [promotingId, setPromotingId] = useState<number | null>(null);

  const handleDelete = async (id: number) => {
    try {
      if (onDeleteDevice) {
        await onDeleteDevice(id);
      } else {
        await api.deleteDevice(id);
        await onRefresh();
      }
    } catch (err: unknown) {
      alert(`${t.deleteError}: ${getErrorMessage(err)}`);
    }
  };

  const handleBulkDelete = async () => {
    if (!window.confirm(`${t.deleteConfirm} (${selected.length})`)) return;
    try {
      const results = await Promise.allSettled(selected.map((id) => api.deleteDevice(id)));
      const succeeded: number[] = [];
      const failed: string[] = [];
      results.forEach((res, idx) => {
        if (res.status === 'fulfilled') {
          succeeded.push(selected[idx]);
        } else {
          failed.push(getErrorMessage(res.reason, 'Error'));
        }
      });
      setSelected((prev) => prev.filter((id) => !succeeded.includes(id)));
      await onRefresh();
      if (failed.length > 0) {
        alert(`${t.deleteError}: ${failed.length} / ${selected.length} ${locale === 'en' ? 'failed' : 'не удалось удалить'}`);
      }
    } catch (err: unknown) {
      alert(`${t.deleteError}: ${getErrorMessage(err)}`);
    }
  };

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = devices.filter(
      (d) =>
        (!platform || d.platform === platform) &&
        (!role || d.role === role) &&
        (!status || d.status === status) &&
        (!operStatus || (d.oper_status ?? 'UP') === operStatus)
    );
    if (q) {
      const tokens = q.split(/\s+/).filter(Boolean);
      return filtered.filter((d) => {
        const hay = `${d.hostname} ${d.management_ip} ${d.platform} ${PLATFORM_NAMES[d.platform] ?? ''} ${d.role} ${ROLE_NAMES[d.role] ?? ''} ${d.status} ${d.site ?? ''}`.toLowerCase();
        return tokens.every((tok) => hay.includes(tok));
      });
    }
    return [...filtered].sort((a, b) => {
      if (sort.key === 'management_ip') {
        const x = ipKey(a.management_ip);
        const y = ipKey(b.management_ip);
        return (x > y ? 1 : x < y ? -1 : 0) * sort.dir;
      }
      const x = String(sort.key === 'oper_status' ? (a.oper_status ?? 'UP') : a[sort.key]);
      const y = String(sort.key === 'oper_status' ? (b.oper_status ?? 'UP') : b[sort.key]);
      return (x > y ? 1 : x < y ? -1 : 0) * sort.dir;
    });
  }, [devices, query, platform, role, status, operStatus, sort]);

  const toggle = (id: number) =>
    setSelected((s) => (s.includes(id) ? s.filter((i) => i !== id) : [...s, id]));
  const allSelected = rows.length > 0 && rows.every((d) => selected.includes(d.id));
  const targets = selected.length ? selected : rows.map((d) => d.id);
  const scope = selected.length
    ? `${locale === 'en' ? 'selected' : 'выбрано'}: ${selected.length}`
    : locale === 'en'
    ? 'all in list'
    : 'все в списке';

  const btn =
    'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium cursor-pointer transition-colors disabled:opacity-40';

  return (
    <div className="w-full max-w-[2560px] mx-auto space-y-4">
      {/* Title & Top Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div>
          <h1 className="text-lg font-semibold text-[var(--text-primary)] tracking-tight">
            {locale === 'en' ? 'Hardware Inventory' : 'Инвентарь оборудования'}{' '}
            <span className="text-[var(--text-muted)] font-normal text-sm ml-1 font-mono tabular-nums">
              {rows.length} {locale === 'en' ? 'of' : 'из'} {devices.length}
            </span>
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          {(userRole === 'admin' || userRole === 'owner') && selected.length > 0 && (
            <button
              onClick={handleBulkDelete}
              className={`${btn} bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-400 font-semibold`}
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>{t.deleteSelectedBtn} ({selected.length})</span>
            </button>
          )}
          {(userRole === 'admin' || userRole === 'owner') && (
            <button
              onClick={() => setAddModalOpen(true)}
              className={`${btn} bg-[var(--text-primary)] text-[var(--bg-main)] hover:opacity-90 font-semibold`}
            >
              <Plus className="w-3.5 h-3.5" /> {t.addDeviceBtn}
            </button>
          )}
          <button
            onClick={onSyncInventory}
            className={`${btn} border border-[var(--border-subtle)] hover:border-[var(--border-hover)] bg-[var(--bg-card)] text-[var(--text-primary)]`}
          >
            <RefreshCw className="w-3.5 h-3.5 text-[var(--text-secondary)]" /> {t.syncInventoryBtn}
          </button>
          <button
            onClick={onLintIntent}
            className={`${btn} border border-[var(--border-subtle)] hover:border-[var(--border-hover)] bg-[var(--bg-card)] text-[var(--text-primary)]`}
          >
            <FileCheck2 className="w-3.5 h-3.5 text-[var(--text-secondary)]" /> Pre-flight Lint
          </button>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
        <div className="relative w-full sm:w-auto">
          <Search className="w-3.5 h-3.5 text-[var(--text-muted)] absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Имя или IP…"
            className="bg-[var(--bg-card)] border border-[var(--border-subtle)] hover:border-[var(--border-hover)] rounded-md pl-8 pr-3 py-1.5 text-xs text-[var(--text-primary)] w-full sm:w-48 focus:outline-none focus:border-[var(--text-secondary)]"
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

        <div className="w-full sm:w-auto sm:ml-auto flex flex-wrap items-center gap-1.5 sm:gap-2">
          <span className="text-[11px] text-[var(--text-muted)] font-mono tabular-nums">{scope}</span>
          <button
            disabled={!targets.length}
            onClick={() => onRunDryRun(targets)}
            className={`${btn} bg-[var(--text-primary)] text-[var(--bg-main)] hover:opacity-90 font-semibold`}
          >
            <Play className="w-3.5 h-3.5 fill-current" /> Dry-run
          </button>
          <button
            disabled={!targets.length}
            onClick={() => onScanDrift(selected.length ? selected : undefined)}
            className={`${btn} border border-[var(--border-subtle)] hover:border-[var(--border-hover)] bg-[var(--bg-card)] text-[var(--text-primary)]`}
          >
            <ShieldCheck className="w-3.5 h-3.5 text-[var(--text-secondary)]" /> Скан дрейфа
          </button>
          <button
            onClick={onRefresh}
            className={`${btn} text-[var(--text-secondary)] hover:text-[var(--text-primary)] p-2`}
            title="Обновить"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* High-Density Inventory Table */}
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-xs border-collapse tabular-nums">
            <thead>
              <tr className="bg-[var(--bg-elevated)]/60 text-[11px] uppercase tracking-wide text-[var(--text-muted)] border-b border-[var(--border-subtle)]">
                <th className="w-10 px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={() => setSelected(allSelected ? [] : rows.map((d) => d.id))}
                    className="rounded border-[var(--border-hover)] cursor-pointer accent-zinc-200"
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
                      className="flex items-center gap-1 uppercase tracking-wide cursor-pointer hover:text-[var(--text-primary)] transition-colors"
                    >
                      {c.label}
                      <ArrowUpDown
                        className={`w-3 h-3 ${sort.key === c.key ? 'text-[var(--text-primary)]' : 'opacity-35'}`}
                      />
                    </button>
                  </th>
                ))}
                <th className="px-3 py-2.5 font-medium hidden xl:table-cell">Нагрузка (тренд)</th>
                <th className="px-3 py-2.5 font-medium hidden xl:table-cell">24h Timeline</th>
                <th className="px-3 py-2.5 font-medium text-right">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {rows.map((d) => (
                <tr
                  key={d.id}
                  onClick={() => onOpenDevice(d.id)}
                  className="hover:bg-[var(--bg-elevated)]/40 cursor-pointer transition-colors group"
                >
                  {/* Select Checkbox */}
                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selected.includes(d.id)}
                      onChange={() => toggle(d.id)}
                      className="rounded border-[var(--border-hover)] cursor-pointer accent-zinc-200"
                    />
                  </td>

                  {/* Device Hostname & IP */}
                  <td className="px-3 py-2">
                    <div className="flex flex-col">
                      <span className="font-semibold text-[var(--text-primary)] font-mono tracking-tight whitespace-nowrap group-hover:underline">
                        {d.hostname}
                      </span>
                      <span className="font-mono text-[11px] text-[var(--text-muted)]">
                        {d.management_ip}:{d.management_port}
                      </span>
                    </div>
                  </td>

                  {/* Role Pill */}
                  <td className="px-3 py-2">
                    <span className="inline-block px-2 py-0.5 rounded text-[11px] font-mono bg-[var(--bg-elevated)] text-[var(--text-secondary)] border border-[var(--border-subtle)]">
                      {ROLE_NAMES[d.role] ?? d.role}
                    </span>
                  </td>

                  {/* Platform Pill */}
                  <td className="px-3 py-2">
                    <span className="inline-block px-2 py-0.5 rounded text-[11px] font-mono bg-[var(--bg-subtle)] text-[var(--text-muted)] border border-[var(--border-subtle)]">
                      {PLATFORM_NAMES[d.platform] ?? d.platform}
                    </span>
                  </td>

                  {/* Management Mode Pill & Promote button */}
                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-1.5">
                      <ManagementModeBadge mode={d.management_mode} />
                      {d.management_mode === 'MONITORING_ONLY' && (userRole === 'admin' || userRole === 'owner') && (
                        <button
                          onClick={async (e) => {
                            e.stopPropagation();
                            setPromotingId(d.id);
                            try {
                              await api.promoteDevice(d.id);
                              onRefresh();
                            } catch (err: unknown) {
                              alert(`Ошибка активации управления: ${getErrorMessage(err)}`);
                            } finally {
                              setPromotingId(null);
                            }
                          }}
                          disabled={promotingId === d.id}
                          className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-[var(--bg-elevated)] hover:border-[var(--border-hover)] text-[var(--text-primary)] border border-[var(--border-subtle)] transition-colors flex items-center gap-1 cursor-pointer"
                          title="Активировать прямое управление (Promote to MANAGED)"
                        >
                          <Zap className="w-2.5 h-2.5" />
                          <span>{promotingId === d.id ? '…' : 'В управление'}</span>
                        </button>
                      )}
                    </div>
                  </td>

                  {/* Oper Status */}
                  <td className="px-3 py-2">
                    <OperStatusBadge status={d.oper_status ?? 'UP'} />
                  </td>

                  {/* Intent Status */}
                  <td className="px-3 py-2">
                    <StatusBadge status={d.status} />
                  </td>

                  {/* Micro-Sparkline */}
                  <td className="px-3 py-2 hidden xl:table-cell" onClick={(e) => e.stopPropagation()}>
                    <div className="sparkline" data-testid="sparkline">
                      {d.sparkline && d.sparkline.length > 0 ? (
                        <Sparkline
                          className="sparkline"
                          points={d.sparkline}
                          width={76}
                          height={20}
                        />
                      ) : (
                        <span className="text-[10px] font-mono text-[var(--text-muted)]">N/A</span>
                      )}
                    </div>
                  </td>

                  {/* 24h State Timeline */}
                  <td className="px-3 py-2 hidden xl:table-cell" onClick={(e) => e.stopPropagation()}>
                    <div className="state-timeline" data-testid="state-timeline">
                      {d.state_timeline && d.state_timeline.length > 0 ? (
                        <StateTimeline states={d.state_timeline} />
                      ) : (
                        <span className="text-[10px] font-mono text-[var(--text-muted)]">N/A</span>
                      )}
                    </div>
                  </td>

                  {/* 1-Click Action Buttons */}
                  <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="inline-flex items-center gap-1 whitespace-nowrap">
                      <button
                        onClick={() => onOpenDevice(d.id)}
                        className="px-2 py-1 rounded bg-[var(--bg-elevated)] hover:border-[var(--border-hover)] text-[var(--text-primary)] text-[11px] font-mono flex items-center gap-1 transition-colors cursor-pointer border border-[var(--border-subtle)]"
                        title="Открыть карточку устройства"
                      >
                        <ExternalLink className="w-3 h-3 text-[var(--text-secondary)]" />
                        <span className="hidden 2xl:inline">{locale === 'en' ? 'Details' : 'Карточка'}</span>
                      </button>

                      <button
                        onClick={() => {
                          if (onOpenDiff) onOpenDiff(d.id);
                          else onOpenDevice(d.id);
                        }}
                        className="px-2 py-1 rounded bg-[var(--bg-elevated)] hover:border-[var(--border-hover)] text-[var(--text-primary)] text-[11px] font-mono flex items-center gap-1 transition-colors cursor-pointer border border-[var(--border-subtle)]"
                        title="Сверить конфигурации (Diff)"
                      >
                        <GitCompare className="w-3 h-3 text-[var(--text-secondary)]" />
                        <span className="hidden 2xl:inline">Diff</span>
                      </button>

                      <button
                        onClick={() => onRunDryRun([d.id])}
                        className="px-2 py-1 rounded bg-[var(--text-primary)] text-[var(--bg-main)] hover:opacity-90 text-[11px] font-mono font-medium flex items-center gap-1 transition-opacity cursor-pointer"
                        title="Запустить префлайт Dry-run"
                      >
                        <Play className="w-3 h-3 fill-current" />
                        <span className="hidden 2xl:inline">Dry-run</span>
                      </button>

                      {(userRole === 'admin' || userRole === 'owner') && (
                        <button
                          onClick={async () => {
                            if (window.confirm(`${t.deleteConfirm} (${d.hostname})`)) {
                              await handleDelete(d.id);
                            }
                          }}
                          className="px-2 py-1 rounded bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/25 text-rose-400 text-[11px] font-mono flex items-center gap-1 transition-colors cursor-pointer"
                          title={t.deleteDeviceBtn}
                        >
                          <Trash2 className="w-3 h-3" />
                          <span className="hidden 2xl:inline">{t.deleteDeviceBtn}</span>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-6 py-12 text-center">
                    <div className="max-w-md mx-auto space-y-3">
                      <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                        {devices.length ? 'Нет совпадений' : 'Нет устройств'}
                      </h3>
                      {!devices.length && (
                        <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                          {(userRole === 'admin' || userRole === 'owner') && (
                            <button
                              onClick={() => setAddModalOpen(true)}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-[var(--text-primary)] text-[var(--bg-main)] hover:opacity-90 transition-opacity cursor-pointer"
                            >
                              <Plus className="w-3.5 h-3.5" /> + Добавить
                            </button>
                          )}
                          <button
                            onClick={onSyncInventory}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border border-[var(--border-subtle)] text-[var(--text-primary)] hover:border-[var(--border-hover)] transition-colors cursor-pointer"
                          >
                            <RefreshCw className="w-3.5 h-3.5" /> Синхронизировать
                          </button>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <AddDeviceModal
        isOpen={addModalOpen}
        onClose={() => setAddModalOpen(false)}
        onSuccess={() => onRefresh()}
        userRole={userRole || 'operator'}
      />
    </div>
  );
};
