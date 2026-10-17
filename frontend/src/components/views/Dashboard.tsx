import React, { useEffect, useState, useMemo } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Play,
  GitCompare,
  ExternalLink,
  Server,
  Layers,
  Cpu,
  Clock,
  ShieldCheck,
  Plus,
} from 'lucide-react';
import { api } from '../../api';
import type { Device, ForecastAlert, JobSummary, UserRole } from '../../api';
import { translations, type Locale } from '../../i18n';
import { TopologyMap } from '../charts/TopologyMap';
import { BentoCard, Sparkline } from '../layout/ui';
import { PLATFORM_NAMES, ROLE_NAMES } from '../../constants';
import { AddDeviceModal } from '../modals/AddDeviceModal';
import { DeviceDrawer } from '../modals/DeviceDrawer';

interface DashboardProps {
  devices: Device[];
  jobs: JobSummary[];
  userRole?: UserRole;
  locale?: Locale;
  onOpenTab: (tab: string) => void;
  onOpenDevice: (id: number) => void;
  onRunDryRun?: (deviceIds: number[]) => void;
  onOpenDiff?: (jobId?: string) => void;
  onSyncInventory?: () => void;
}

const JOB_COLOR: Record<string, { text: string; bg: string; border: string }> = {
  SUCCESS: { text: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
  FAILED: { text: 'text-rose-600 dark:text-rose-400', bg: 'bg-rose-500/10', border: 'border-rose-500/20' },
  RUNNING: { text: 'text-cyan-600 dark:text-cyan-400', bg: 'bg-cyan-500/10', border: 'border-cyan-500/20' },
  PENDING: { text: 'text-[var(--text-secondary)]', bg: 'bg-[var(--bg-subtle)]', border: 'border-[var(--border-subtle)]' },
};

const DashboardComponent: React.FC<DashboardProps> = ({
  devices,
  jobs,
  userRole,
  locale = 'ru',
  onOpenTab,
  onOpenDevice,
  onRunDryRun,
  onOpenDiff,
  onSyncInventory,
}) => {
  const t = translations[locale];
  const [alerts, setAlerts] = useState<ForecastAlert[]>([]);
  const [dryRunRunning, setDryRunRunning] = useState<number | null>(null);
  const [dryRunSuccess, setDryRunSuccess] = useState<number | null>(null);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [drawerDeviceId, setDrawerDeviceId] = useState<number | null>(null);

  useEffect(() => {
    if (devices.length > 0) {
      api.getForecastAlerts().then(setAlerts).catch(() => setAlerts([]));
    }
  }, [devices.length]);

  const { inSyncCount, driftCount, unreachableCount, healthPercent } = useMemo(() => {
    let inSync = 0;
    let drift = 0;
    let unreachable = 0;
    for (const d of devices) {
      if (d.status === 'IN_SYNC' || d.status === 'UNKNOWN') inSync++;
      else if (d.status === 'DRIFT_DETECTED') drift++;
      else if (d.status === 'UNREACHABLE') unreachable++;
    }
    const hp = devices.length > 0 ? Math.round(((devices.length - drift - unreachable) / devices.length) * 100) : 100;
    return { inSyncCount: inSync, driftCount: drift, unreachableCount: unreachable, healthPercent: hp };
  }, [devices]);

  const handleAlertDryRun = async (deviceId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (onRunDryRun) {
      onRunDryRun([deviceId]);
      return;
    }
    setDryRunRunning(deviceId);
    try {
      await api.createDryRun([deviceId]);
      setDryRunSuccess(deviceId);
      setTimeout(() => setDryRunSuccess(null), 1800);
    } catch {
      // noop
    } finally {
      setDryRunRunning(null);
    }
  };

  const platformsCount = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const d of devices) {
      acc[d.platform] = (acc[d.platform] ?? 0) + 1;
    }
    return Object.entries(acc);
  }, [devices]);

  const rolesCount = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const d of devices) {
      acc[d.role] = (acc[d.role] ?? 0) + 1;
    }
    return Object.entries(acc);
  }, [devices]);

  if (devices.length === 0) {
    return (
      <div className="w-full max-w-[2560px] mx-auto py-10 sm:py-16 space-y-5 animate-fade-in select-none text-center">
        <h1 className="text-lg sm:text-xl font-semibold text-[var(--text-primary)] tracking-tight">
          {locale === 'en' ? 'No active devices' : 'Нет подключенных устройств'}
        </h1>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-lg mx-auto">
          <button
            onClick={() => setAddModalOpen(true)}
            className="p-4 rounded-lg border border-[var(--border-subtle)] hover:border-[var(--border-hover)] bg-[var(--bg-card)] transition-colors cursor-pointer flex items-center justify-center gap-2.5 text-xs font-semibold text-[var(--text-primary)]"
          >
            <Plus className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{locale === 'en' ? 'Add Device (SSH)' : 'Добавить узел (SSH)'}</span>
          </button>

          <button
            onClick={() => onSyncInventory && onSyncInventory()}
            className="p-4 rounded-lg border border-[var(--border-subtle)] hover:border-[var(--border-hover)] bg-[var(--bg-card)] transition-colors cursor-pointer flex items-center justify-center gap-2.5 text-xs font-semibold text-[var(--text-primary)]"
          >
            <Layers className="w-4 h-4 text-cyan-400 shrink-0" />
            <span>{locale === 'en' ? 'Sync Git SoT' : 'Синхронизировать Git SoT'}</span>
          </button>
        </div>

        <AddDeviceModal
          isOpen={addModalOpen}
          onClose={() => setAddModalOpen(false)}
          onSuccess={() => {
            if (onSyncInventory) onSyncInventory();
          }}
          userRole={userRole || 'admin'}
        />
      </div>
    );
  }

  return (
    <div className="w-full max-w-[2560px] mx-auto space-y-3 2xl:space-y-4 select-none">
      {/* 1. Health KPI Strip (Geist / Linear High-Density Metrics) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3 2xl:gap-4">
        <button
          onClick={() => onOpenTab('devices')}
          className="text-left rounded-lg border border-[var(--border-subtle)] hover:border-[var(--border-hover)] bg-[var(--bg-card)] px-3.5 py-2.5 transition-colors cursor-pointer flex items-center justify-between"
        >
          <div>
            <div className="text-[11px] text-[var(--text-secondary)] font-medium flex items-center gap-1.5">
              <Server className="w-3.5 h-3.5 text-[var(--text-muted)]" />
              <span>{t.cardDevices}</span>
            </div>
            <div className="text-2xl font-semibold font-mono tabular-nums mt-0.5 text-[var(--text-primary)] tracking-tight">
              {devices.length}
            </div>
          </div>
          <div className="text-right shrink-0">
            <span className="inline-block whitespace-nowrap text-[10px] font-mono tabular-nums px-1.5 py-0.5 rounded bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-secondary)]">
              {healthPercent}% {t.cardDevicesNormal}
            </span>
          </div>
        </button>

        <button
          onClick={() => onOpenTab('drift')}
          className="text-left rounded-lg border border-[var(--border-subtle)] hover:border-[var(--border-hover)] bg-[var(--bg-card)] px-3.5 py-2.5 transition-colors cursor-pointer flex items-center justify-between"
        >
          <div>
            <div className="text-[11px] text-[var(--text-secondary)] font-medium flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span>{t.cardInSync}</span>
            </div>
            <div className="text-2xl font-semibold font-mono tabular-nums mt-0.5 text-[var(--text-primary)] tracking-tight">
              {inSyncCount}
            </div>
          </div>
          <ShieldCheck className="w-4 h-4 text-[var(--text-muted)]" />
        </button>

        <button
          onClick={() => onOpenTab('drift')}
          className={`text-left rounded-lg border px-3.5 py-2.5 transition-colors cursor-pointer flex items-center justify-between ${
            driftCount > 0
              ? 'border-amber-500/35 bg-amber-500/[0.04] hover:border-amber-500/50'
              : 'border-[var(--border-subtle)] bg-[var(--bg-card)] hover:border-[var(--border-hover)]'
          }`}
        >
          <div>
            <div className="text-[11px] text-[var(--text-secondary)] font-medium flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${driftCount > 0 ? 'bg-amber-400' : 'bg-zinc-500'}`} />
              <span>{t.cardDrift}</span>
            </div>
            <div className={`text-2xl font-semibold font-mono tabular-nums mt-0.5 tracking-tight ${driftCount > 0 ? 'text-amber-500 dark:text-amber-400' : 'text-[var(--text-primary)]'}`}>
              {driftCount}
            </div>
          </div>
          <AlertTriangle className={`w-4 h-4 ${driftCount > 0 ? 'text-amber-400' : 'text-[var(--text-muted)]'}`} />
        </button>

        <button
          onClick={() => onOpenTab('devices')}
          className={`text-left rounded-lg border px-3.5 py-2.5 transition-colors cursor-pointer flex items-center justify-between ${
            unreachableCount > 0
              ? 'border-rose-500/35 bg-rose-500/[0.04] hover:border-rose-500/50'
              : 'border-[var(--border-subtle)] bg-[var(--bg-card)] hover:border-[var(--border-hover)]'
          }`}
        >
          <div>
            <div className="text-[11px] text-[var(--text-secondary)] font-medium flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${unreachableCount > 0 ? 'bg-rose-400' : 'bg-zinc-500'}`} />
              <span>{t.cardUnreachable}</span>
            </div>
            <div className={`text-2xl font-semibold font-mono tabular-nums mt-0.5 tracking-tight ${unreachableCount > 0 ? 'text-rose-500 dark:text-rose-400' : 'text-[var(--text-primary)]'}`}>
              {unreachableCount}
            </div>
          </div>
          <AlertTriangle className={`w-4 h-4 ${unreachableCount > 0 ? 'text-rose-400' : 'text-[var(--text-muted)]'}`} />
        </button>
      </div>

      {/* 2. Device Fleet & Live Load Matrix (SVG Area Sparklines) */}
      <BentoCard
        title={locale === 'en' ? 'Fabric Devices & Operational Load' : 'Сетевые узлы фабрики и операционная нагрузка'}
        icon={<Server className="w-3.5 h-3.5 text-[var(--text-muted)]" />}
        indicator="bg-emerald-400"
        right={
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] text-[var(--text-muted)] tabular-nums">
              {devices.length} {locale === 'en' ? 'nodes' : 'узлов'}
            </span>
            <button
              onClick={() => onOpenTab('devices')}
              className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] flex items-center gap-1 cursor-pointer transition-colors text-xs"
            >
              <span>{t.allDevices}</span>
              <ExternalLink className="w-3 h-3" />
            </button>
          </div>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6 gap-2.5 2xl:gap-3.5">
          {devices.map((device) => {
            const currentLoad =
              device.sparkline && device.sparkline.length > 0
                ? device.sparkline[device.sparkline.length - 1]
                : 0;
            const isHigh = currentLoad > 80;
            const isMedium = currentLoad > 55;

            return (
              <div
                key={device.id}
                onClick={() => setDrawerDeviceId(device.id)}
                className="group relative rounded-lg border border-[var(--border-subtle)] hover:border-[var(--border-hover)] bg-[var(--bg-main)]/60 hover:bg-[var(--bg-elevated)]/40 p-3 transition-colors cursor-pointer flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between gap-1.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                          device.status === 'UNREACHABLE'
                            ? 'bg-rose-400'
                            : device.status === 'DRIFT_DETECTED'
                            ? 'bg-amber-400'
                            : 'bg-emerald-400'
                        }`}
                      />
                      <span className="font-semibold text-xs text-[var(--text-primary)] truncate tracking-tight">
                        {device.hostname}
                      </span>
                    </div>
                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[var(--bg-elevated)] text-[var(--text-secondary)] border border-[var(--border-subtle)] uppercase shrink-0">
                      {device.platform.replace('_', '-')}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-[var(--text-muted)] mt-1">
                    <span>{device.management_ip}:{device.management_port}</span>
                    <span className="uppercase text-[10px] px-1 rounded bg-[var(--bg-subtle)] text-[var(--text-secondary)]">
                      {device.role}
                    </span>
                  </div>
                </div>

                <div className="mt-3 pt-2 border-t border-[var(--border-subtle)]">
                  <div className="flex items-center justify-between text-[10px] font-mono tabular-nums mb-1.5">
                    <span className="text-[var(--text-muted)]">
                      {locale === 'en' ? 'Uplink traffic:' : 'Трафик аплинка:'}
                    </span>
                    <span
                      className={`font-medium ${
                        !device.sparkline || device.sparkline.length === 0
                          ? 'text-[var(--text-muted)]'
                          : isHigh
                          ? 'text-rose-500 dark:text-rose-400'
                          : isMedium
                          ? 'text-amber-500 dark:text-amber-400'
                          : 'text-[var(--text-primary)]'
                      }`}
                    >
                      {device.sparkline && device.sparkline.length > 0
                        ? `${Math.round(currentLoad)}%`
                        : locale === 'en'
                        ? 'No data'
                        : 'Нет данных'}
                    </span>
                  </div>

                  {device.sparkline && device.sparkline.length > 0 ? (
                    <div className="h-7 w-full flex items-center">
                      <Sparkline
                        points={device.sparkline}
                        width={180}
                        height={26}
                        fullWidth
                        showValue={false}
                      />
                    </div>
                  ) : (
                    <div className="h-7 w-full flex items-center justify-center rounded border border-dashed border-[var(--border-subtle)] text-[10px] font-mono text-[var(--text-muted)]">
                      {locale === 'en' ? 'Waiting for metrics poll' : 'Ожидание опроса метрик'}
                    </div>
                  )}
                </div>

                <div className="mt-2 pt-2 border-t border-[var(--border-subtle)] flex items-center justify-between text-[10px] font-mono">
                  <span className="text-[var(--text-muted)]">
                    Oper:{' '}
                    <strong className={device.oper_status === 'UP' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}>
                      {device.oper_status || 'UP'}
                    </strong>
                  </span>
                  <span className="text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] flex items-center gap-0.5">
                    {locale === 'en' ? 'Inspector →' : 'Инспектор →'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </BentoCard>

      {/* 3. Bento Grid Central Arena */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-3 2xl:gap-4">
        {/* Left Column (7 cols on XL): CLOS Fabric Topology & Platform distribution */}
        <div className="xl:col-span-7 space-y-3">
          <BentoCard
            title={t.topologyTitle}
            indicator="bg-zinc-400"
            right={
              <button
                onClick={() => onOpenTab('devices')}
                className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] flex items-center gap-1 cursor-pointer transition-colors"
              >
                <span>{t.allDevices}</span>
                <ExternalLink className="w-3 h-3" />
              </button>
            }
          >
            <TopologyMap
              devices={devices}
              alerts={alerts}
              locale={locale}
              onSelectDevice={onOpenDevice}
              onRunDryRun={onRunDryRun}
            />
          </BentoCard>

          {/* Compact Platform & Role Inventory Strip */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <BentoCard title={t.platformsTitle} icon={<Cpu className="w-3.5 h-3.5 text-[var(--text-muted)]" />} indicator="bg-zinc-500">
              <div className="space-y-1.5">
                {platformsCount.map(([p, count]) => (
                  <div key={p} className="flex items-center justify-between text-[11px]">
                    <span className="text-[var(--text-secondary)] truncate">{PLATFORM_NAMES[p] ?? p}</span>
                    <span className="font-mono tabular-nums text-[var(--text-primary)] bg-[var(--bg-elevated)] px-1.5 py-0.5 rounded border border-[var(--border-subtle)]">
                      {count}
                    </span>
                  </div>
                ))}
              </div>
            </BentoCard>

            <BentoCard title={t.rolesTitle} icon={<Layers className="w-3.5 h-3.5 text-[var(--text-muted)]" />} indicator="bg-zinc-500">
              <div className="space-y-1.5">
                {rolesCount.map(([r, count]) => (
                  <div key={r} className="flex items-center justify-between text-[11px]">
                    <span className="text-[var(--text-secondary)] truncate">{ROLE_NAMES[r] ?? r}</span>
                    <span className="font-mono tabular-nums text-[var(--text-primary)] bg-[var(--bg-elevated)] px-1.5 py-0.5 rounded border border-[var(--border-subtle)]">
                      {count}
                    </span>
                  </div>
                ))}
              </div>
            </BentoCard>
          </div>
        </div>

        {/* Right Column (5 cols on XL): 6h Risk Radar & Recent Jobs */}
        <div className="xl:col-span-5 space-y-3">
          <BentoCard
            title={t.riskRadarTitle}
            indicator={alerts.length > 0 ? 'bg-amber-400' : 'bg-emerald-400'}
            right={
              <span className="font-mono text-[10px] text-[var(--text-muted)] tabular-nums">
                {alerts.length > 0 ? `${alerts.length} ${t.radarAnomCount}` : (locale === 'en' ? '0 risks' : '0 рисков')}
              </span>
            }
          >
            <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
              {alerts.map((a) => (
                <div
                  key={`${a.device_id}-${a.metric}`}
                  className="rounded-lg border border-amber-500/25 bg-amber-500/[0.03] p-2.5 flex flex-col gap-2 hover:border-amber-500/40 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                      <div className="min-w-0">
                        <div className="font-semibold text-[var(--text-primary)] text-xs truncate">
                          {a.hostname}
                        </div>
                        <div className="text-[11px] text-[var(--text-secondary)] truncate">
                          {a.label}
                        </div>
                      </div>
                    </div>
                    <span className="font-mono tabular-nums text-[11px] text-amber-600 dark:text-amber-300 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20 shrink-0">
                      &gt;{a.threshold}{a.metric === 'load_1m' ? '' : '%'} {locale === 'en' ? 'in' : 'через'} ~{a.breach_in_minutes}{locale === 'en' ? 'm' : 'м'}
                    </span>
                  </div>

                  <div className="flex items-center justify-end gap-1.5 pt-1.5 border-t border-[var(--border-subtle)]">
                    <button
                      onClick={() => onOpenDevice(a.device_id)}
                      className="px-2 py-1 rounded bg-[var(--bg-elevated)] hover:border-[var(--border-hover)] border border-[var(--border-subtle)] text-[var(--text-primary)] text-[11px] font-mono flex items-center gap-1 transition-colors cursor-pointer"
                      title="Открыть карточку устройства и прогноз"
                    >
                      <ExternalLink className="w-3 h-3 text-[var(--text-secondary)]" />
                      <span>{t.openBtn}</span>
                    </button>

                    <button
                      onClick={() => {
                        if (onOpenDiff) onOpenDiff();
                        else onOpenTab('diff');
                      }}
                      className="px-2 py-1 rounded bg-[var(--bg-elevated)] hover:border-[var(--border-hover)] border border-[var(--border-subtle)] text-[var(--text-primary)] text-[11px] font-mono flex items-center gap-1 transition-colors cursor-pointer"
                      title="Сверить конфигурации в DiffViewer"
                    >
                      <GitCompare className="w-3 h-3 text-[var(--text-secondary)]" />
                      <span>{t.diffBtn}</span>
                    </button>

                    <button
                      onClick={(e) => handleAlertDryRun(a.device_id, e)}
                      disabled={dryRunRunning === a.device_id}
                      className="px-2 py-1 rounded bg-[var(--text-primary)] text-[var(--bg-main)] hover:opacity-90 text-[11px] font-mono font-medium flex items-center gap-1 transition-opacity cursor-pointer disabled:opacity-50"
                      title="Запустить предиктивный Dry-run"
                    >
                      <Play className="w-3 h-3 fill-current" />
                      <span>
                        {dryRunSuccess === a.device_id
                          ? (locale === 'en' ? 'Launched!' : 'Запущен!')
                          : dryRunRunning === a.device_id
                          ? '...'
                          : t.dryRunBtn}
                      </span>
                    </button>
                  </div>
                </div>
              ))}

              {alerts.length === 0 && (
                <div className="py-6 text-center text-xs text-[var(--text-secondary)] flex flex-col items-center justify-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span className="text-[var(--text-primary)] font-medium">
                    {locale === 'en' ? 'Normal state' : 'Штатный режим'}
                  </span>
                  <span className="text-[var(--text-muted)] text-[11px]">
                    {locale === 'en' ? 'No metric threshold breaches forecasted within 6h' : 'Пробоев порогов в ближайшие 6 часов не прогнозируется'}
                  </span>
                </div>
              )}
            </div>
          </BentoCard>

          <BentoCard
            title={t.automationJobsTitle}
            icon={<Clock className="w-3.5 h-3.5 text-[var(--text-muted)]" />}
            indicator="bg-zinc-500"
            right={
              <button
                onClick={() => onOpenTab('jobs')}
                className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] flex items-center gap-1 cursor-pointer transition-colors"
              >
                <span>{t.auditLogBtn}</span>
                <ExternalLink className="w-3 h-3" />
              </button>
            }
          >
            <div className="space-y-1">
              {jobs.slice(0, 5).map((j) => {
                const s = JOB_COLOR[j.status] ?? JOB_COLOR.PENDING;
                return (
                  <div
                    key={j.id}
                    onClick={() => {
                      if (onOpenDiff) onOpenDiff(j.id);
                      else onOpenTab('jobs');
                    }}
                    className="flex items-center justify-between py-1.5 px-2 rounded-md hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer border border-transparent hover:border-[var(--border-subtle)] text-xs"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono text-[var(--text-primary)] truncate">{j.type}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[var(--text-muted)] text-[11px] font-mono tabular-nums">
                        {new Date(j.created_at).toLocaleTimeString(locale === 'en' ? 'en-US' : 'ru-RU', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                      <span
                        className={`font-mono text-[10px] px-1.5 py-0.5 rounded border ${s.bg} ${s.text} ${s.border}`}
                      >
                        {j.status}
                      </span>
                    </div>
                  </div>
                );
              })}

              {jobs.length === 0 && (
                <div className="py-4 text-center text-xs text-[var(--text-muted)]">{t.noRunsYet}</div>
              )}
            </div>
          </BentoCard>
        </div>
      </div>

      {/* Device Side Drawer Inspector */}
      <DeviceDrawer
        deviceId={drawerDeviceId}
        onClose={() => setDrawerDeviceId(null)}
        userRole={userRole || 'owner'}
        onOpenDiff={onOpenDiff}
        onRunDryRun={onRunDryRun}
        onOpenFullPage={onOpenDevice}
      />
    </div>
  );
};

export const Dashboard = React.memo(DashboardComponent);
