import React, { useEffect } from 'react';
import { X, CheckCircle2, AlertTriangle, RotateCw, Clock } from 'lucide-react';
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

export const StatusBadge: React.FC<{ status: DeviceStatus; className?: string }> = React.memo(({ status, className = '' }) => {
  const s = STATUS[status] ?? STATUS.UNKNOWN;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded border text-[11px] font-mono font-medium ${s.bg} ${s.text} ${s.border} ${className}`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${s.dot}`} />
      <span>{s.label}</span>
    </span>
  );
});

export const OperStatusBadge: React.FC<{ status?: OperStatus; className?: string }> = React.memo(({ status = 'UP', className = '' }) => {
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
});

export const Sparkline: React.FC<{
  points?: number[];
  width?: number;
  height?: number;
  className?: string;
}> = React.memo(({ points = [], width = 72, height = 20, className = '' }) => {
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
});

export const StateTimeline: React.FC<{
  states?: string[];
  className?: string;
}> = React.memo(({ states = [], className = '' }) => {
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
});

export const ManagementModeBadge: React.FC<{ mode?: string; className?: string }> = React.memo(({ mode = 'MONITORING_ONLY', className = '' }) => {
  const isManaged = mode === 'MANAGED';
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded border text-[10px] font-mono font-medium ${
        isManaged
          ? 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30'
          : 'bg-zinc-800/80 text-zinc-400 border-zinc-700'
      } ${className}`}
      title={isManaged ? 'Управляемое: разрешены деплой и мутации' : 'Только наблюдение: безопасный режим чтения'}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${isManaged ? 'bg-indigo-400 shadow-[0_0_6px_rgba(129,140,248,0.8)]' : 'bg-zinc-500'}`} />
      <span>{isManaged ? 'УПРАВЛЯЕМОЕ' : 'НАБЛЮДЕНИЕ'}</span>
    </span>
  );
});

export const Panel: React.FC<{
  title: string;
  accent?: string;
  indicator?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}> = React.memo(({
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
      <div className="bg-[#10131d]/90 border-b border-white/[0.06] px-3 py-2 text-xs font-medium text-zinc-200 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColor}`} />
          <span className="tracking-tight text-white font-medium">{title}</span>
        </div>
        {right && <div className="text-zinc-400 text-xs">{right}</div>}
      </div>
      <div className="p-3">{children}</div>
    </section>
  );
});

export const BentoCard: React.FC<{
  title: string;
  icon?: React.ReactNode;
  indicator?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}> = React.memo(({ title, icon, indicator = 'bg-zinc-500', right, children, className = '' }) => (
  <section className={`rounded-xl border border-white/[0.08] bg-[#0c0e15] overflow-hidden flex flex-col shadow-sm transition-all hover:border-white/[0.12] ${className}`}>
    <div className="bg-[#10131d]/90 border-b border-white/[0.06] px-3.5 py-2.5 text-xs font-medium text-zinc-200 flex items-center justify-between shrink-0">
      <div className="flex items-center gap-2">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${indicator}`} />
        {icon}
        <span className="tracking-tight text-white font-medium">{title}</span>
      </div>
      {right && <div className="text-zinc-400 text-xs">{right}</div>}
    </div>
    <div className="p-3.5 flex-1 min-h-0 overflow-hidden">{children}</div>
  </section>
));

export const JobStatusBadge: React.FC<{ status: string; className?: string }> = React.memo(({
  status,
  className = '',
}) => {
  switch (status) {
    case 'SUCCESS':
      return (
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-mono font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/25 ${className}`}>
          <CheckCircle2 className="w-3 h-3" />
          <span>SUCCESS</span>
        </span>
      );
    case 'FAILED':
      return (
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-mono font-medium bg-rose-500/10 text-rose-400 border border-rose-500/25 ${className}`}>
          <AlertTriangle className="w-3 h-3" />
          <span>FAILED</span>
        </span>
      );
    case 'RUNNING':
      return (
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-mono font-medium bg-cyan-500/10 text-cyan-400 border border-cyan-500/25 animate-pulse ${className}`}>
          <RotateCw className="w-3 h-3 animate-spin" />
          <span>RUNNING</span>
        </span>
      );
    case 'PENDING':
      return (
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-mono font-medium bg-amber-500/10 text-amber-400 border border-amber-500/25 ${className}`}>
          <Clock className="w-3 h-3" />
          <span>PENDING</span>
        </span>
      );
    default:
      return (
        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-mono font-medium bg-zinc-800/80 text-zinc-400 border border-zinc-700 ${className}`}>
          <span>{status}</span>
        </span>
      );
  }
});

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  children: React.ReactNode;
  maxWidth?: string;
  footer?: React.ReactNode;
}

export const Modal: React.FC<ModalProps> = ({
  open,
  onClose,
  title,
  icon,
  badge,
  children,
  maxWidth = 'max-w-xl',
  footer,
}) => {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="fixed inset-0 bg-black/70 backdrop-blur-sm transition-opacity animate-fade-in"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        className={`relative w-full ${maxWidth} rounded-2xl bg-[#0c0e15] border border-white/[0.1] shadow-2xl overflow-hidden flex flex-col z-10 text-zinc-200 animate-win-fade`}
      >
        <div className="px-5 py-4 border-b border-white/[0.08] flex items-center justify-between bg-[#10131d]/90">
          <div className="flex items-center gap-2.5">
            {icon}
            <h3 className="text-sm font-semibold text-white tracking-tight">{title}</h3>
            {badge}
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
            title="Закрыть (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 overflow-y-auto max-h-[calc(90vh-120px)]">{children}</div>
        {footer && (
          <div className="px-5 py-3 border-t border-white/[0.08] bg-[#0e111a] flex items-center justify-end gap-2">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};
