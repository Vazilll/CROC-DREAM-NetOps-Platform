import React from 'react';
import { ExternalLink, Play, X, Cpu, Route, ShieldAlert, RotateCcw } from 'lucide-react';
import type { Device, TopologyGraphNode } from '../../api';
import { StatusBadge } from '../layout/ui';
import { PLATFORM_NAMES, ROLE_NAMES } from '../../constants';

interface TopologyNodePopoverProps {
  device: Device;
  meta?: TopologyGraphNode;
  onClose: () => void;
  onSelectDevice: (id: number) => void;
  onInspectIntent: (id: number) => void;
  onRunDryRun?: (id: number) => void;
  dryRunRunning: boolean;
  dryRunMsg: string | null;
  onSetTraceSource?: (id: number) => void;
  onSetTraceTarget?: (id: number) => void;
  onToggleDrain?: (id: number, nextDrained: boolean) => void;
  drainBusy?: boolean;
  onChangeProtocol?: (hostname: string, protocol: string) => Promise<void>;
  protocolBusy?: boolean;
  userRole?: string;
}

export const TopologyNodePopover: React.FC<TopologyNodePopoverProps> = ({
  device,
  meta,
  onClose,
  onSelectDevice,
  onInspectIntent,
  onRunDryRun,
  dryRunRunning,
  dryRunMsg,
  onSetTraceSource,
  onSetTraceTarget,
  onToggleDrain,
  drainBusy = false,
  onChangeProtocol,
  protocolBusy = false,
  userRole,
}) => {
  const isViewer = userRole === 'viewer';
  const activeProto = meta?.telemetry_protocol || 'ssh_cli';
  const selectedMode = meta?.telemetry_mode || 'auto';
  return (
  <div
    className="fixed inset-0 z-[45] flex items-center justify-center bg-black/40 backdrop-blur-[2px]"
    onClick={onClose}
  >
    <div
      onClick={(e) => e.stopPropagation()}
      className="w-80 max-w-[92vw] max-h-[90vh] overflow-y-auto bento-card rounded-lg shadow-2xl p-4 border border-[var(--border-subtle)] text-xs animate-fade-in"
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-semibold text-zinc-100">{device.hostname}</span>
          {meta?.drained && (
            <span
              data-testid="node-drained-badge"
              className="px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/40 text-amber-300 text-[9px] font-mono font-bold tracking-wide"
            >
              BGP GSHUT · DRAINED
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded text-zinc-400 hover:text-white hover:bg-white/[0.06]"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="space-y-1 mb-3 text-[11px] text-zinc-400">
        <div className="flex justify-between">
          <span>IP / Порт:</span>
          <span className="font-mono text-zinc-200">
            {device.management_ip}:{device.management_port}
          </span>
        </div>
        <div className="flex justify-between">
          <span>Платформа:</span>
          <span className="text-zinc-200">
            {PLATFORM_NAMES[device.platform] ?? device.platform}
          </span>
        </div>
        <div className="flex justify-between">
          <span>Роль / Стенд:</span>
          <span className="text-zinc-200 font-mono">
            {ROLE_NAMES[device.role] ?? device.role}
            {device.fabric_id ? ` · ${device.fabric_id}` : ''}
          </span>
        </div>
        {meta?.load_pct !== undefined && (
          <div className="flex justify-between">
            <span>Нагрузка узла:</span>
            <span className="font-mono text-cyan-300 font-semibold">
              {meta.load_pct}%
            </span>
          </div>
        )}
        {meta?.bgp && (
          <div className="flex justify-between">
            <span>BGP / Router-ID:</span>
            <span className="text-zinc-200 font-mono">
              AS{meta.bgp.asn} ({meta.bgp.router_id})
            </span>
          </div>
        )}
        {meta?.total_links !== undefined && meta.total_links > 0 && (
          <div className="flex justify-between">
            <span>Связи (линки):</span>
            <span className={`font-mono ${meta.shutdown_links === meta.total_links ? 'text-rose-400 font-semibold' : (meta.shutdown_links || 0) > 0 ? 'text-amber-400 font-semibold' : 'text-emerald-400'}`}>
              {meta.shutdown_links === meta.total_links
                ? `ВЫКЛ ВСЕ (${meta.shutdown_links}/${meta.total_links})`
                : (meta.shutdown_links || 0) > 0
                ? `ВЫКЛ ${meta.shutdown_links} из ${meta.total_links}`
                : `ВСЕ АКТИВНЫ (${meta.total_links}/${meta.total_links})`}
            </span>
          </div>
        )}
        <div className="flex justify-between items-center pt-1">
          <span>Статус:</span>
          <StatusBadge status={device.status} />
        </div>
        <div className="flex justify-between items-center">
          <span>Транзакция:</span>
          <span className="text-zinc-300 font-mono text-[10px]">
            {device.platform === 'huawei_vrp'
              ? 'commit trial'
              : device.platform === 'cisco_iosxe'
              ? 'commit confirmed'
              : 'commit timer'}
          </span>
        </div>
        <div className="pt-1.5 mt-1.5 border-t border-white/[0.06] space-y-1">
          <div className="flex items-center justify-between">
            <span>Протокол метрик:</span>
            <span className="font-mono text-[10px] text-cyan-300 uppercase">
              {activeProto}
              {meta?.telemetry_port ? ` :${meta.telemetry_port}` : ''}
            </span>
          </div>
          {onChangeProtocol && (
            <select
              data-testid="popover-protocol-select"
              disabled={isViewer || protocolBusy}
              value={selectedMode === 'node_exporter' ? 'prometheus_exporter' : selectedMode}
              onChange={(e) => void onChangeProtocol(device.hostname, e.target.value)}
              className="w-full px-2 py-1 rounded bg-[#08090c] border border-white/[0.12] text-[11px] font-mono text-zinc-200 focus:outline-none focus:border-cyan-400 disabled:opacity-50 cursor-pointer"
            >
              <option value="auto">Авто (Каскад gNMI → SNMP → SSH)</option>
              <option value="gnmi">gNMI Streaming (:6030)</option>
              <option value="snmp">SNMP v2c/v3 (:161)</option>
              <option value="prometheus_exporter">Node Exporter (:9100)</option>
              <option value="ssh_cli">SSH CLI Пул (:{device.management_port})</option>
            </select>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-1.5 pt-2 border-t border-white/[0.08]">
        {onSetTraceSource && (
          <button
            type="button"
            data-testid="popover-trace-src-btn"
            onClick={() => {
              onSetTraceSource(device.id);
              onClose();
            }}
            className="flex items-center justify-center gap-1 px-2 py-1.5 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-200 text-[11px] font-medium transition-all cursor-pointer"
          >
            <Route className="w-3 h-3" />
            <span>Отсюда (А)</span>
          </button>
        )}

        {onSetTraceTarget && (
          <button
            type="button"
            data-testid="popover-trace-dst-btn"
            onClick={() => {
              onSetTraceTarget(device.id);
              onClose();
            }}
            className="flex items-center justify-center gap-1 px-2 py-1.5 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-200 text-[11px] font-medium transition-all cursor-pointer"
          >
            <Route className="w-3 h-3" />
            <span>Сюда (Б)</span>
          </button>
        )}

        <button
          onClick={() => {
            onSelectDevice(device.id);
            onClose();
          }}
          className="flex items-center justify-center gap-1 px-2 py-1.5 rounded bg-white/[0.04] hover:bg-white/[0.08] text-zinc-200 text-[11px] font-medium transition-all cursor-pointer"
        >
          <ExternalLink className="w-3 h-3" />
          <span>Паспорт</span>
        </button>

        {onRunDryRun && (
          <button
            onClick={() => onRunDryRun(device.id)}
            disabled={dryRunRunning || isViewer}
            title={isViewer ? 'Недоступно в режиме просмотра' : undefined}
            className={`flex items-center justify-center gap-1 px-2 py-1.5 rounded bg-zinc-900 border border-zinc-700 text-zinc-200 text-[11px] font-medium transition-all ${
              isViewer ? 'opacity-40 cursor-not-allowed' : 'hover:bg-zinc-800 disabled:opacity-50 cursor-pointer'
            }`}
          >
            <Play className="w-3 h-3" />
            <span>{dryRunRunning ? 'Запуск...' : 'Dry-run'}</span>
          </button>
        )}

        {onToggleDrain && (
          <button
            type="button"
            disabled={drainBusy || isViewer}
            data-testid="popover-toggle-drain-btn"
            onClick={() => {
              if (!isViewer && onToggleDrain) onToggleDrain(device.id, !meta?.drained);
            }}
            title={isViewer ? 'Недоступно в режиме просмотра' : undefined}
            className={`col-span-2 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded border text-[11px] font-medium transition-all ${
              isViewer ? 'opacity-40 cursor-not-allowed ' : 'cursor-pointer disabled:opacity-50 '
            }${
              meta?.drained
                ? 'bg-emerald-500/10 hover:bg-emerald-500/20 border-emerald-500/30 text-emerald-300'
                : 'bg-amber-500/10 hover:bg-amber-500/20 border-amber-500/30 text-amber-300'
            }`}
          >
            {meta?.drained ? (
              <>
                <RotateCcw className="w-3 h-3" />
                <span>Вернуть трафик</span>
              </>
            ) : (
              <>
                <ShieldAlert className="w-3 h-3" />
                <span>Увести трафик (Drain)</span>
              </>
            )}
          </button>
        )}

        <button
          onClick={() => {
            onInspectIntent(device.id);
            onClose();
          }}
          className="col-span-2 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/20 text-indigo-300 text-[11px] font-medium transition-all cursor-pointer"
        >
          <Cpu className="w-3 h-3" />
          <span>Конфиг (YAML)</span>
        </button>
      </div>

      {dryRunMsg && (
        <div className="mt-2 text-center text-[10px] text-cyan-400 font-mono animate-fade-in">
          {dryRunMsg}
        </div>
      )}
    </div>
  </div>
  );
};
