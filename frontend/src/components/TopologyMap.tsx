import React, { useMemo, useState, useEffect } from 'react';
import { ExternalLink, Play, X, Layers, Network } from 'lucide-react';
import { api } from '../api';
import type { Device, ForecastAlert } from '../api';
import { PLATFORM_NAMES, ROLE_NAMES, StatusBadge } from './ui';

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
  arista_eos: { bg: 'rgba(99, 102, 241, 0.22)', stroke: 'rgba(129, 140, 248, 0.45)', text: '#c7d2fe', label: 'EOS' },
  cisco_iosxe: { bg: 'rgba(14, 165, 233, 0.22)', stroke: 'rgba(56, 189, 248, 0.45)', text: '#bae6fd', label: 'IOS-XE' },
  huawei_vrp: { bg: 'rgba(244, 63, 94, 0.22)', stroke: 'rgba(251, 113, 133, 0.45)', text: '#fecdd3', label: 'VRP' },
};


const linkLoad = (a: string, b: string) =>
  [...(a < b ? a + b : b + a)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 997, 7) % 70 + 15;

const loadColor = (pct: number) => (pct > 70 ? '#f43f5e' : pct > 50 ? '#d97706' : 'rgba(255,255,255,0.12)');

interface Props {
  devices: Device[];
  alerts: ForecastAlert[];
  onSelectDevice: (id: number) => void;
  onOpenDiff?: () => void;
  onRunDryRun?: (ids: number[]) => void;
}

