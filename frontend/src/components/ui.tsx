import React from 'react';
import type { DeviceStatus, OperStatus } from '../api';

const STATUS: Record<string, { label: string; dot: string; text: string; bg: string; border: string }> = {
  IN_SYNC: {
    label: 'В синхроне',
    dot: 'bg-emerald-400',
    text: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/20',
  },
  DRIFT_DETECTED: {
    label: 'Дрейф',
    dot: 'bg-amber-400',
    text: 'text-amber-400',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/20',
  },
  UNREACHABLE: {
    label: 'Недоступно',
    dot: 'bg-rose-400',
    text: 'text-rose-400',
    bg: 'bg-rose-500/10',
    border: 'border-rose-500/20',
  },
  IN_PROGRESS: {
    label: 'В работе',
    dot: 'bg-cyan-400 animate-pulse',
    text: 'text-cyan-400',
    bg: 'bg-cyan-500/10',
    border: 'border-cyan-500/20',
  },
  UNKNOWN: {
    label: 'Неизвестно',
    dot: 'bg-zinc-500',
    text: 'text-zinc-400',
    bg: 'bg-white/[0.03]',
    border: 'border-white/[0.08]',
  },
};

export const StatusBadge: React.FC<{ status: DeviceStatus; className?: string }> = ({ status, className = '' }) => {
  const s = STATUS[status] ?? STATUS.UNKNOWN;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded border text-[11px] font-mono font-medium ${s.bg} ${s.text} ${s.border} ${className}`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${s.dot}`} />
      <span>{s.label}</span>
    </span>
  );
};

export const OperStatusBadge: React.FC<{ status?: OperStatus; className?: string }> = ({ status = 'UP', className = '' }) => {
  const isUp = status === 'UP';
  const isDegraded = status === 'DEGRADED';
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded border text-[11px] font-mono font-medium ${
        isUp
          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
          : isDegraded
          ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
          : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
      } ${className}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isUp ? 'bg-emerald-400' : isDegraded ? 'bg-amber-400' : 'bg-rose-400'}`} />
      <span>{status}</span>
    </span>
  );
};

export const IntentStatusBadge: React.FC<{ status: DeviceStatus; className?: string }> = ({ status, className = '' }) => {
  return <StatusBadge status={status} className={className} />;
};

export const Sparkline: React.FC<{
  points?: number[];
  width?: number;
  height?: number;
  className?: string;
}> = ({ points = [], width = 72, height = 20, className = '' }) => {
  if (!points || points.length < 2) {
    return <span className="text-[11px] font-mono text-zinc-600">—</span>;
  }
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const pad = 2;
  const w = width - pad * 2;
  const h = height - pad * 2;

  const coords = points.map((v, i) => {
    const x = pad + (i / (points.length - 1)) * w;
    const y = height - pad - ((v - min) / range) * h;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const first = points[0];
  const last = points[points.length - 1];
  const diff = last - first;
  const trendColor = diff > 5 ? '#f59e0b' : diff < -5 ? '#10b981' : '#06b6d4';
  const arrow = diff > 5 ? '↗' : diff < -5 ? '↘' : '→';

  return (
    <div className={`inline-flex items-center gap-1.5 ${className}`}>
      <svg width={width} height={height} className="shrink-0 overflow-visible">
        <polyline
          fill="none"
          stroke={trendColor}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={coords.join(' ')}
        />
        <circle
          cx={coords[coords.length - 1].split(',')[0]}
          cy={coords[coords.length - 1].split(',')[1]}
          r="2"
          fill={trendColor}
        />
      </svg>
      <span className="font-mono text-[10px] text-zinc-400">{arrow}</span>
      <span className="font-mono text-[10px] text-zinc-300">{Math.round(last)}%</span>
    </div>
  );
};

export const StateTimeline: React.FC<{
  states?: string[];
  className?: string;
}> = ({ states = [], className = '' }) => {
  if (!states || states.length === 0) {
    return <span className="text-[11px] font-mono text-zinc-600">—</span>;
  }
  const getColor = (s: string) => {
    if (s === 'UP' || s === 'IN_SYNC' || s === 'HEALTHY') return 'bg-emerald-500/80 hover:bg-emerald-400';
    if (s === 'DRIFT' || s === 'DRIFT_DETECTED' || s === 'DEGRADED') return 'bg-amber-500/80 hover:bg-amber-400';
    if (s === 'DOWN' || s === 'UNREACHABLE' || s === 'CRITICAL') return 'bg-rose-500/80 hover:bg-rose-400';
    return 'bg-zinc-700/60 hover:bg-zinc-600';
  };

  return (
    <div className={`inline-flex items-center gap-0.5 ${className}`} title="24h State Timeline (последние 24 часа)">
      {states.map((st, i) => (
        <span
          key={i}
          className={`w-1.5 h-3.5 rounded-[1px] transition-colors cursor-help ${getColor(st)}`}
          title={`-${24 - i}ч: ${st}`}
        />
      ))}
    </div>
  );
};

export const PLATFORM_NAMES: Record<string, string> = {
  arista_eos: 'Arista EOS',
  cisco_iosxe: 'Cisco IOS-XE',
  huawei_vrp: 'Huawei VRP',
  juniper_junos: 'Juniper Junos',
  eltex_mes: 'Eltex MES',
  yadro_kornfe: 'YADRO Kornfe',
};

export const ROLE_NAMES: Record<string, string> = {
  spine: 'Spine',
  leaf: 'Leaf',
  border: 'Border',
  border_firewall: 'Border FW',
};

export const Panel: React.FC<{
  title: string;
  accent?: string;
  indicator?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}> = ({
  title,
  accent,
  indicator,
  right,
  children,
  className = '',
}) => {
  const dotColor = indicator ?? (
    accent?.includes('cyan') ? 'bg-cyan-400' :
    accent?.includes('emerald') || accent?.includes('teal') ? 'bg-emerald-400' :
    accent?.includes('amber') ? 'bg-amber-400' :
    accent?.includes('rose') || accent?.includes('red') ? 'bg-rose-400' :
    accent?.includes('indigo') || accent?.includes('violet') || accent?.includes('sky') ? 'bg-cyan-400' :
    'bg-zinc-500'
  );

  return (
    <section className={`rounded-lg border border-white/[0.08] bg-[#0c0e14] overflow-hidden ${className}`}>
      <div className="bg-[#10131b]/90 border-b border-white/[0.06] px-3 py-2 text-xs font-medium text-zinc-200 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColor}`} />
          <span className="tracking-tight text-white font-medium">{title}</span>
        </div>
        {right && <div className="text-zinc-400 text-xs">{right}</div>}
      </div>
      <div className="p-3">{children}</div>
    </section>
  );
};
