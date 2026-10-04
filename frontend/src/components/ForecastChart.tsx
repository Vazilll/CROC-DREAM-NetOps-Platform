import React, { useState } from 'react';
import type { Forecast, ForecastEvent } from '../api';

const W = 820;
const H = 250;
const PAD = { l: 40, r: 16, t: 26, b: 26 };

const EVENT_CONFIG: Record<
  string,
  { color: string; label: string; symbol: string; bg: string; border: string }
> = {
  DEPLOY: {
    color: '#10b981',
    label: 'DEPLOY',
    symbol: 'D',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/30',
  },
  DRIFT_DETECTED: {
    color: '#f59e0b',
    label: 'DRIFT',
    symbol: '!',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/30',
  },
  REMEDIATE: {
    color: '#06b6d4',
    label: 'REMEDIATE',
    symbol: 'R',
    bg: 'bg-cyan-500/10',
    border: 'border-cyan-500/30',
  },
  CHAOS: {
    color: '#f43f5e',
    label: 'CHAOS',
    symbol: '⚡',
    bg: 'bg-rose-500/10',
    border: 'border-rose-500/30',
  },
};

export const ForecastChart: React.FC<{ data: Forecast }> = ({ data }) => {
  const { history, median, lower, upper, threshold, step_seconds, events = [] } = data;
  const [hoveredEvent, setHoveredEvent] = useState<{ event: ForecastEvent; x: number; y: number } | null>(null);

  const total = Math.max(history.length + median.length, 2);
  const x = (i: number) => PAD.l + (i / (total - 1)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - Math.min(Math.max(v, 0), 100) / 100) * (H - PAD.t - PAD.b);

  const path = (vals: number[], offset: number) =>
    vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i + offset).toFixed(1)},${y(v).toFixed(1)}`).join(' ');

  const n = history.length;
  const band =
    n > 0 && median.length > 0
      ? `M${x(n).toFixed(1)},${y(history[n - 1] ?? median[0]).toFixed(1)} ` +
        upper.map((v, i) => `L${x(n + i).toFixed(1)},${y(v).toFixed(1)}`).join(' ') +
        lower.map((_, i) => `L${x(n + median.length - 1 - i).toFixed(1)},${y(lower[median.length - 1 - i]).toFixed(1)}`).join(' ') +
        ' Z'
      : '';

  const hours = (m: number) => Math.round((m * step_seconds) / 3600);

  const endMs = React.useMemo(
    () => (data.end_ts ? new Date(data.end_ts).getTime() : null),
    [data.end_ts]
  );

  // Compute coordinate X for an event
  const getEventX = (evt: ForecastEvent): number | null => {
    if (evt.relative_index !== undefined && evt.relative_index >= 0 && evt.relative_index < total) {
      return x(evt.relative_index);
    }
    if (evt.timestamp && endMs !== null) {
      const eventMs = new Date(evt.timestamp).getTime();
      const diffSec = (endMs - eventMs) / 1000;
      const stepsAgo = diffSec / Math.max(step_seconds, 1);
      const computedIdx = (n - 1) - Math.round(stepsAgo);
      if (computedIdx >= 0 && computedIdx < total) {
        return x(computedIdx);
      }
    }
    return null;
  };

  return (
    <div className="relative select-none">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto overflow-visible">
        <defs>
          {/* Soft risk threshold zone gradients */}
          <linearGradient id="riskNormalGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10b981" stopOpacity="0.06" />
            <stop offset="100%" stopColor="#10b981" stopOpacity="0.02" />
          </linearGradient>
          <linearGradient id="riskWarningGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.10" />
            <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.04" />
          </linearGradient>
          <linearGradient id="riskCriticalGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f43f5e" stopOpacity="0.14" />
            <stop offset="100%" stopColor="#f43f5e" stopOpacity="0.06" />
          </linearGradient>
          <linearGradient id="forecastBandGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.06" />
          </linearGradient>
        </defs>

        {/* --- Soft Gradient Risk Threshold Zones --- */}
        {/* Normal Zone (0 - 70%) */}
        <rect
          x={PAD.l}
          y={y(70)}
          width={W - PAD.l - PAD.r}
          height={y(0) - y(70)}
          fill="url(#riskNormalGrad)"
        />

        {/* Warning Zone (70 - 85%) */}
        <rect
          x={PAD.l}
          y={y(85)}
          width={W - PAD.l - PAD.r}
          height={y(70) - y(85)}
          fill="url(#riskWarningGrad)"
        />

        {/* Critical Zone (85 - 100%) */}
        <rect
          x={PAD.l}
          y={y(100)}
          width={W - PAD.l - PAD.r}
          height={y(85) - y(100)}
          fill="url(#riskCriticalGrad)"
        />

        {/* Zone threshold lines */}
        <line
          x1={PAD.l}
          x2={W - PAD.r}
          y1={y(70)}
          y2={y(70)}
          stroke="rgba(245,158,11,0.22)"
          strokeDasharray="2 3"
        />
        <line
          x1={PAD.l}
          x2={W - PAD.r}
          y1={y(85)}
          y2={y(85)}
          stroke="rgba(244,63,94,0.3)"
          strokeDasharray="2 3"
        />

        {/* Axis ticks and grid */}
        {[0, 25, 50, 70, 85, 100].map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="rgba(255,255,255,0.04)" />
            <text x={PAD.l - 6} y={y(t) + 3} textAnchor="end" fontSize="9" fill="#71717a" fontFamily="monospace">
              {t}%
            </text>
          </g>
        ))}

        {/* Configured Breach Threshold line */}
        <line
          x1={PAD.l}
          x2={W - PAD.r}
          y1={y(threshold)}
          y2={y(threshold)}
          stroke="#f43f5e"
          strokeDasharray="4 4"
          strokeWidth="1.5"
        />
        <text
          x={W - PAD.r}
          y={y(threshold) - 5}
          textAnchor="end"
          fontSize="9"
          fontWeight="600"
          fill="#f43f5e"
          fontFamily="monospace"
        >
          порог {threshold}%
        </text>

        {/* Forecast Confidence Interval Band */}
        {band && <path d={band} fill="url(#forecastBandGrad)" />}

        {/* Telemetry History Line */}
        {history.length > 0 && (
          <path d={path(history, 0)} fill="none" stroke="#94a3b8" strokeWidth="1.5" />
        )}

        {/* Predicted Forecast Median Line */}
        {median.length > 0 && history.length > 0 && (
          <path
            d={path([history[n - 1], ...median], n - 1)}
            fill="none"
            stroke="#06b6d4"
            strokeWidth="2"
            strokeDasharray="5 3"
          />
        )}

        {/* Present time vertical separator */}
        <line
          x1={x(n - 1)}
          x2={x(n - 1)}
          y1={PAD.t}
          y2={H - PAD.b}
          stroke="rgba(255,255,255,0.3)"
          strokeWidth="1"
        />
        <text x={x(n - 1)} y={H - 8} textAnchor="middle" fontSize="9" fill="#94a3b8" fontFamily="monospace">
          сейчас
        </text>
        <text x={PAD.l} y={H - 8} fontSize="9" fill="#64748b" fontFamily="monospace">
          -{hours(n)}ч
        </text>
        <text x={W - PAD.r} y={H - 8} textAnchor="end" fontSize="9" fill="#64748b" fontFamily="monospace">
          +{hours(median.length)}ч
        </text>

        {/* --- Vertical Grafana-style Event Markers --- */}
        {events.map((evt, idx) => {
          const posX = getEventX(evt);
          if (posX === null) return null;
          const cfg = EVENT_CONFIG[evt.type] ?? {
            color: '#a1a1aa',
            label: evt.type,
            symbol: '•',
            bg: 'bg-zinc-500/10',
            border: 'border-zinc-500/30',
          };

          return (
            <g key={`${evt.type}-${idx}-${evt.timestamp}`}>
              {/* Vertical dashed event line */}
              <line
                x1={posX}
                x2={posX}
                y1={PAD.t - 4}
                y2={H - PAD.b}
                stroke={cfg.color}
                strokeDasharray="3 3"
                strokeWidth="1.5"
                opacity="0.85"
                data-event={evt.type}
                className="event-marker"
              />

              {/* Top marker badge */}
              <circle
                cx={posX}
                cy={PAD.t - 8}
                r="7"
                fill="#0b0e14"
                stroke={cfg.color}
                strokeWidth="1.5"
                data-event={evt.type}
                className="event-marker cursor-pointer hover:scale-125 transition-transform"
                onMouseEnter={() => setHoveredEvent({ event: evt, x: posX, y: PAD.t - 8 })}
                onMouseLeave={() => setHoveredEvent(null)}
              />
              <text
                x={posX}
                y={PAD.t - 5}
                textAnchor="middle"
                fontSize="8"
                fontWeight="700"
                fill={cfg.color}
                pointerEvents="none"
              >
                {cfg.symbol}
              </text>

              {/* Broad hit target for ease of hover */}
              <rect
                x={posX - 10}
                y={PAD.t - 14}
                width="20"
                height={H - PAD.b - PAD.t + 20}
                fill="transparent"
                className="cursor-pointer"
                onMouseEnter={() => setHoveredEvent({ event: evt, x: posX, y: PAD.t - 8 })}
                onMouseLeave={() => setHoveredEvent(null)}
              />
            </g>
          );
        })}
      </svg>

      {/* Interactive Grafana-Style Hover Tooltip */}
      {hoveredEvent && (
        <div
          className="absolute z-40 w-64 glass-panel rounded-lg shadow-2xl p-2.5 border border-white/[0.14] text-xs pointer-events-none animate-fade-in"
          style={{
            left: `${Math.min(Math.max((hoveredEvent.x / W) * 100, 15), 82)}%`,
            top: '0px',
            transform: 'translate(-50%, -8px)',
          }}
        >
          <div className="flex items-center justify-between pb-1.5 border-b border-white/[0.08] mb-1.5">
            <div className="flex items-center gap-1.5">
              <span
                className="w-2 h-2 rounded-full"
                style={{
                  background: EVENT_CONFIG[hoveredEvent.event.type]?.color ?? '#a1a1aa',
                }}
              />
              <span className="font-semibold text-white tracking-tight">
                {hoveredEvent.event.title}
              </span>
            </div>
            <span
              className={`px-1.5 py-0.5 rounded text-[10px] font-mono uppercase font-medium border ${
                EVENT_CONFIG[hoveredEvent.event.type]?.bg ?? 'bg-white/[0.05]'
              } ${EVENT_CONFIG[hoveredEvent.event.type]?.border ?? 'border-white/[0.1]'}`}
              style={{ color: EVENT_CONFIG[hoveredEvent.event.type]?.color }}
            >
              {hoveredEvent.event.type}
            </span>
          </div>

          <p className="text-zinc-300 text-[11px] leading-relaxed mb-2">
            {hoveredEvent.event.description}
          </p>

          <div className="flex items-center justify-between text-[10px] text-zinc-500 font-mono pt-1 border-t border-white/[0.06]">
            <span>{new Date(hoveredEvent.event.timestamp).toLocaleString('ru-RU')}</span>
            <span className="uppercase text-zinc-400">
              Важность: {hoveredEvent.event.severity}
            </span>
          </div>
        </div>
      )}

      {/* Footer Legend for Event Markers and Risk Zones */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-1 pt-2 text-[10px] text-zinc-500 font-mono">
        <div className="flex items-center gap-3">
          <span className="text-zinc-400 font-medium">События:</span>
          {Object.entries(EVENT_CONFIG).map(([type, cfg]) => {
            const count = events.filter((e) => e.type === type).length;
            return (
              <span key={type} className="flex items-center gap-1">
                <span
                  className="w-3.5 h-3.5 rounded-full border flex items-center justify-center text-[8px] font-bold"
                  style={{
                    borderColor: cfg.color,
                    color: cfg.color,
                    backgroundColor: 'rgba(12,14,20,0.8)',
                  }}
                >
                  {cfg.symbol}
                </span>
                <span className="font-sans text-zinc-300">{cfg.label}</span>
                {count > 0 && (
                  <span className="text-zinc-500">({count})</span>
                )}
              </span>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-xs bg-emerald-500/20 border border-emerald-500/40" />
            <span className="text-zinc-400 font-sans">Норма &le;70%</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-xs bg-amber-500/30 border border-amber-500/50" />
            <span className="text-zinc-400 font-sans">Риск 70-85%</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-xs bg-rose-500/40 border border-rose-500/60" />
            <span className="text-zinc-400 font-sans">Критично &gt;85%</span>
          </span>
        </div>
      </div>
    </div>
  );
};