export const TopologyMap: React.FC<Props> = ({
  devices,
  alerts,
  onSelectDevice,
  onRunDryRun,
}) => {
  const [viewMode, setViewMode] = useState<'clos' | 'enterprise'>('clos');
  const [hover, setHover] = useState<number | null>(null);
  const [popoverId, setPopoverId] = useState<number | null>(null);
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
  const activeLayers = useMemo(() => (
    hasBorder
      ? [
          { roles: ['border', 'border_firewall'], y: 24, label: 'Border' },
          { roles: ['spine'], y: 130, label: 'Spine' },
          { roles: ['leaf'], y: 236, label: 'Leaf' },
        ]
      : [
          { roles: ['spine'], y: 55, label: 'Spine' },
          { roles: ['leaf'], y: 215, label: 'Leaf' },
        ]
  ), [hasBorder]);

  const { nodes, links } = useMemo(() => {
    const pos = new Map<number, { x: number; y: number }>();
    const byLayer = activeLayers.map((layer) => devices.filter((d) => layer.roles.includes(d.role)));
    byLayer.forEach((list, li) =>
      list.forEach((d, i) => pos.set(d.id, { x: ((i + 1) * W) / (list.length + 1), y: activeLayers[li].y }))
    );
    const spine = devices.filter((d) => d.role === 'spine');
    const leaf = devices.filter((d) => d.role === 'leaf');
    const border = devices.filter((d) => ['border', 'border_firewall'].includes(d.role));

    const pairs: [Device, Device][] = [
      ...border.flatMap((b) => spine.map((s): [Device, Device] => [b, s])),
      ...spine.flatMap((s) => leaf.map((l): [Device, Device] => [s, l])),
    ];
    return {
      nodes: devices.filter((d) => pos.has(d.id)).map((d) => ({ d, ...pos.get(d.id)! })),
      links: pairs.map(([a, b]) => ({
        a,
        b,
        pa: pos.get(a.id)!,
        pb: pos.get(b.id)!,
        load: linkLoad(a.hostname, b.hostname),
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

  if (!devices.length) return <div className="py-12 text-center text-xs text-zinc-500">Нет устройств для карты</div>;

  return (
    <div className="relative">
      {/* Topology Mode Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-white/[0.06] bg-white/[0.01]">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setViewMode('clos')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-all ${
              viewMode === 'clos'
                ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>CLOS Дата-центр (Стенд)</span>
          </button>
          <button
            onClick={() => setViewMode('enterprise')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-all ${
              viewMode === 'enterprise'
                ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Network className="w-3.5 h-3.5" />
            <span>Иерархия КРОК (Enterprise 3-Tier)</span>
          </button>
        </div>
        <div className="text-[11px] text-zinc-500 font-mono hidden sm:block">
          {viewMode === 'clos'
            ? `${devices.length} узлов: ${[...new Set(devices.map((d) => PLATFORM_NAMES[d.platform] ?? d.platform))].join(' • ') || 'CLOS Fabric'}`
            : 'WAN • DMZ • Core • Distribution • Access'}
        </div>
      </div>

      {viewMode === 'clos' ? (
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

              return (
                <g key={id} opacity={hover === null && popoverId === null ? 1 : active ? 1 : 0.15}>
                  <path
                    d={path}
                    stroke={loadColor(load)}
                    strokeWidth={isCongested ? 2.2 : 1.2}
                    fill="none"
                  />
                  {isCongested && (
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
                    fill="#0e1017"
                    stroke={isSelected ? '#38bdf8' : isHovered ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.08)'}
                    strokeWidth={isSelected ? '1.5' : '1'}
                  />
                  <circle cx="12" cy={NODE_H / 2} r="3" fill={color} />
                  <text x="22" y="18" fontSize="11" fontWeight="600" fill="#f4f4f5" letterSpacing="-0.01em">
                    {d.hostname.split('.')[0]}
                  </text>
                  <text x="22" y="32" fontSize="9" fill="#71717a" fontFamily="monospace">
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
                      <circle cx="7" cy="7" r="6" fill="#f59e0b" stroke="#0e1017" strokeWidth="1.5" />
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
        /* Enterprise Hierarchical Diagram View */
        <div className="w-full overflow-x-auto p-4">
          <div className="min-w-[750px] space-y-4">
            {/* WAN Tier */}
            <div className="space-y-1.5">
              <div className="text-[10px] font-mono uppercase tracking-wider text-cyan-400 text-center">
                1. Внешний периметр (Internet & WAN)
              </div>
              <div className="flex justify-center gap-6">
                <div className="w-48 p-2.5 rounded-lg bg-white/[0.03] border border-white/[0.08] text-center">
                  <div className="text-xs font-semibold text-zinc-100">Router A (WAN)</div>
                  <div className="text-[10px] text-zinc-500 font-mono">198.51.100.1 • BGP AS 65000</div>
                </div>
                <div className="w-48 p-2.5 rounded-lg bg-white/[0.03] border border-white/[0.08] text-center">
                  <div className="text-xs font-semibold text-zinc-100">Router B (WAN Backup)</div>
                  <div className="text-[10px] text-zinc-500 font-mono">198.51.100.2 • BGP AS 65000</div>
                </div>
              </div>
            </div>

            {/* Firewalls & DMZ */}
            <div className="space-y-1.5">
              <div className="text-[10px] font-mono uppercase tracking-wider text-emerald-400 text-center">
                2. Межсетевые экраны & Демилитаризованная зона (DMZ)
              </div>
              <div className="flex justify-center gap-4">
                <div className="w-44 p-2.5 rounded-lg bg-white/[0.03] border border-emerald-500/20 text-center">
                  <div className="text-xs font-semibold text-zinc-100">Firewall A</div>
                  <div className="text-[10px] text-zinc-500 font-mono">192.168.50.1 • Active</div>
                </div>
                <div className="w-56 p-2.5 rounded-lg bg-emerald-500/5 border border-emerald-500/30 text-center">
                  <div className="text-xs font-semibold text-emerald-400">DMZ Servers (192.168.90.0/24)</div>
                  <div className="text-[10px] text-zinc-400 font-mono">Web • Mail • DNS Services</div>
                </div>
                <div className="w-44 p-2.5 rounded-lg bg-white/[0.03] border border-emerald-500/20 text-center">
                  <div className="text-xs font-semibold text-zinc-100">Firewall B</div>
                  <div className="text-[10px] text-zinc-500 font-mono">192.168.50.2 • Standby</div>
                </div>
              </div>
            </div>

            {/* Core Switch */}
            <div className="space-y-1.5">
              <div className="text-[10px] font-mono uppercase tracking-wider text-cyan-400 text-center">
                3. Ядро сети (Core Aggregation)
              </div>
              <div className="flex justify-center">
                <div className="w-64 p-3 rounded-lg bg-white/[0.04] border border-cyan-500/30 text-center">
                  <div className="text-xs font-bold text-cyan-300">Core Switch (M-LAG / Virtual Chassis)</div>
                  <div className="text-[10px] text-zinc-400 font-mono">10.255.0.1 • 40G Uplinks</div>
                </div>
              </div>
            </div>

            {/* Distribution Tier */}
            <div className="space-y-1.5">
              <div className="text-[10px] font-mono uppercase tracking-wider text-amber-400 text-center">
                4. Уровень распределения (Distribution Switches)
              </div>
              <div className="flex justify-center gap-8">
                <div className="w-52 p-2.5 rounded-lg bg-white/[0.03] border border-white/[0.08] text-center">
                  <div className="text-xs font-semibold text-zinc-100">Distribution Switch A</div>
                  <div className="text-[10px] text-zinc-500 font-mono">HSRP Active • 10.0.10.1</div>
                </div>
                <div className="w-52 p-2.5 rounded-lg bg-white/[0.03] border border-white/[0.08] text-center">
                  <div className="text-xs font-semibold text-zinc-100">Distribution Switch B</div>
                  <div className="text-[10px] text-zinc-500 font-mono">HSRP Standby • 10.0.10.2</div>
                </div>
              </div>
            </div>

            {/* Access & Workstations */}
            <div className="space-y-1.5">
              <div className="text-[10px] font-mono uppercase tracking-wider text-violet-400 text-center">
                5. Уровень доступа & Пользовательские сегменты (VLANs)
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="p-2.5 rounded-lg bg-white/[0.02] border border-white/[0.06] text-center">
                  <div className="text-xs font-medium text-zinc-200">Access Switch 1</div>
                  <div className="text-[10px] text-cyan-400 font-mono">Data VLAN 10 (10.0.10.0/24)</div>
                  <div className="text-[9px] text-zinc-500">Workstation 1 & 2</div>
                </div>
                <div className="p-2.5 rounded-lg bg-white/[0.02] border border-white/[0.06] text-center">
                  <div className="text-xs font-medium text-zinc-200">Access Switch 2</div>
                  <div className="text-[10px] text-emerald-400 font-mono">Voice VLAN 20 (10.0.20.0/24)</div>
                  <div className="text-[9px] text-zinc-500">IP Phones & Telephony</div>
                </div>
                <div className="p-2.5 rounded-lg bg-white/[0.02] border border-white/[0.06] text-center">
                  <div className="text-xs font-medium text-zinc-200">Access Switch 3</div>
                  <div className="text-[10px] text-amber-400 font-mono">Corporate Workstations</div>
                  <div className="text-[9px] text-zinc-500">Workstation 3 & 4</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Popover on click */}
      {popoverNode && (
        <div
          className="absolute z-30 w-72 glass-panel rounded-lg shadow-2xl p-3 border border-white/[0.14] text-xs pointer-events-auto animate-fade-in"
          style={{
            left: `${Math.min(Math.max((popoverNode.x / W) * 100, 16), 84)}%`,
            top: `${Math.min((popoverNode.y / H) * 100 + 16, 70)}%`,
            transform: 'translateX(-50%)',
          }}
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
          </div>

          {dryRunMsg && (
            <div className="mt-2 text-center text-[10px] text-cyan-400 font-mono animate-fade-in">
              {dryRunMsg}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
