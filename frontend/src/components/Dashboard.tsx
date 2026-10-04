import React, { useEffect, useState } from 'react';
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
import { TopologyMap } from './TopologyMap';
import { PLATFORM_NAMES, ROLE_NAMES } from './ui';
import { AddDeviceModal } from './AddDeviceModal';

interface DashboardProps {
  devices: Device[];
  jobs: JobSummary[];
  userRole?: UserRole;
  onOpenTab: (tab: string) => void;
  onOpenDevice: (id: number) => void;
  onRunDryRun?: (deviceIds: number[]) => void;
  onOpenDiff?: (jobId?: string) => void;
  onSyncInventory?: () => void;
}


const BentoCard: React.FC<{
  title: string;
  icon?: React.ReactNode;
  indicator?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}> = ({ title, icon, indicator = 'bg-zinc-500', right, children, className = '' }) => (
  <section className={`rounded-lg border border-white/[0.08] bg-[#0c0e14] overflow-hidden flex flex-col ${className}`}>
    <div className="bg-[#10131b]/90 border-b border-white/[0.06] px-3 py-2 text-xs font-medium text-zinc-200 flex items-center justify-between shrink-0">
      <div className="flex items-center gap-2">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${indicator}`} />
        {icon}
        <span className="tracking-tight text-white font-medium">{title}</span>
      </div>
      {right && <div className="text-zinc-400 text-xs">{right}</div>}
    </div>
    <div className="p-3 flex-1 min-h-0 overflow-hidden">{children}</div>
  </section>
);

const JOB_COLOR: Record<string, { text: string; bg: string; border: string }> = {
  SUCCESS: { text: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
  FAILED: { text: 'text-rose-400', bg: 'bg-rose-500/10', border: 'border-rose-500/20' },
  RUNNING: { text: 'text-cyan-400 animate-pulse', bg: 'bg-cyan-500/10', border: 'border-cyan-500/20' },
  PENDING: { text: 'text-zinc-400', bg: 'bg-white/[0.04]', border: 'border-white/[0.08]' },
};

export const Dashboard: React.FC<DashboardProps> = ({
  devices,
  jobs,
  userRole,
  onOpenTab,
  onOpenDevice,
  onRunDryRun,
  onOpenDiff,
  onSyncInventory,
}) => {
  const [alerts, setAlerts] = useState<ForecastAlert[]>([]);
  const [aiGuardList, setAiGuardList] = useState<AiGuardResponse[]>([]);
  const [dryRunRunning, setDryRunRunning] = useState<number | null>(null);
  const [dryRunSuccess, setDryRunSuccess] = useState<number | null>(null);
  const [addModalOpen, setAddModalOpen] = useState(false);

  useEffect(() => {
    if (devices.length > 0) {
      api.getForecastAlerts().then(setAlerts).catch(() => setAlerts([]));
      api.getAiGuardOverview().then(setAiGuardList).catch(() => setAiGuardList([]));
    }
  }, [devices.length]);

  // If there are no devices in the system, show the Onboarding & First Structure prompt!
  if (devices.length === 0) {
    return (
      <div className="max-w-4xl mx-auto py-8 sm:py-14 space-y-8 animate-fade-in select-none">
        {/* Onboarding Stepper Header */}
        <div className="text-center space-y-3">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-mono bg-cyan-500/10 border border-cyan-500/25 text-cyan-300">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
            Инициализация сетевой фабрики
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
            Шаг 2 из 2: Добавление первой сетевой структуры
          </h1>
          <p className="text-xs sm:text-sm text-zinc-400 max-w-xl mx-auto leading-relaxed">
            Вы вошли в систему. В инвентаре пока нет активных узлов. Выберите способ создания структуры для запуска мониторинга и телеметрии:
          </p>
        </div>

        {/* Primary Action Card: Manual / SSH Probe Onboarding */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div
            onClick={() => setAddModalOpen(true)}
            className="md:col-span-2 group relative p-6 sm:p-8 rounded-2xl border border-white/[0.1] hover:border-cyan-500/50 bg-[#0c0e14] hover:bg-cyan-500/[0.02] transition-all cursor-pointer flex flex-col justify-between shadow-2xl shadow-cyan-950/20"
          >
            <div>
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-indigo-500/20 border border-cyan-500/30 text-cyan-400 flex items-center justify-center mb-5 group-hover:scale-105 transition-transform">
                <Plus className="w-7 h-7" />
              </div>
              <span className="text-[11px] font-mono uppercase tracking-wider text-cyan-400 font-semibold px-2 py-0.5 rounded bg-cyan-500/10 border border-cyan-500/20">
                Первичное подключение
              </span>
              <h3 className="text-xl font-bold text-white group-hover:text-cyan-200 transition-colors mt-2">
                Добавить сервер или сетевой коммутатор
              </h3>
              <p className="text-xs sm:text-sm text-zinc-400 mt-2 leading-relaxed">
                Система начинает работу с чистого листа. Укажите IP-адрес, SSH-порт и реквизиты доступа вашего оборудования. Мастер SSH Probe автоматически определит платформу (Cisco, Arista, Huawei, Linux), вычислительные ресурсы (vCPU, RAM, NVMe) и сетевые интерфейсы.
              </p>
              <div className="mt-5 flex flex-wrap gap-2 text-xs font-mono text-zinc-300">
                <span className="px-2.5 py-1 rounded-md bg-white/[0.04] border border-white/[0.06]">Linux Compute</span>
                <span className="px-2.5 py-1 rounded-md bg-white/[0.04] border border-white/[0.06]">Cisco 8000V / IOS-XE</span>
                <span className="px-2.5 py-1 rounded-md bg-white/[0.04] border border-white/[0.06]">Arista cEOS</span>
                <span className="px-2.5 py-1 rounded-md bg-white/[0.04] border border-white/[0.06]">Huawei VRP</span>
              </div>
            </div>
            <div className="mt-8 pt-4 border-t border-white/[0.06] flex items-center justify-between text-xs text-cyan-400 font-semibold">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
                Открыть мастер подключения (SSH Probe)
              </span>
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </div>
          </div>

          {/* Side Info Card: Progressive Disclosure & Safe-First */}
          <div className="space-y-4">
            <div className="p-5 rounded-2xl border border-white/[0.08] bg-[#0c0e14] space-y-3">
              <div className="flex items-center gap-2 text-zinc-300 text-xs font-semibold">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>Принцип Safe-First</span>
              </div>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Каждое новое устройство регистрируется в режиме <strong>MONITORING_ONLY</strong>. Мутации конфигураций исключены до тех пор, пока администратор явно не переведет узел в управление.
              </p>
            </div>

            <div className="p-5 rounded-2xl border border-white/[0.08] bg-[#0c0e14] space-y-3">
              <div className="flex items-center gap-2 text-zinc-300 text-xs font-semibold">
                <Presentation className="w-4 h-4 text-indigo-400" />
                <span>Архитектура фабрики</span>
              </div>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Интерактивный разбор топологий Clos, валидация инвариантов SMT/Z3 и транзакционные откаты <code>commit confirmed</code>.
              </p>
              <button
                onClick={() => onOpenTab('slides')}
                className="text-xs text-indigo-400 hover:text-indigo-300 font-semibold flex items-center gap-1 cursor-pointer pt-1"
              >
                <span>Смотреть слайды</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Presentation Slide shortcut */}
        <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.06] flex items-center justify-between text-xs text-zinc-400">
          <div className="flex items-center gap-2.5">
            <Presentation className="w-4 h-4 text-cyan-400" />
            <span>Хотите сначала ознакомиться с архитектурой и графом инвариантов?</span>
          </div>
          <button
            onClick={() => onOpenTab('slides')}
            className="text-cyan-400 hover:text-cyan-300 font-medium flex items-center gap-1 cursor-pointer"
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

  const aiAnomalies = aiGuardList.filter((g) => !g.healthy);

  const by = (s: string) => devices.filter((d) => d.status === s).length;
  const inSyncCount = by('IN_SYNC');
  const driftCount = by('DRIFT_DETECTED');
  const unreachableCount = by('UNREACHABLE');
  const healthPercent = devices.length > 0 ? Math.round((inSyncCount / devices.length) * 100) : 100;

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

  const platformsCount = Object.entries(
    devices.reduce<Record<string, number>>((acc, d) => {
      acc[d.platform] = (acc[d.platform] ?? 0) + 1;
      return acc;
    }, {})
  );

  const rolesCount = Object.entries(
    devices.reduce<Record<string, number>>((acc, d) => {
      acc[d.role] = (acc[d.role] ?? 0) + 1;
      return acc;
    }, {})
  );

  return (
    <div className="space-y-3 max-w-[1920px] mx-auto select-none">
      {/* 1. Health KPI Strip — scannable in < 0.5s */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2.5">
        <button
          onClick={() => onOpenTab('devices')}
          className="text-left rounded-lg border border-white/[0.08] bg-[#0c0e14] px-3.5 py-2.5 hover:border-white/[0.18] transition-colors cursor-pointer flex items-center justify-between"
        >
          <div>
            <div className="text-[11px] text-zinc-400 font-medium flex items-center gap-1.5">
              <Server className="w-3.5 h-3.5 text-zinc-500" />
              <span>Оборудование</span>
            </div>
            <div className="text-2xl font-semibold font-mono mt-0.5 text-white tracking-tight">
              {devices.length}
            </div>
          </div>
          <div className="text-right">
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/[0.05] text-zinc-400">
              {healthPercent}% норма
            </span>
          </div>
        </button>

        <button
          onClick={() => onOpenTab('drift')}
          className="text-left rounded-lg border border-white/[0.08] bg-[#0c0e14] px-3.5 py-2.5 hover:border-white/[0.18] transition-colors cursor-pointer flex items-center justify-between"
        >
          <div>
            <div className="text-[11px] text-zinc-400 font-medium flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <span>В синхроне (SoT)</span>
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
              : 'border-white/[0.08] bg-[#0c0e14] hover:border-white/[0.18]'
          }`}
        >
          <div>
            <div className="text-[11px] text-zinc-400 font-medium flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${driftCount > 0 ? 'bg-amber-400 animate-pulse' : 'bg-zinc-500'}`} />
              <span>Дрейф конфигураций</span>
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
              : 'border-white/[0.08] bg-[#0c0e14] hover:border-white/[0.18]'
          }`}
        >
          <div>
            <div className="text-[11px] text-zinc-400 font-medium flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${unreachableCount > 0 ? 'bg-rose-400' : 'bg-zinc-500'}`} />
              <span>Недоступные узлы</span>
            </div>
            <div className={`text-2xl font-semibold font-mono mt-0.5 tracking-tight ${unreachableCount > 0 ? 'text-rose-400' : 'text-zinc-400'}`}>
              {unreachableCount}
            </div>
          </div>
          <AlertTriangle className={`w-5 h-5 ${unreachableCount > 0 ? 'text-rose-400/60' : 'text-zinc-600'}`} />
        </button>

        <button
          onClick={() => onOpenTab('chaos')}
          className={`text-left rounded-lg border px-3.5 py-2.5 transition-colors cursor-pointer flex items-center justify-between ${
            aiAnomalies.length > 0
              ? 'border-rose-500/40 bg-rose-500/[0.06] hover:border-rose-500/70 shadow-[0_0_15px_rgba(244,63,94,0.15)] animate-pulse'
              : 'border-cyan-500/20 bg-cyan-500/[0.02] hover:border-cyan-500/40'
          }`}
          title="Защитный барьер телеметрии TimesFM 3.0"
        >
          <div>
            <div className="text-[11px] text-zinc-400 font-medium flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${aiAnomalies.length > 0 ? 'bg-rose-500 animate-ping' : 'bg-cyan-400'}`} />
              <span>TimesFM 3.0 Guard</span>
            </div>
            <div className={`text-2xl font-semibold font-mono mt-0.5 tracking-tight ${aiAnomalies.length > 0 ? 'text-rose-400' : 'text-cyan-400'}`}>
              {aiAnomalies.length > 0 ? `${aiAnomalies.length} аномалий` : 'ACTIVE'}
            </div>
          </div>
          <div className="text-right">
            <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${aiAnomalies.length > 0 ? 'bg-rose-500/20 text-rose-300' : 'bg-cyan-500/10 text-cyan-300'}`}>
              {aiAnomalies.length > 0 ? 'Rollback' : 'Shield OK'}
            </span>
          </div>
        </button>
      </div>


      {/* 2. Bento Grid Central Arena (strictly fits 1080p display) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-3">
        {/* Left Column (7 cols on XL): CLOS Fabric Topology & Platform distribution */}
        <div className="xl:col-span-7 space-y-3">
          <BentoCard
            title="Топология CLOS фабрики"
            indicator="bg-cyan-400"
            right={
              <button
                onClick={() => onOpenTab('devices')}
                className="text-zinc-400 hover:text-white flex items-center gap-1 cursor-pointer transition-colors"
              >
                <span>Все устройства</span>
                <ExternalLink className="w-3 h-3" />
              </button>
            }
          >
            <TopologyMap
              devices={devices}
              alerts={alerts}
              onSelectDevice={onOpenDevice}
              onRunDryRun={onRunDryRun}
              onOpenDiff={() => (onOpenDiff ? onOpenDiff() : onOpenTab('diff'))}
            />
          </BentoCard>

          {/* Compact Platform & Role Inventory Strip */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <BentoCard title="Платформы оборудования" icon={<Cpu className="w-3.5 h-3.5 text-zinc-400" />} indicator="bg-zinc-400">
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

            <BentoCard title="Роли в фабрике" icon={<Layers className="w-3.5 h-3.5 text-zinc-400" />} indicator="bg-zinc-400">
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
            title="Предиктивный радар рисков (TimesFM, 6ч)"
            indicator={alerts.length > 0 ? 'bg-amber-400' : 'bg-emerald-400'}
            right={
              <span className="font-mono text-[10px] text-zinc-400">
                {alerts.length > 0 ? `${alerts.length} аномал.` : '0 рисков'}
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
                      <span>Открыть</span>
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
                      <span>Diff</span>
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
                          ? 'Запущен!'
                          : dryRunRunning === a.device_id
                          ? '...'
                          : 'Dry-run'}
                      </span>
                    </button>
                  </div>
                </div>
              ))}

              {alerts.length === 0 && (
                <div className="py-6 text-center text-xs text-zinc-400 flex flex-col items-center justify-center gap-1.5">
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                  <span className="text-zinc-300 font-medium">Штатный режим</span>
                  <span className="text-zinc-500 text-[11px]">
                    Пробоев порогов в ближайшие 6 часов не прогнозируется
                  </span>
                </div>
              )}
            </div>
          </BentoCard>

          {/* Recent Automation Jobs */}
          <BentoCard
            title="Задачи автоматизации"
            icon={<Clock className="w-3.5 h-3.5 text-zinc-400" />}
            indicator="bg-zinc-400"
            right={
              <button
                onClick={() => onOpenTab('jobs')}
                className="text-zinc-400 hover:text-white flex items-center gap-1 cursor-pointer transition-colors"
              >
                <span>Журнал</span>
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
                        {new Date(j.created_at).toLocaleTimeString('ru-RU', {
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
                <div className="py-4 text-center text-xs text-zinc-500">Запусков пока нет</div>
              )}
            </div>
          </BentoCard>
        </div>
      </div>
    </div>
  );
};
