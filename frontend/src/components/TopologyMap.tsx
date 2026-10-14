import React, { useMemo, useState, useEffect, Suspense } from 'react';
import { ExternalLink, Play, X, Layers, Network, Box, Cpu } from 'lucide-react';
import { api } from '../api';
import type { Device, ForecastAlert } from '../api';
import type { Locale } from '../i18n';
import { StatusBadge } from './ui';
import { PLATFORM_NAMES, ROLE_NAMES } from '../constants';
import { DeviceDetailModal } from './DeviceDetailModal';

const LazyTopology3D = React.lazy(() =>
  import('./Topology3D').then((m) => ({ default: m.Topology3D }))
);

const W = 900;
const H = 320;
const NODE_W = 140;
const NODE_H = 44;

const STATUS_COLOR: Record<string, string> = {
  IN_SYNC: '#10b981',
  DRIFT_DETECTED: '#f59e0b',
  UNREACHABLE: '#f43f5e',
  IN_PROGRESS: '#06b6d4',
  UNKNOWN: '#71717a',
};

const VENDOR_BADGE: Record<string, { bg: string; stroke: string; text: string; label: string }> = {
  arista_eos: { bg: 'rgba(255, 255, 255, 0.05)', stroke: 'rgba(255, 255, 255, 0.14)', text: '#a1a1aa', label: 'EOS' },
  cisco_iosxe: { bg: 'rgba(255, 255, 255, 0.05)', stroke: 'rgba(255, 255, 255, 0.14)', text: '#a1a1aa', label: 'IOS-XE' },
  huawei_vrp: { bg: 'rgba(255, 255, 255, 0.05)', stroke: 'rgba(255, 255, 255, 0.14)', text: '#a1a1aa', label: 'VRP' },
  eltex_esr: { bg: 'rgba(255, 255, 255, 0.05)', stroke: 'rgba(255, 255, 255, 0.14)', text: '#a1a1aa', label: 'ESR' },
  eltex_mes: { bg: 'rgba(255, 255, 255, 0.05)', stroke: 'rgba(255, 255, 255, 0.14)', text: '#a1a1aa', label: 'MES' },
  juniper_junos: { bg: 'rgba(255, 255, 255, 0.05)', stroke: 'rgba(255, 255, 255, 0.14)', text: '#a1a1aa', label: 'JUNOS' },
  yadro_kornfe: { bg: 'rgba(255, 255, 255, 0.05)', stroke: 'rgba(255, 255, 255, 0.14)', text: '#a1a1aa', label: 'KORNFE' },
  linux_server: { bg: 'rgba(255, 255, 255, 0.05)', stroke: 'rgba(255, 255, 255, 0.14)', text: '#a1a1aa', label: 'LINUX' },
};


const linkLoad = (a: Device, b: Device) => {
  const valA = a.sparkline && a.sparkline.length > 0 ? a.sparkline[a.sparkline.length - 1] : 0;
  const valB = b.sparkline && b.sparkline.length > 0 ? b.sparkline[b.sparkline.length - 1] : 0;
  return Math.max(valA, valB);
};

const loadColor = (pct: number) =>
  pct > 70 ? '#f43f5e' : pct > 50 ? '#d97706' : 'var(--topology-link, rgba(255,255,255,0.16))';

interface Props {

  devices: Device[];
  alerts: ForecastAlert[];
  locale?: Locale;
  onSelectDevice: (id: number) => void;
  onRunDryRun?: (ids: number[]) => void;
}

