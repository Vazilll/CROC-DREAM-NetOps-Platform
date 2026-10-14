import React, { useMemo, useState, useEffect } from 'react';
import { ExternalLink, Play, X, Network, Cpu } from 'lucide-react';
import { api } from '../../api';
import type { Device, ForecastAlert } from '../../api';
import type { Locale } from '../../i18n';
import { StatusBadge } from '../layout/ui';
import { PLATFORM_NAMES, ROLE_NAMES } from '../../constants';
import { DeviceDetailModal } from '../modals/DeviceDetailModal';

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
