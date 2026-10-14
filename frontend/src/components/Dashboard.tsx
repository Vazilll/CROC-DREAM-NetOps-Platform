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
  ArrowRight,
  Presentation,
} from 'lucide-react';
import { api } from '../api';
import type { Device, ForecastAlert, JobSummary, AiGuardResponse, UserRole } from '../api';
import { translations, type Locale } from '../i18n';
import { TopologyMap } from './TopologyMap';
import { BentoCard } from './ui';
import { PLATFORM_NAMES, ROLE_NAMES } from '../constants';
import { AddDeviceModal } from './AddDeviceModal';
import { DeviceDrawer } from './DeviceDrawer';

const DEFAULT_DASHBOARD_SPARKLINE = [20, 25, 30, 22, 28, 35, 40, 38];

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
  SUCCESS: { text: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
  FAILED: { text: 'text-rose-400', bg: 'bg-rose-500/10', border: 'border-rose-500/20' },
  RUNNING: { text: 'text-cyan-400 animate-pulse', bg: 'bg-cyan-500/10', border: 'border-cyan-500/20' },
  PENDING: { text: 'text-zinc-400', bg: 'bg-white/[0.04]', border: 'border-white/[0.08]' },
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
  const [aiGuardList, setAiGuardList] = useState<AiGuardResponse[]>([]);
  const [dryRunRunning, setDryRunRunning] = useState<number | null>(null);
  const [dryRunSuccess, setDryRunSuccess] = useState<number | null>(null);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [drawerDeviceId, setDrawerDeviceId] = useState<number | null>(null);


  useEffect(() => {
    if (devices.length > 0) {
      api.getForecastAlerts().then(setAlerts).catch(() => setAlerts([]));
      api.getAiGuardOverview().then(setAiGuardList).catch(() => setAiGuardList([]));
    }
  }, [devices.length]);

  const aiAnomalies = useMemo(() => aiGuardList.filter((g) => !g.healthy), [aiGuardList]);

  const { inSyncCount, driftCount, unreachableCount, healthPercent } = useMemo(() => {
    let inSync = 0;
    let drift = 0;
    let unreachable = 0;
    for (const d of devices) {
      if (d.status === 'IN_SYNC') inSync++;
      else if (d.status === 'DRIFT_DETECTED') drift++;
      else if (d.status === 'UNREACHABLE') unreachable++;
    }
    const hp = devices.length > 0 ? Math.round((inSync / devices.length) * 100) : 100;
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

  // If there are no devices in the system, show the clean matte Onboarding & Connection prompt!
  if (devices.length === 0) {
    return (
      <div className="max-w-4xl mx-auto py-8 sm:py-14 space-y-8 animate-fade-in select-none">
        {/* Onboarding Header */}
        <div className="text-center space-y-2.5">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-mono bg-white/[0.04] border border-white/[0.08] text-zinc-300">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            Инициализация сетевой фабрики
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
            Подключение сетевой инфраструктуры
          </h1>
          <p className="text-xs sm:text-sm text-zinc-400 max-w-xl mx-auto leading-relaxed">
            Холст создан и ожидает регистрации сетевых узлов. Выберите способ подключения к оборудованию стенда:
          </p>
        </div>

        {/* 3 Matte Connection Pathways */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Pathway 1: Live SSH Probe */}
          <div
            onClick={() => setAddModalOpen(true)}
            className="group relative p-6 rounded-2xl border border-white/[0.08] hover:border-white/[0.2] bg-[#0c0e15] hover:bg-white/[0.02] transition-all cursor-pointer flex flex-col justify-between shadow-xl"
          >
            <div>
              <div className="w-12 h-12 rounded-xl bg-white/[0.05] border border-white/[0.1] text-zinc-200 flex items-center justify-center mb-4 group-hover:scale-105 transition-transform">
                <Plus className="w-6 h-6" />
              </div>
              <span className="text-[10px] font-mono uppercase tracking-wider text-emerald-400 font-medium px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20">
                Живой стенд (SSH)
              </span>
              <h3 className="text-base font-bold text-white group-hover:text-zinc-100 transition-colors mt-2">
                SSH Probe по портам
              </h3>
              <p className="text-xs text-zinc-400 mt-2 leading-relaxed">
                Прямое подключение к портам 2211, 2212, 2221, 2222 стенда. Scrapli автоматически определит Arista cEOS, Cisco IOS-XE, снимет реальный конфиг и нагрузку CPU.
              </p>
            </div>
            <div className="mt-6 pt-3 border-t border-white/[0.06] flex items-center justify-between text-xs text-emerald-400 font-medium">
              <span>Открыть мастер подключения</span>
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </div>
          </div>

          {/* Pathway 2: Containerlab YAML Import */}
          <div
            onClick={() => {
              if (onSyncInventory) onSyncInventory();
            }}
            className="group relative p-6 rounded-2xl border border-white/[0.08] hover:border-white/[0.2] bg-[#0c0e15] hover:bg-white/[0.02] transition-all cursor-pointer flex flex-col justify-between shadow-xl"
          >
            <div>
              <div className="w-12 h-12 rounded-xl bg-white/[0.05] border border-white/[0.1] text-zinc-200 flex items-center justify-center mb-4 group-hover:scale-105 transition-transform">
                <Layers className="w-6 h-6" />
              </div>
              <span className="text-[10px] font-mono uppercase tracking-wider text-cyan-400 font-medium px-2 py-0.5 rounded bg-cyan-500/10 border border-cyan-500/20">
                Правки Тимофея
              </span>
              <h3 className="text-base font-bold text-white group-hover:text-zinc-100 transition-colors mt-2">
                Импорт fabric.clab.yaml
              </h3>
              <p className="text-xs text-zinc-400 mt-2 leading-relaxed">
                Синхронизация схемы Containerlab: Arista cEOS Spine-1/2 и Cisco IOS-XE Leaf-1/2 с закрытыми портами telnet и сложными паролями.
              </p>
            </div>
            <div className="mt-6 pt-3 border-t border-white/[0.06] flex items-center justify-between text-xs text-cyan-400 font-medium">
              <span>Синхронизировать стенд</span>
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </div>
          </div>

          {/* Pathway 3: GitOps Intent SoT */}
          <div
            onClick={() => {
              if (onSyncInventory) onSyncInventory();
            }}
            className="group relative p-6 rounded-2xl border border-white/[0.08] hover:border-white/[0.2] bg-[#0c0e15] hover:bg-white/[0.02] transition-all cursor-pointer flex flex-col justify-between shadow-xl"
          >
            <div>
              <div className="w-12 h-12 rounded-xl bg-white/[0.05] border border-white/[0.1] text-zinc-200 flex items-center justify-center mb-4 group-hover:scale-105 transition-transform">
                <Server className="w-6 h-6" />
              </div>
              <span className="text-[10px] font-mono uppercase tracking-wider text-amber-400 font-medium px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/20">
                GitOps SoT
              </span>
              <h3 className="text-base font-bold text-white group-hover:text-zinc-100 transition-colors mt-2">
                Загрузить intent/devices
              </h3>
              <p className="text-xs text-zinc-400 mt-2 leading-relaxed">
                Декларативное развертывание топологии из структурированных YAML файлов Git с валидацией IPAM /31 и BGP ASN по RFC 7938.
              </p>
            </div>
            <div className="mt-6 pt-3 border-t border-white/[0.06] flex items-center justify-between text-xs text-amber-400 font-medium">
              <span>Применить эталон</span>
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </div>
          </div>
        </div>

        {/* Presentation Slide link */}
        <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.06] flex items-center justify-between text-xs text-zinc-400">
          <div className="flex items-center gap-2.5">
            <Presentation className="w-4 h-4 text-zinc-300" />
            <span>Презентация и сценарий выступления перед жюри КРОК / МТУСИ</span>
          </div>
          <button
            onClick={() => onOpenTab('slides')}
            className="text-zinc-200 hover:text-white font-medium flex items-center gap-1 cursor-pointer"
          >
            <span>Слайды проекта</span>
            <ArrowRight className="w-3.5 h-3.5" />
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
    <div className="space-y-3 max-w-[1920px] mx-auto select-none">
      {/* 1. Health KPI Strip — scannable in < 0.5s */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
        <button
          onClick={() => onOpenTab('devices')}
          className="text-left rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3.5 py-2.5 hover:border-cyan-500/30 transition-colors cursor-pointer flex items-center justify-between"
        >
          <div>
            <div className="text-[11px] text-zinc-400 font-medium flex items-center gap-1.5">
              <Server className="w-3.5 h-3.5 text-zinc-500" />
              <span>{t.cardDevices}</span>
            </div>
            <div className="text-2xl font-semibold font-mono mt-0.5 text-[var(--text-primary)] tracking-tight">
              {devices.length}
            </div>
          </div>
          <div className="text-right">
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/[0.05] text-[var(--text-muted)]">
              {healthPercent}% {t.cardDevicesNormal}
            </span>
          </div>
        </button>

        <button
          onClick={() => onOpenTab('drift')}
          className="text-left rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3.5 py-2.5 hover:border-emerald-500/30 transition-colors cursor-pointer flex items-center justify-between"
        >
          <div>
            <div className="text-[11px] text-zinc-400 font-medium flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <span>{t.cardInSync}</span>
            </div>
            <div className="text-2xl font-semibold font-mono mt-0.5 text-emerald-400 tracking-tight">
              {inSyncCount}
            </div>
          </div>
          <ShieldCheck className="w-5 h-5 text-emerald-500/40" />
        </button>

        <button
          onClick={() => onOpenTab('drift')}
          className={`text-left rounded-lg border px-3.5 py-2.5 transition-colors cursor-pointer flex items-center justify-between ${
            driftCount > 0
              ? 'border-amber-500/30 bg-amber-500/[0.03] hover:border-amber-500/50'
              : 'border-[var(--border-subtle)] bg-[var(--bg-card)] hover:border-amber-500/30'
          }`}
        >
          <div>
            <div className="text-[11px] text-zinc-400 font-medium flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${driftCount > 0 ? 'bg-amber-400 animate-pulse' : 'bg-zinc-500'}`} />
              <span>{t.cardDrift}</span>
            </div>
            <div className={`text-2xl font-semibold font-mono mt-0.5 tracking-tight ${driftCount > 0 ? 'text-amber-400' : 'text-zinc-400'}`}>
              {driftCount}
            </div>
          </div>
          <AlertTriangle className={`w-5 h-5 ${driftCount > 0 ? 'text-amber-400/60' : 'text-zinc-600'}`} />
        </button>

        <button
          onClick={() => onOpenTab('devices')}
          className={`text-left rounded-lg border px-3.5 py-2.5 transition-colors cursor-pointer flex items-center justify-between ${
            unreachableCount > 0
              ? 'border-rose-500/30 bg-rose-500/[0.03] hover:border-rose-500/50'
              : 'border-[var(--border-subtle)] bg-[var(--bg-card)] hover:border-rose-500/30'
          }`}
        >
          <div>
            <div className="text-[11px] text-zinc-400 font-medium flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${unreachableCount > 0 ? 'bg-rose-400' : 'bg-zinc-500'}`} />
              <span>{t.cardUnreachable}</span>
            </div>
            <div className={`text-2xl font-semibold font-mono mt-0.5 tracking-tight ${unreachableCount > 0 ? 'text-rose-400' : 'text-zinc-400'}`}>
              {unreachableCount}
            </div>
          </div>
          <AlertTriangle className={`w-5 h-5 ${unreachableCount > 0 ? 'text-rose-400/60' : 'text-zinc-600'}`} />
        </button>

        <button
          onClick={() => onOpenTab('diff')}
          className={`col-span-2 sm:col-span-1 lg:col-span-1 text-left rounded-lg border px-3.5 py-2.5 transition-colors cursor-pointer flex items-center justify-between ${
            aiAnomalies.length > 0
              ? 'border-rose-500/40 bg-rose-500/[0.06] hover:border-rose-500/70 shadow-[0_0_15px_rgba(244,63,94,0.15)] animate-pulse'
              : 'border-cyan-500/20 bg-cyan-500/[0.02] hover:border-cyan-500/40'
          }`}
          title="Защитный барьер телеметрии TimesFM 3.0"
        >
          <div>
            <div className="text-[11px] text-zinc-400 font-medium flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${aiAnomalies.length > 0 ? 'bg-rose-500 animate-ping' : 'bg-cyan-400'}`} />
              <span>{t.cardAiGuard}</span>
            </div>
            <div className={`text-2xl font-semibold font-mono mt-0.5 tracking-tight ${aiAnomalies.length > 0 ? 'text-rose-400' : 'text-cyan-400'}`}>
              {aiAnomalies.length > 0 ? `${aiAnomalies.length} ${t.radarAnomCount}` : 'ACTIVE'}
            </div>
          </div>
          <div className="text-right">
            <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${aiAnomalies.length > 0 ? 'bg-rose-500/20 text-rose-300' : 'bg-cyan-500/10 text-cyan-300'}`}>
              {aiAnomalies.length > 0 ? 'Rollback' : 'Shield OK'}
            </span>
          </div>
        </button>
      </div>


      {/* 2. Device Fleet & Live Load Matrix (Device Grid with real load sparklines) */}
      <BentoCard
        title={locale === 'en' ? 'Fabric Devices & Operational Load' : 'Сетевые узлы фабрики и операционная нагрузка'}
        icon={<Server className="w-3.5 h-3.5 text-zinc-400" />}
        indicator="bg-emerald-400"
        right={
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] text-zinc-400">{devices.length} {locale === 'en' ? 'nodes' : 'узлов'}</span>
            <button
              onClick={() => onOpenTab('devices')}
              className="text-zinc-400 hover:text-white flex items-center gap-1 cursor-pointer transition-colors text-xs"
            >
              <span>{t.allDevices}</span>
              <ExternalLink className="w-3 h-3" />
            </button>
          </div>
        }
      >
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {devices.map((device) => {
            const currentLoad = device.sparkline && device.sparkline.length > 0
              ? device.sparkline[device.sparkline.length - 1]
              : 0;
            const isHigh = currentLoad > 80;
            const isMedium = currentLoad > 50;

            return (
              <div
                key={device.id}
                onClick={() => setDrawerDeviceId(device.id)}
                className="group relative rounded-xl border border-white/[0.08] hover:border-white/[0.2] bg-[#090b10] hover:bg-white/[0.02] p-3 transition-all cursor-pointer flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between gap-1.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${
                          device.status === 'IN_SYNC'
                            ? 'bg-emerald-400'
                            : device.status === 'DRIFT_DETECTED'
                            ? 'bg-amber-400'
                            : 'bg-rose-400'
                        }`}
                      />
                      <span className="font-bold text-xs text-white truncate tracking-tight group-hover:text-cyan-200 transition-colors">
                        {device.hostname}
                      </span>
                    </div>
                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-white/[0.05] text-zinc-300 border border-white/[0.05] uppercase shrink-0">
                      {device.platform.replace('_', '-')}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-[11px] font-mono text-zinc-400 mt-1">
                    <span>{device.management_ip}:{device.management_port}</span>
                    <span className="uppercase text-[10px] px-1 rounded bg-white/[0.03] text-zinc-400">
                      {device.role}
                    </span>
                  </div>
                </div>

                <div className="mt-3 pt-2 border-t border-white/[0.06]">
                  <div className="flex items-center justify-between text-[10px] font-mono mb-1.5">
                    <span className="text-zinc-400">Нагрузка (CPU/Трафик):</span>
                    <span
                      className={`font-semibold ${
                        isHigh ? 'text-rose-400' : isMedium ? 'text-amber-400' : 'text-emerald-400'
                      }`}
                    >
                      {currentLoad}%
                    </span>
                  </div>

                  <div className="h-8 w-full flex items-end gap-0.5">
                    {(device.sparkline && device.sparkline.length > 0 ? device.sparkline : DEFAULT_DASHBOARD_SPARKLINE).map((val, idx) => (
                      <div
                        key={idx}
                        style={{ height: `${Math.max(12, val)}%` }}
                        className={`flex-1 rounded-xs transition-all ${
                          val > 80
                            ? 'bg-rose-500/70'
                            : val > 50
                            ? 'bg-amber-500/60'
                            : 'bg-emerald-500/50'
                        }`}
                        title={`Замер: ${val}%`}
                      />
                    ))}
                  </div>
                </div>

                <div className="mt-2.5 pt-2 border-t border-white/[0.04] flex items-center justify-between text-[11px] text-zinc-400">
                  <span className="text-[10px] font-mono text-zinc-500">
                    Статус: <strong className={device.oper_status === 'UP' ? 'text-emerald-400' : 'text-amber-400'}>{device.oper_status || 'UP'}</strong>
                  </span>
                  <span className="text-[10px] font-mono text-cyan-400 group-hover:underline flex items-center gap-0.5">
                    Инспектор →
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </BentoCard>

      {/* 3. Bento Grid Central Arena (strictly fits 1080p display) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-3">
        {/* Left Column (7 cols on XL): CLOS Fabric Topology & Platform distribution */}
        <div className="xl:col-span-7 space-y-3">
          <BentoCard
            title={t.topologyTitle}
            indicator="bg-cyan-400"
            right={
              <button
                onClick={() => onOpenTab('devices')}
                className="text-zinc-400 hover:text-white flex items-center gap-1 cursor-pointer transition-colors"
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
            <BentoCard title={t.platformsTitle} icon={<Cpu className="w-3.5 h-3.5 text-zinc-400" />} indicator="bg-zinc-400">
              <div className="space-y-1.5">
                {platformsCount.map(([p, count]) => (
                  <div key={p} className="flex items-center justify-between text-[11px]">
                    <span className="text-zinc-300 truncate">{PLATFORM_NAMES[p] ?? p}</span>
                    <span className="font-mono text-zinc-400 bg-white/[0.04] px-1.5 py-0.5 rounded border border-white/[0.04]">
                      {count}
                    </span>
                  </div>
                ))}
              </div>
            </BentoCard>

            <BentoCard title={t.rolesTitle} icon={<Layers className="w-3.5 h-3.5 text-zinc-400" />} indicator="bg-zinc-400">
              <div className="space-y-1.5">
                {rolesCount.map(([r, count]) => (
                  <div key={r} className="flex items-center justify-between text-[11px]">
                    <span className="text-zinc-300 truncate">{ROLE_NAMES[r] ?? r}</span>
                    <span className="font-mono text-zinc-400 bg-white/[0.04] px-1.5 py-0.5 rounded border border-white/[0.04]">
                      {count}
                    </span>
                  </div>
                ))}
              </div>
            </BentoCard>
          </div>
        </div>

        {/* Right Column (5 cols on XL): TimesFM 6h Risk Radar & Recent Jobs */}
        <div className="xl:col-span-5 space-y-3">
          {/* TimesFM Risk Radar with 1-Click Action Buttons */}
          <BentoCard
            title={t.riskRadarTitle}
            indicator={alerts.length > 0 ? 'bg-amber-400' : 'bg-emerald-400'}
            right={
              <span className="font-mono text-[10px] text-zinc-400">
                {alerts.length > 0 ? `${alerts.length} ${t.radarAnomCount}` : (locale === 'en' ? '0 risks' : '0 рисков')}
              </span>
            }
          >
            <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
              {alerts.map((a) => (
                <div
                  key={`${a.device_id}-${a.metric}`}
                  className="rounded-lg border border-amber-500/20 bg-amber-500/[0.04] p-2.5 flex flex-col gap-2 hover:border-amber-500/40 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                      <div className="min-w-0">
                        <div className="font-semibold text-white text-xs truncate">
                          {a.hostname}
                        </div>
                        <div className="text-[11px] text-zinc-400 truncate">
                          {a.label}
                        </div>
                      </div>
                    </div>
                    <span className="font-mono text-[11px] text-amber-300 bg-amber-500/15 px-2 py-0.5 rounded border border-amber-500/25 shrink-0">
                      &gt;{a.threshold}% через ~{a.breach_in_minutes}м
                    </span>
                  </div>

                  {/* 1-Click Action Ergonomics (Fitts's Law) */}
                  <div className="flex items-center justify-end gap-1.5 pt-1.5 border-t border-white/[0.06]">
                    <button
                      onClick={() => onOpenDevice(a.device_id)}
                      className="px-2 py-1 rounded bg-white/[0.05] hover:bg-white/[0.1] text-zinc-200 hover:text-white text-[11px] font-mono flex items-center gap-1 transition-colors cursor-pointer"
                      title="Открыть карточку устройства и прогноз"
                    >
                      <ExternalLink className="w-3 h-3 text-cyan-400" />
                      <span>{t.openBtn}</span>
                    </button>

                    <button
                      onClick={() => {
                        if (onOpenDiff) onOpenDiff();
                        else onOpenTab('diff');
                      }}
                      className="px-2 py-1 rounded bg-white/[0.05] hover:bg-white/[0.1] text-zinc-200 hover:text-white text-[11px] font-mono flex items-center gap-1 transition-colors cursor-pointer"
                      title="Сверить конфигурации в DiffViewer"
                    >
                      <GitCompare className="w-3 h-3 text-amber-400" />
                      <span>{t.diffBtn}</span>
                    </button>

                    <button
                      onClick={(e) => handleAlertDryRun(a.device_id, e)}
                      disabled={dryRunRunning === a.device_id}
                      className="px-2 py-1 rounded bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 hover:text-emerald-200 text-[11px] font-mono flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-50"
                      title="Запустить предиктивный Dry-run"
                    >
                      <Play className="w-3 h-3 text-emerald-400" />
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
                <div className="py-6 text-center text-xs text-zinc-400 flex flex-col items-center justify-center gap-1.5">
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                  <span className="text-zinc-300 font-medium">
                    {locale === 'en' ? 'Normal state' : 'Штатный режим'}
                  </span>
                  <span className="text-zinc-500 text-[11px]">
                    {locale === 'en' ? 'No metric threshold breaches forecasted within 6h' : 'Пробоев порогов в ближайшие 6 часов не прогнозируется'}
                  </span>
                </div>
              )}
            </div>
          </BentoCard>

          {/* Recent Automation Jobs */}
          <BentoCard
            title={t.automationJobsTitle}
            icon={<Clock className="w-3.5 h-3.5 text-zinc-400" />}
            indicator="bg-zinc-400"
            right={
              <button
                onClick={() => onOpenTab('jobs')}
                className="text-zinc-400 hover:text-white flex items-center gap-1 cursor-pointer transition-colors"
              >
                <span>{t.auditLogBtn}</span>
                <ExternalLink className="w-3 h-3" />
              </button>
            }
          >
            <div className="space-y-1.5">
              {jobs.slice(0, 5).map((j) => {
                const s = JOB_COLOR[j.status] ?? JOB_COLOR.PENDING;
                return (
                  <div
                    key={j.id}
                    onClick={() => {
                      if (onOpenDiff) onOpenDiff(j.id);
                      else onOpenTab('jobs');
                    }}
                    className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-white/[0.04] transition-colors cursor-pointer border border-transparent hover:border-white/[0.06] text-xs"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono text-zinc-200 truncate">{j.type}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-zinc-500 text-[11px] font-mono">
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
                <div className="py-4 text-center text-xs text-zinc-500">{t.noRunsYet}</div>
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