const TopologyMapComponent: React.FC<Props> = ({
  devices,
  alerts,
  locale = 'ru',
  onSelectDevice,
  onRunDryRun,
}) => {
  const [viewMode, setViewMode] = useState<'clos' | 'enterprise' | '3d'>('clos');
  const [hover, setHover] = useState<number | null>(null);
  const [popoverId, setPopoverId] = useState<number | null>(null);
  const [inspectDeviceId, setInspectDeviceId] = useState<number | null>(null);
  const [dryRunRunning, setDryRunRunning] = useState<boolean>(false);
  const [dryRunMsg, setDryRunMsg] = useState<string | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPopoverId(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const hasBorder = devices.some((d) => ['border', 'border_firewall'].includes(d.role));
  const hasServer = devices.some((d) => d.role === 'server' || d.platform === 'linux_server');

  const activeLayers = useMemo(() => {
    const layers = [];
    if (hasBorder) layers.push({ roles: ['border', 'border_firewall'], y: 24, label: 'Border' });
    layers.push({ roles: ['spine'], y: hasBorder ? 110 : (hasServer ? 42 : 55), label: 'Spine' });
    layers.push({ roles: ['leaf'], y: hasBorder ? 190 : (hasServer ? 135 : 215), label: 'Leaf' });
    if (hasServer) layers.push({ roles: ['server'], y: 236, label: locale === 'en' ? 'Compute / Servers' : 'Вычислительные серверы' });
    return layers;
  }, [hasBorder, hasServer, locale]);

  const { nodes, links } = useMemo(() => {
    const pos = new Map<number, { x: number; y: number }>();
    const byLayer = activeLayers.map((layer) =>
      devices.filter((d) => layer.roles.includes(d.role) || (layer.roles.includes('server') && d.platform === 'linux_server'))
    );
    byLayer.forEach((list, li) =>
      list.forEach((d, i) => pos.set(d.id, { x: ((i + 1) * W) / (list.length + 1), y: activeLayers[li].y }))
    );
    const spine = devices.filter((d) => d.role === 'spine');
    const leaf = devices.filter((d) => d.role === 'leaf');
    const border = devices.filter((d) => ['border', 'border_firewall'].includes(d.role));
    const server = devices.filter((d) => d.role === 'server' || d.platform === 'linux_server');

    const pairs: [Device, Device][] = [
      ...border.flatMap((b) => spine.map((s): [Device, Device] => [b, s])),
      ...spine.flatMap((s) => leaf.map((l): [Device, Device] => [s, l])),
      ...server.flatMap((srv) => leaf.slice(0, 2).map((l): [Device, Device] => [l, srv])),
    ];
    return {
      nodes: devices.filter((d) => pos.has(d.id)).map((d) => ({ d, ...pos.get(d.id)! })),
      links: pairs.map(([a, b]) => ({
        a,
        b,
        pa: pos.get(a.id)!,
        pb: pos.get(b.id)!,
        load: linkLoad(a, b),
      })),
    };
  }, [devices, activeLayers]);

  const alertFor = (id: number) => alerts.find((a) => a.device_id === id);
  const popoverNode = popoverId !== null ? nodes.find((n) => n.d.id === popoverId) : undefined;

  const handleDryRun = async (deviceId: number) => {
    if (onRunDryRun) {
      onRunDryRun([deviceId]);
      setPopoverId(null);
      return;
    }
    setDryRunRunning(true);
    setDryRunMsg(null);
    try {
      await api.createDryRun([deviceId]);
      setDryRunMsg('Dry-run запущен');
      setTimeout(() => {
        setDryRunMsg(null);
        setPopoverId(null);
      }, 1200);
    } catch {
      setDryRunMsg('Ошибка запуска');
    } finally {
      setDryRunRunning(false);
    }
  };

  if (!devices.length) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center rounded-xl border border-dashed border-white/[0.08] bg-[#0c0d12]/60">
        <div className="w-12 h-12 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 mb-3 shadow-[0_0_15px_rgba(99,102,241,0.2)]">
          <Network className="w-6 h-6" />
        </div>
        <h3 className="text-sm font-semibold text-white">Топология пуста: нет подключенных устройств</h3>
        <p className="text-xs text-zinc-400 max-w-md mt-1">
          Платформа ожидает добавления оборудования. Подключите сетевой узел или сервер (с автопроверкой по SSH), чтобы динамически построить граф фабрики.
        </p>
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Topology Mode Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-[var(--border-subtle)] bg-[var(--bg-subtle)]">
        <div className="flex flex-wrap items-center gap-1">
          <button
            onClick={() => setViewMode('clos')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer border ${
              viewMode === 'clos'
                ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)] border-[var(--border-hover)]'
                : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>{locale === 'en' ? 'CLOS Datacenter (Lab)' : 'CLOS Дата-центр (Стенд)'}</span>
          </button>
          <button
            onClick={() => setViewMode('enterprise')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer border ${
              viewMode === 'enterprise'
                ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)] border-[var(--border-hover)]'
                : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            <Network className="w-3.5 h-3.5" />
            <span>{locale === 'en' ? 'CROC Hierarchy (Enterprise 3-Tier)' : 'Иерархия КРОК (Enterprise 3-Tier)'}</span>
          </button>
          <button
            onClick={() => setViewMode('3d')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer border ${
              viewMode === '3d'
                ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)] border-[var(--border-hover)]'
                : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            <Box className="w-3.5 h-3.5" />
            <span>{locale === 'en' ? '3D WebGL Fabric' : '3D WebGL Фабрика'}</span>
          </button>
        </div>
        <div className="text-[11px] text-[var(--text-muted)] font-mono tabular-nums hidden sm:block">
          {viewMode === 'clos' || viewMode === '3d'
            ? `${devices.length} ${locale === 'en' ? 'nodes' : 'узлов'}: ${[...new Set(devices.map((d) => PLATFORM_NAMES[d.platform] ?? d.platform))].join(' • ') || 'CLOS Fabric'}`
            : 'WAN • DMZ • Core • Distribution • Access'}
        </div>
      </div>

      {viewMode === '3d' ? (
        <div className="p-2 sm:p-3">
          <Suspense
            fallback={
              <div className="h-[360px] sm:h-[420px] flex items-center justify-center rounded-xl border border-white/[0.06] bg-[#060913] text-xs font-mono text-zinc-400">
                Загрузка 3D WebGL сцены...
              </div>
            }
          >
            <LazyTopology3D
              devices={devices}
              onSelectDevice={(id) => onSelectDevice(id)}
              onRunDryRun={(ids) => {
                if (onRunDryRun) onRunDryRun(ids);
                else if (ids[0]) handleDryRun(ids[0]);
              }}
              onInspectIntent={(id) => setInspectDeviceId(id)}
            />
          </Suspense>
        </div>
      ) : viewMode === 'clos' ? (
        <div className="w-full overflow-x-auto">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[700px] h-auto select-none">
            {activeLayers.map((l) => (
              <text key={l.label} x={10} y={l.y + NODE_H / 2 + 3} fontSize="9" fill="#52525b" className="uppercase font-mono tracking-wider">
                {l.label}
              </text>
            ))}

            {links.map(({ a, b, pa, pb, load }) => {
              const active = hover === a.id || hover === b.id || popoverId === a.id || popoverId === b.id;
              const id = `${a.id}-${b.id}`;
              const path = `M${pa.x},${pa.y + NODE_H} L${pb.x},${pb.y}`;
              const isCongested = load > 70;
              const hasUnreachable = a.status === 'UNREACHABLE' || b.status === 'UNREACHABLE';
              const hasDrift = a.status === 'DRIFT_DETECTED' || b.status === 'DRIFT_DETECTED';

              const strokeColor = hasUnreachable
                ? '#f43f5e'
                : hasDrift
                ? '#f59e0b'
                : loadColor(load);

              const strokeDash = hasUnreachable ? '4 3' : hasDrift ? '6 3' : undefined;

              return (
                <g key={id} opacity={hover === null && popoverId === null ? 1 : active ? 1 : 0.15}>
                  <path
                    d={path}
                    stroke={strokeColor}
                    strokeWidth={isCongested || hasUnreachable || hasDrift ? 2.0 : 1.2}
                    strokeDasharray={strokeDash}
                    fill="none"
                  />
                  {(isCongested || hasUnreachable) && (
                    <circle r="3" fill="#f43f5e" opacity="0.9">
                      <animateMotion dur={`${6 - load / 20}s`} repeatCount="indefinite" path={path} />
                    </circle>
                  )}
                </g>
              );
            })}

            {nodes.map(({ d, x, y }) => {
              const alert = alertFor(d.id);
              const color = STATUS_COLOR[d.status] ?? STATUS_COLOR.UNKNOWN;
              const isSelected = popoverId === d.id;
              const isHovered = hover === d.id;

              return (
                <g
                  key={d.id}
                  transform={`translate(${x - NODE_W / 2},${y})`}
                  onClick={() => setPopoverId(popoverId === d.id ? null : d.id)}
                  onDoubleClick={() => onSelectDevice(d.id)}
                  onMouseEnter={() => setHover(d.id)}
                  onMouseLeave={() => setHover(null)}
                  className="cursor-pointer transition-transform duration-150"
                  opacity={hover === null && popoverId === null ? 1 : isHovered || isSelected ? 1 : 0.45}
                >
                  <rect
                    width={NODE_W}
                    height={NODE_H}
                    rx="6"
                    style={{ fill: 'var(--bg-card)' }}
                    stroke={isSelected ? '#38bdf8' : isHovered ? 'var(--text-muted)' : 'var(--border-subtle)'}
                    strokeWidth={isSelected ? '1.5' : '1'}
                  />
                  <circle cx="12" cy={NODE_H / 2} r="3" fill={color} />
                  <text
                    x="22"
                    y="18"
                    fontSize="11"
                    fontWeight="600"
                    style={{ fill: 'var(--text-primary)' }}
                    letterSpacing="-0.01em"
                  >
                    {d.hostname.split('.')[0]}
                  </text>
                  <text
                    x="22"
                    y="32"
                    fontSize="9"
                    style={{ fill: 'var(--text-muted)' }}
                    fontFamily="monospace"
                  >
                    {PLATFORM_NAMES[d.platform] ?? d.platform}
                  </text>

                  {/* Vendor Chip Badge */}
                  {VENDOR_BADGE[d.platform] && (
                    <g transform={`translate(${NODE_W - 46}, 6)`}>
                      <rect
                        width="38"
                        height="12"
                        rx="3"
                        fill={VENDOR_BADGE[d.platform].bg}
                        stroke={VENDOR_BADGE[d.platform].stroke}
                        strokeWidth="0.75"
                      />
                      <text
                        x="19"
                        y="9"
                        fontSize="7.5"
                        fontWeight="700"
                        textAnchor="middle"
                        fill={VENDOR_BADGE[d.platform].text}
                        fontFamily="monospace"
                      >
                        {VENDOR_BADGE[d.platform].label}
                      </text>
                    </g>
                  )}

                  {/* AI Guard Status Dot */}
                  <g transform={`translate(${NODE_W - 14}, 27)`}>
                    <circle cx="4" cy="4" r="3" fill="#06b6d4" opacity="0.25" />
                    <circle cx="4" cy="4" r="1.5" fill="#06b6d4" />
                  </g>

                  {alert && (
                    <g transform={`translate(${NODE_W - 18}, -4)`}>
                      <circle cx="7" cy="7" r="6" fill="#f59e0b" style={{ stroke: 'var(--bg-card)' }} strokeWidth="1.5" />
                      <text x="7" y="10" fontSize="8" fontWeight="800" textAnchor="middle" fill="#09090b">
                        !
                      </text>
                    </g>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
      ) : (
        /* Dynamic Hierarchical Diagram View from Real Inventory */
        <div className="w-full overflow-x-auto p-4">
          <div className="min-w-[700px] space-y-4">
            {[
              {
                title: '1. Уровень ядра и магистрали (Spine / Core Tier)',
                color: 'text-cyan-600 dark:text-cyan-400',
                items: devices.filter((d) => d.role === 'spine'),
              },
              {
                title: '2. Уровень граничной маршрутизации (Border / Edge Tier)',
                color: 'text-emerald-600 dark:text-emerald-400',
                items: devices.filter((d) => ['border', 'border_firewall'].includes(d.role)),
              },
              {
                title: '3. Уровень распределения и агрегации (Leaf / Distribution Tier)',
                color: 'text-amber-600 dark:text-amber-400',
                items: devices.filter((d) => d.role === 'leaf'),
              },
              {
                title: '4. Уровень конечных хостов и серверов (Access / Compute Tier)',
                color: 'text-violet-600 dark:text-violet-400',
                items: devices.filter((d) => d.role === 'server' || d.platform === 'linux_server'),
              },
            ]
              .filter((tier) => tier.items.length > 0)
              .map((tier) => (
                <div key={tier.title} className="space-y-2">
                  <div className={`text-[10px] font-mono uppercase tracking-wider ${tier.color} text-center font-bold`}>
                    {tier.title} ({tier.items.length})
                  </div>
                  <div className="flex flex-wrap justify-center gap-4">
                    {tier.items.map((node: Device) => {
                      const isDown = node.oper_status === 'DOWN';
                      const isDrifted = node.status === 'DRIFT_DETECTED';
                      const isFailed = node.status === 'UNREACHABLE' || isDown;
                      const borderClass = isFailed
                        ? 'border-red-500/40 bg-red-500/[0.04]'
                        : isDrifted
                          ? 'border-amber-500/40 bg-amber-500/[0.04]'
                          : 'border-emerald-500/30 bg-slate-100 dark:bg-white/[0.03]';
                      return (
                        <div
                          key={node.id}
                          onClick={() => setPopoverId(node.id)}
                          className={`w-60 p-3 rounded-lg border ${borderClass} text-center shadow-xs cursor-pointer hover:border-cyan-500/50 transition-all`}
                        >
                          <div className="text-xs font-semibold text-slate-900 dark:text-zinc-100 truncate">
                            {node.hostname}
                          </div>
                          <div className="text-[10px] text-slate-500 dark:text-zinc-400 font-mono mt-0.5">
                            {node.management_ip}:{node.management_port} • {node.platform}
                          </div>
                          <div className="mt-1.5 flex items-center justify-center gap-2 text-[10px] font-mono">
                            <span
                              className={
                                isDown
                                  ? 'text-red-400 font-bold'
                                  : 'text-emerald-400 font-semibold'
                              }
                            >
                              LINK: {node.oper_status ?? 'UP'}
                            </span>
                            <span className="text-zinc-600">•</span>
                            <span
                              className={
                                isDrifted
                                  ? 'text-amber-400 font-semibold'
                                  : node.status === 'UNREACHABLE'
                                    ? 'text-red-400 font-semibold'
                                    : 'text-cyan-400'
                              }
                            >
                              {node.status}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Popover on click */}
      {popoverNode && (
        <div className="fixed inset-0 z-[45] flex items-center justify-center bg-black/40 backdrop-blur-[2px]" onClick={() => setPopoverId(null)}>
        <div
          onClick={(e) => e.stopPropagation()}
          className="w-80 max-w-[92vw] max-h-[90vh] overflow-y-auto bento-card rounded-lg shadow-2xl p-4 border border-[var(--border-subtle)] text-xs animate-fade-in"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="font-semibold text-zinc-100">{popoverNode.d.hostname}</span>
            <button
              onClick={() => setPopoverId(null)}
              className="p-1 rounded text-zinc-400 hover:text-white hover:bg-white/[0.06]"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="space-y-1 mb-3 text-[11px] text-zinc-400">
            <div className="flex justify-between">
              <span>IP / Порт:</span>
              <span className="font-mono text-zinc-200">
                {popoverNode.d.management_ip}:{popoverNode.d.management_port}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Платформа:</span>
              <span className="text-zinc-200">{PLATFORM_NAMES[popoverNode.d.platform] ?? popoverNode.d.platform}</span>
            </div>
            <div className="flex justify-between">
              <span>Роль:</span>
              <span className="text-zinc-200">{ROLE_NAMES[popoverNode.d.role] ?? popoverNode.d.role}</span>
            </div>
            <div className="flex justify-between items-center pt-1">
              <span>Статус:</span>
              <StatusBadge status={popoverNode.d.status} />
            </div>
            <div className="flex justify-between items-center pt-1">
              <span>AI Guard:</span>
              <span className="text-cyan-400 font-mono text-[10px] flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse"></span>
                TimesFM Active
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span>Транзакция:</span>
              <span className="text-zinc-300 font-mono text-[10px]">
                {popoverNode.d.platform === 'huawei_vrp' ? 'commit trial' : popoverNode.d.platform === 'cisco_iosxe' ? 'commit confirmed' : 'commit timer'}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-1.5 pt-2 border-t border-white/[0.08]">
            <button
              onClick={() => {
                onSelectDevice(popoverNode.d.id);
                setPopoverId(null);
              }}
              className="flex items-center justify-center gap-1 px-2 py-1.5 rounded bg-white/[0.04] hover:bg-white/[0.08] text-zinc-200 text-[11px] font-medium transition-all"
            >
              <ExternalLink className="w-3 h-3" />
              <span>Паспорт</span>
            </button>

            <button
              onClick={() => handleDryRun(popoverNode.d.id)}
              disabled={dryRunRunning}
              className="flex items-center justify-center gap-1 px-2 py-1.5 rounded bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 text-[11px] font-medium transition-all disabled:opacity-50"
            >
              <Play className="w-3 h-3" />
              <span>{dryRunRunning ? 'Запуск...' : 'Dry-run'}</span>
            </button>

            <button
              onClick={() => {
                setInspectDeviceId(popoverNode.d.id);
                setPopoverId(null);
              }}
              className="col-span-2 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/20 text-indigo-300 text-[11px] font-medium transition-all"
            >
              <Cpu className="w-3 h-3" />
              <span>Инспектор Intent (YAML)</span>
            </button>
          </div>

          {dryRunMsg && (
            <div className="mt-2 text-center text-[10px] text-cyan-400 font-mono animate-fade-in">
              {dryRunMsg}
            </div>
          )}
        </div>
        </div>
      )}

      {/* Intent Detail Modal */}
      {inspectDeviceId !== null && (
        <DeviceDetailModal
          deviceId={inspectDeviceId}
          onClose={() => setInspectDeviceId(null)}
        />
      )}
    </div>
  );
};

export const TopologyMap = React.memo(TopologyMapComponent);
