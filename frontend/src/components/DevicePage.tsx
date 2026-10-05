import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Play,
  ShieldCheck,
  Sparkles,
  AlertTriangle,
  Cpu,
  HardDrive,
  Radio,
  RotateCcw,
  RefreshCw,
  AlertOctagon,
  Zap,
  CheckCircle2,
  Send,
  ShieldAlert,
  Sliders,
  ChevronRight,
  Trash2,
} from 'lucide-react';
import { api } from '../api';
import type { DeviceDetail, Forecast, UserRole, DeviceEmergencyAction } from '../api';
import type { Locale } from '../i18n';
import { ForecastChart } from './ForecastChart';
import {
  PLATFORM_NAMES,
  Panel,
  ROLE_NAMES,
  StatusBadge,
  OperStatusBadge,
  ManagementModeBadge,
} from './ui';

interface Props {
  deviceId: number;
  userRole?: UserRole;
  locale?: Locale;
  onBack: () => void;
  onRunDryRun: (ids: number[]) => void;
  onScanDrift: (ids?: number[]) => void;
  onAskCopilot: (question: string) => void;
  onDeleteDevice?: (id: number) => void;
}

const TABS = ['Обзор', 'Прогноз и What-If', 'SSH Терминал', 'AI Copilot'] as const;
type Tab = (typeof TABS)[number];

const METRICS = [
  { id: 'uplink_util_pct', label: 'Загрузка аплинка' },
  { id: 'cpu_pct', label: 'Загрузка CPU' },
];

const Th: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <th className="px-3 py-2 text-left text-[11px] uppercase tracking-wide font-medium text-zinc-500">
    {children}
  </th>
);

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex justify-between py-1.5 text-[13px] border-b border-white/[0.04] last:border-0">
    <span className="text-zinc-400">{label}</span>
    <span className="text-zinc-100 font-mono text-right">{children}</span>
  </div>
);

export const DevicePage: React.FC<Props> = ({
  deviceId,
  userRole = 'operator',
  locale = 'ru',
  onBack,
  onRunDryRun,
  onScanDrift,
  onAskCopilot,
  onDeleteDevice,
}) => {
  const [device, setDevice] = useState<DeviceDetail | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('Обзор');
  const [promoting, setPromoting] = useState(false);

  // Emergency Action State
  const [emergencyModal, setEmergencyModal] = useState<{
    open: boolean;
    action: DeviceEmergencyAction['action'] | null;
    title: string;
    description: string;
  }>({ open: false, action: null, title: '', description: '' });
  const [emergencyReason, setEmergencyReason] = useState('');
  const [emergencyExecuting, setEmergencyExecuting] = useState(false);
  const [emergencyResult, setEmergencyResult] = useState<{ status: string; message: string } | null>(null);

  // Forecast & What-If State
  const [forecastMetric, setForecastMetric] = useState(METRICS[0].id);
  const [forecastData, setForecastData] = useState<Forecast | null>(null);
  const [forecastError, setForecastError] = useState('');
  const [whatIfExtraLoad, setWhatIfExtraLoad] = useState<number>(0);

  // Terminal State
  const [terminalOutput, setTerminalOutput] = useState<Array<{ command: string; output: string; time: string }>>([
    {
      command: 'sys.connect',
      output: 'Connected to device console. Active session established.',
      time: '00:00:01',
    },
  ]);
  const [commandInput, setCommandInput] = useState('');

  // Device-scoped Copilot state
  const [copilotHistory, setCopilotHistory] = useState<Array<{ role: 'user' | 'assistant'; text: string }>>([]);
  const [copilotInput, setCopilotInput] = useState('');
  const [copilotLoading, setCopilotLoading] = useState(false);

  const fetchDevice = () => {
    api.getDevice(deviceId)
      .then((d) => setDevice(d))
      .catch((e) => setError(e.message));
  };

  useEffect(() => {
    setDevice(null);
    setError('');
    fetchDevice();
  }, [deviceId]);

  // Load forecast when tab is Forecast
  useEffect(() => {
    if (tab === 'Прогноз и What-If') {
      setForecastData(null);
      setForecastError('');
      api.getForecast(deviceId, forecastMetric)
        .then(setForecastData)
        .catch((e) => setForecastError(e.message));
    }
  }, [deviceId, forecastMetric, tab]);

  if (error) return <div className="text-rose-400 p-6">{error}</div>;
  if (!device) return <div className="text-zinc-500 p-6">Загрузка данных устройства…</div>;

  const isServer = device.platform === 'linux_server' || device.role === 'server';
  const isManaged = device.management_mode === 'MANAGED';
  const canAdmin = userRole === 'admin' || userRole === 'owner';

  // Parse hardware specs
  let specs: any = null;
  if (device.hardware_specs) {
    try {
      specs = JSON.parse(device.hardware_specs);
    } catch {
      // fallback
    }
  }

  const handlePromote = async () => {
    setPromoting(true);
    try {
      const updated = await api.promoteDevice(device.id);
      setDevice((prev) => (prev ? { ...prev, management_mode: updated.management_mode } : null));
    } catch (err: any) {
      alert(`Ошибка перевода в управление: ${err.message}`);
    } finally {
      setPromoting(false);
    }
  };

  const openEmergencyModal = (action: DeviceEmergencyAction['action'], title: string, description: string) => {
    setEmergencyReason('');
    setEmergencyResult(null);
    setEmergencyModal({ open: true, action, title, description });
  };

  const handleExecuteEmergencyAction = async () => {
    if (!emergencyModal.action) return;
    setEmergencyExecuting(true);
    try {
      const res = await api.deviceEmergencyAction(device.id, {
        action: emergencyModal.action,
        reason: emergencyReason.trim() || 'Экстренное ручное воздействие через карточку устройства',
      });
      setEmergencyResult(res);
      fetchDevice();
    } catch (err: any) {
      setEmergencyResult({ status: 'ERROR', message: err.message || 'Ошибка выполнения действия' });
    } finally {
      setEmergencyExecuting(false);
    }
  };

  // Run terminal command
  const handleRunCommand = (cmdToRun?: string) => {
    const cmd = (cmdToRun || commandInput).trim();
    if (!cmd) return;

    const time = new Date().toLocaleTimeString('ru-RU');

    // Safe mode protection check
    if (!isManaged && (cmd.startsWith('conf') || cmd.startsWith('system-view') || cmd.startsWith('rm') || cmd.startsWith('reboot'))) {
      setTerminalOutput((prev) => [
        ...prev,
        {
          command: cmd,
          output: `[SECURITY GUARD FAIL-CLOSED] Команда заблокирована: устройство находится в режиме MONITORING_ONLY. Для мутаций конфигурации переведите узел в MANAGED.`,
          time,
        },
      ]);
      setCommandInput('');
      return;
    }

    let fakeOutput = '';
    if (cmd === 'uptime') {
      fakeOutput = `12:45:10 up 48 days, 3:12, 1 user, load average: 0.18, 0.24, 0.20`;
    } else if (cmd === 'free -m' || cmd === 'free -h') {
      fakeOutput = `               total        used        free      shared  buff/cache   available\nMem:            3912        1124        1820          45         968        2510\nSwap:           2048           0        2048`;
    } else if (cmd.includes('ip a') || cmd.includes('ifconfig')) {
      fakeOutput = `1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN\n    inet 127.0.0.1/8 scope host lo\n2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc fq_codel state UP\n    inet ${device.management_ip}/24 brd 10.0.0.255 scope global eth0`;
    } else if (cmd.includes('show ip bgp') || cmd.includes('bgp summary')) {
      fakeOutput = `BGP router identifier ${device.intent?.bgp?.router_id || '10.0.0.1'}, local AS number ${device.intent?.bgp?.asn || 65001}\nBGP table version is 4, main routing table version 4\nNeighbor        V    AS MsgRcvd MsgSent   TblVer  InQ OutQ Up/Down  State/PfxRcd\n10.0.0.2        4 65002    1452    1450        4    0    0 02:40:15        2\n10.0.0.3        4 65003    1449    1448        4    0    0 02:40:12        2`;
    } else if (cmd.includes('show version') || cmd.includes('uname -a')) {
      fakeOutput = isServer
        ? `Linux ${device.hostname} 6.8.0-40-generic #40-Ubuntu SMP PREEMPT_DYNAMIC x86_64 GNU/Linux`
        : `${device.platform.toUpperCase()} Software, Version 17.06.01, RELEASE SOFTWARE (fc1)`;
    } else if (cmd === 'clear') {
      setTerminalOutput([]);
      setCommandInput('');
      return;
    } else {
      fakeOutput = `Command '${cmd}' dispatched to ${device.hostname}. Return code: 0 [OK].`;
    }

    setTerminalOutput((prev) => [...prev, { command: cmd, output: fakeOutput, time }]);
    setCommandInput('');
  };

  // Handle Copilot question inside tab
  const handleAskCopilot = async (text: string) => {
    if (!text.trim()) return;
    const userMsg = text.trim();
    setCopilotHistory((prev) => [...prev, { role: 'user', text: userMsg }]);
    setCopilotInput('');
    setCopilotLoading(true);

    try {
      const prompt = `Контекст устройства: ${device.hostname} (${device.platform}, ${device.role}, IP: ${device.management_ip}, режим: ${device.management_mode}). Запрос: ${userMsg}`;
      const reply = await api.askCopilot(prompt);
      setCopilotHistory((prev) => [...prev, { role: 'assistant', text: reply.answer }]);
    } catch (err: any) {
      setCopilotHistory((prev) => [
        ...prev,
        { role: 'assistant', text: `Ошибка получения ответа: ${err.message}` },
      ]);
    } finally {
      setCopilotLoading(false);
    }
  };

  const btn =
    'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors';

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Top Breadcrumb & Action Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="flex items-center gap-1 text-xs text-zinc-400 hover:text-white px-2 py-1 rounded-md hover:bg-white/[0.05] transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Инвентарь</span>
          </button>
          <div className="h-4 w-px bg-white/[0.1]" />
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-bold text-white tracking-tight font-mono">{device.hostname}</h1>
            <StatusBadge status={device.status} />
            <OperStatusBadge status={device.oper_status ?? 'UP'} />
            <ManagementModeBadge mode={device.management_mode} />
          </div>
        </div>

        <div className="flex items-center gap-2">
          {device.management_mode === 'MONITORING_ONLY' && canAdmin && (
            <button
              onClick={handlePromote}
              disabled={promoting}
              className={`${btn} bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 hover:bg-cyan-500/30`}
              title="Перевести устройство в управляемый режим для возможности деплоя"
            >
              <Zap className="w-3.5 h-3.5" />
              <span>{promoting ? 'Активация…' : 'В управление (Promote)'}</span>
            </button>
          )}

          <button
            onClick={() => onRunDryRun([device.id])}
            className={`${btn} bg-cyan-500 text-zinc-950 hover:bg-cyan-400 font-semibold shadow-sm`}
          >
            <Play className="w-3.5 h-3.5 fill-current" /> Dry-run
          </button>

          <button
            onClick={() => onScanDrift([device.id])}
            className={`${btn} border border-white/[0.1] text-zinc-200 hover:bg-white/[0.05]`}
          >
            <ShieldCheck className="w-3.5 h-3.5" /> Скан дрейфа
          </button>

          <button
            onClick={() => {
              setTab('AI Copilot');
              const q = `Оцени надежность и состояние узла ${device.hostname}`;
              handleAskCopilot(q);
              if (onAskCopilot) onAskCopilot(q);
            }}
            className={`${btn} border border-indigo-400/40 text-indigo-300 hover:bg-indigo-500/10`}
          >
            <Sparkles className="w-3.5 h-3.5" /> Спросить Copilot
          </button>

          {canAdmin && (
            <button
              onClick={async () => {
                const confirmMsg =
                  locale === 'en'
                    ? `Are you sure you want to delete ${device.hostname}?`
                    : `Вы действительно хотите удалить устройство ${device.hostname}?`;
                if (window.confirm(confirmMsg)) {
                  try {
                    if (onDeleteDevice) {
                      await onDeleteDevice(device.id);
                    } else {
                      await api.deleteDevice(device.id);
                      onBack();
                    }
                  } catch (err: any) {
                    alert(`Ошибка удаления: ${err.message}`);
                  }
                }
              }}
              className={`${btn} bg-rose-500/10 hover:bg-rose-500/25 border border-rose-500/30 text-rose-400 hover:text-rose-300 font-semibold shadow-sm`}
              title={locale === 'en' ? 'Delete device' : 'Удалить устройство'}
            >
              <Trash2 className="w-3.5 h-3.5 text-rose-400" />
              <span>{locale === 'en' ? 'Delete' : 'Удалить'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-white/[0.08]">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-xs font-medium border-b-2 -mb-px cursor-pointer transition-colors ${
              tab === t
                ? 'border-cyan-400 text-white bg-white/[0.02]'
                : 'border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.01]'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* TAB 1: ОБЗОР (Specs, Interfaces, Intent & Embedded Emergency Actions) */}
      {tab === 'Обзор' && (
        <div className="space-y-6">
          {/* Safe Mode Alert Banner if MONITORING_ONLY */}
          {device.management_mode === 'MONITORING_ONLY' && (
            <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/25 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <ShieldAlert className="w-5 h-5 text-amber-400 shrink-0" />
                <div>
                  <div className="text-xs font-semibold text-amber-200">
                    Режим пассивного аудита: MONITORING_ONLY (Safe-First)
                  </div>
                  <div className="text-[11px] text-zinc-400 mt-0.5">
                    Узел доступен для сбора телеметрии и проверки дрейфа. Мутации конфигурации и деплои заблокированы.
                  </div>
                </div>
              </div>
              {canAdmin && (
                <button
                  onClick={handlePromote}
                  disabled={promoting}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-zinc-950 transition-colors cursor-pointer shrink-0"
                >
                  {promoting ? 'Активация…' : 'Подключить прямое управление (Promote)'}
                </button>
              )}
            </div>
          )}

          {/* Specs Bento Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-4 rounded-xl bg-[#0c0e14] border border-white/[0.08]">
              <div className="flex items-center gap-1.5 text-zinc-400 text-xs mb-1">
                <Cpu className="w-3.5 h-3.5 text-cyan-400" />
                <span>Вычислительные ядра</span>
              </div>
              <div className="text-lg font-bold text-white font-mono">
                {specs?.cpu_cores ? `${specs.cpu_cores} vCPU` : '—'}
              </div>
              <div className="text-[11px] text-zinc-500 mt-0.5">
                {specs?.os_version || (locale === 'en' ? 'No telemetry yet' : 'Телеметрия не получена')}
              </div>
            </div>

            <div className="p-4 rounded-xl bg-[#0c0e14] border border-white/[0.08]">
              <div className="flex items-center gap-1.5 text-zinc-400 text-xs mb-1">
                <HardDrive className="w-3.5 h-3.5 text-indigo-400" />
                <span>Оперативная память</span>
              </div>
              <div className="text-lg font-bold text-white font-mono">
                {specs?.ram_gb ? `${specs.ram_gb} GB RAM` : '—'}
              </div>
              <div className="text-[11px] text-zinc-500 mt-0.5">{specs?.ram_gb ? 'RAM' : (locale === 'en' ? 'No data' : 'Нет данных')}</div>
            </div>

            <div className="p-4 rounded-xl bg-[#0c0e14] border border-white/[0.08]">
              <div className="flex items-center gap-1.5 text-zinc-400 text-xs mb-1">
                <HardDrive className="w-3.5 h-3.5 text-emerald-400" />
                <span>Накопитель</span>
              </div>
              <div className="text-lg font-bold text-white font-mono">
                {specs?.disk_gb ? `${specs.disk_gb} GB` : '—'}
              </div>
              <div className="text-[11px] text-zinc-500 mt-0.5">{specs?.disk_gb ? 'Disk' : (locale === 'en' ? 'No data' : 'Нет данных')}</div>
            </div>

            <div className="p-4 rounded-xl bg-[#0c0e14] border border-white/[0.08]">
              <div className="flex items-center gap-1.5 text-zinc-400 text-xs mb-1">
                <Radio className="w-3.5 h-3.5 text-amber-400" />
                <span>Сетевые порты</span>
              </div>
              <div className="text-lg font-bold text-white font-mono">
                {specs?.interfaces ? `${specs.interfaces.length}` : `${device.intent?.interfaces.length ?? 0}`}
              </div>
              <div className="text-[11px] text-zinc-500 mt-0.5">{locale === 'en' ? 'Per Git intent' : 'По Git-intent'}</div>
            </div>
          </div>

          {/* Network & Identity Card */}
          <div className="grid md:grid-cols-2 gap-4">
            <Panel title="Сетевое окружение и доступ" accent="bg-cyan-700">
              <Field label="Роль в фабрике">{ROLE_NAMES[device.role] ?? device.role}</Field>
              <Field label="Платформа / ОС">{PLATFORM_NAMES[device.platform] ?? device.platform}</Field>
              <Field label="Management IP">
                <span className="text-cyan-300 font-semibold">{device.management_ip}:{device.management_port}</span>
              </Field>
              <Field label="Bastion / ProxyJump">
                {device.proxy_jump ? (
                  <span className="text-indigo-300">{device.proxy_jump}</span>
                ) : (
                  <span className="text-zinc-500">Прямой доступ (Direct L3)</span>
                )}
              </Field>
              <Field label="Профиль доступа">{device.auth_profile}</Field>
              <Field label="Последняя проверка">
                {device.last_checked_at ? new Date(device.last_checked_at).toLocaleString('ru-RU') : '—'}
              </Field>
            </Panel>

            <Panel title="Git SoT Intent & BGP Routing" accent="bg-teal-700">
              <Field label="Сконфигурировано портов">{device.intent?.interfaces.length ?? 0}</Field>
              <Field label="BGP ASN">{device.intent?.bgp?.asn ? `AS ${device.intent.bgp.asn}` : '—'}</Field>
              <Field label="BGP Router ID">{device.intent?.bgp?.router_id ?? '—'}</Field>
              <Field label="BGP пиров (соседей)">{device.intent?.bgp?.neighbors.length ?? 0}</Field>
              <Field label="Правил фильтрации ACL">{device.intent?.acls.length ?? 0}</Field>
              <Field label="Проблем в моделях Intent">
                {device.intent_issues.length > 0 ? (
                  <span className="text-amber-400 font-semibold">{device.intent_issues.length} предупреждений</span>
                ) : (
                  <span className="text-emerald-400">100% Валидно</span>
                )}
              </Field>
            </Panel>
          </div>

          {/* Interfaces Table */}
          <div className="rounded-xl border border-white/[0.08] bg-[#0c0e14] overflow-hidden">
            <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between">
              <span className="text-xs font-semibold text-white tracking-tight">Сетевые интерфейсы</span>
              <span className="text-[11px] text-zinc-500 font-mono">
                {device.intent?.interfaces.length || 0} настроено в SoT
              </span>
            </div>
            <table className="w-full text-[13px]">
              <thead className="bg-white/[0.02]">
                <tr>
                  <Th>Интерфейс</Th>
                  <Th>Описание</Th>
                  <Th>IPv4 адрес</Th>
                  <Th>MTU</Th>
                  <Th>Режим</Th>
                  <Th>Состояние</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {device.intent?.interfaces.map((i) => (
                  <tr key={i.name} className="hover:bg-white/[0.02] transition-colors">
                    <td className="px-3 py-2 text-cyan-300 font-mono font-medium">{i.name}</td>
                    <td className="px-3 py-2 text-zinc-400">{i.description ?? '—'}</td>
                    <td className="px-3 py-2 font-mono text-zinc-300">{i.ipv4_address ?? '—'}</td>
                    <td className="px-3 py-2 font-mono text-zinc-400">{i.mtu}</td>
                    <td className="px-3 py-2 text-zinc-400 font-mono uppercase text-xs">{i.mode}</td>
                    <td className="px-3 py-2">
                      {i.enabled ? (
                        <span className="inline-flex items-center gap-1 text-emerald-400 text-xs">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> up
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-zinc-500 text-xs">
                          <span className="w-1.5 h-1.5 rounded-full bg-zinc-600" /> shutdown
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                {!device.intent?.interfaces.length && (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-zinc-500">
                      Интерфейсы еще не импортированы в Intent
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* EMBEDDED EMERGENCY DANGER ZONE */}
          <div className="rounded-xl border border-rose-500/30 bg-rose-950/10 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-rose-500/20 border border-rose-500/40 flex items-center justify-center text-rose-400">
                  <AlertOctagon className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white">
                    Аварийный пульт устройства (Emergency Operations)
                  </h3>
                  <p className="text-xs text-zinc-400">
                    Прямые аварийные воздействия в обход очередей Git/CI. Все операции протоколируются в неотчуждаемый аудит-лог.
                  </p>
                </div>
              </div>
              <span className="text-[11px] font-mono uppercase px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30">
                Danger Zone
              </span>
            </div>

            {emergencyResult && (
              <div className={`p-3 rounded-lg border text-xs flex items-center gap-2 ${
                emergencyResult.status === 'SUCCESS'
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                  : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
              }`}>
                {emergencyResult.status === 'SUCCESS' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                )}
                <span>{emergencyResult.message}</span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-1">
              <button
                disabled={!canAdmin}
                onClick={() =>
                  openEmergencyModal(
                    'rollback_last_commit',
                    'Экстренный откат к эталонной конфигурации',
                    'Возвращает устройство к последнему подтвержденному эталонному снапшоту в обход Git.'
                  )
                }
                className="p-3 rounded-xl bg-white/[0.03] hover:bg-rose-500/10 border border-white/[0.08] hover:border-rose-500/40 text-left transition-all group disabled:opacity-40 cursor-pointer"
              >
                <div className="flex items-center justify-between text-zinc-400 group-hover:text-rose-400 mb-1.5">
                  <RotateCcw className="w-4 h-4" />
                  <ChevronRight className="w-3.5 h-3.5 opacity-50" />
                </div>
                <div className="text-xs font-semibold text-zinc-200 group-hover:text-white">Откат (Rollback)</div>
                <div className="text-[11px] text-zinc-500 mt-0.5">К эталонному checkpoint</div>
              </button>

              <button
                disabled={!canAdmin}
                onClick={() =>
                  openEmergencyModal(
                    'reset_bgp_sessions',
                    'Сброс BGP пиринга (Soft/Hard Clear)',
                    'Принудительно разрывает и заново согласовывает BGP сессии со всеми пирами для устранения RIB зависаний.'
                  )
                }
                className="p-3 rounded-xl bg-white/[0.03] hover:bg-amber-500/10 border border-white/[0.08] hover:border-amber-500/40 text-left transition-all group disabled:opacity-40 cursor-pointer"
              >
                <div className="flex items-center justify-between text-zinc-400 group-hover:text-amber-400 mb-1.5">
                  <RefreshCw className="w-4 h-4" />
                  <ChevronRight className="w-3.5 h-3.5 opacity-50" />
                </div>
                <div className="text-xs font-semibold text-zinc-200 group-hover:text-white">Сброс BGP</div>
                <div className="text-[11px] text-zinc-500 mt-0.5">clear ip bgp * soft</div>
              </button>

              <button
                disabled={!canAdmin}
                onClick={() =>
                  openEmergencyModal(
                    'restart_services',
                    'Перезапуск сетевых демонов',
                    'Перезапуск демонов FRR / Routing Engine / eBGP процесса без перезагрузки всей операционной системы.'
                  )
                }
                className="p-3 rounded-xl bg-white/[0.03] hover:bg-amber-500/10 border border-white/[0.08] hover:border-amber-500/40 text-left transition-all group disabled:opacity-40 cursor-pointer"
              >
                <div className="flex items-center justify-between text-zinc-400 group-hover:text-amber-400 mb-1.5">
                  <Zap className="w-4 h-4" />
                  <ChevronRight className="w-3.5 h-3.5 opacity-50" />
                </div>
                <div className="text-xs font-semibold text-zinc-200 group-hover:text-white">Рестарт демона</div>
                <div className="text-[11px] text-zinc-500 mt-0.5">systemctl restart frr</div>
              </button>

              <button
                disabled={!canAdmin}
                onClick={() =>
                  openEmergencyModal(
                    'reboot',
                    'Мягкая перезагрузка ноды (Soft Reboot)',
                    'Отправка ACPI / graceful reboot сигнала на узел для холодного сброса стека.'
                  )
                }
                className="p-3 rounded-xl bg-white/[0.03] hover:bg-rose-500/10 border border-white/[0.08] hover:border-rose-500/40 text-left transition-all group disabled:opacity-40 cursor-pointer"
              >
                <div className="flex items-center justify-between text-zinc-400 group-hover:text-rose-400 mb-1.5">
                  <AlertOctagon className="w-4 h-4" />
                  <ChevronRight className="w-3.5 h-3.5 opacity-50" />
                </div>
                <div className="text-xs font-semibold text-zinc-200 group-hover:text-white">Перезагрузка ноды</div>
                <div className="text-[11px] text-zinc-500 mt-0.5">Graceful soft reboot</div>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: ПРОГНОЗ И WHAT-IF (TimesFM 3.0 & Stress Testing) */}
      {tab === 'Прогноз и What-If' && (
        <div className="space-y-6">
          <Panel
            title="Прогноз телеметрии TimesFM 3.0 (горизонт 6 часов)"
            accent="bg-indigo-600"
            right={
              <span className="flex gap-1">
                {METRICS.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setForecastMetric(m.id)}
                    className={`px-2.5 py-1 rounded text-xs cursor-pointer transition-colors ${
                      forecastMetric === m.id ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30' : 'text-zinc-400 hover:text-white hover:bg-white/10'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </span>
            }
          >
            {forecastError && <div className="text-rose-400 text-sm py-4">{forecastError}</div>}
            {!forecastData && !forecastError && (
              <div className="text-zinc-500 text-sm py-12 text-center flex flex-col items-center gap-2">
                <RefreshCw className="w-5 h-5 animate-spin text-cyan-400" />
                <span>Запуск нейросетевого инференса TimesFM 3.0…</span>
              </div>
            )}
            {forecastData && (
              <div className="space-y-4">
                {forecastData.breach_in_minutes !== null ? (
                  <div className="flex items-center gap-2.5 text-sm text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-3">
                    <AlertTriangle className="w-5 h-5 shrink-0" />
                    <div>
                      <span className="font-semibold">Внимание! </span>
                      Метрика «{forecastData.label}» превысит порог {forecastData.threshold}% примерно через{' '}
                      <strong>{forecastData.breach_in_minutes} мин</strong>. Рекомендуется балансировка ECMP.
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2.5 text-sm text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-3">
                    <CheckCircle2 className="w-5 h-5 shrink-0" />
                    <div>
                      <span className="font-semibold">Штатный режим: </span>
                      В ближайшие 6 часов превышения порога {forecastData.threshold}% не прогнозируется.
                    </div>
                  </div>
                )}

                <ForecastChart data={forecastData} />

                <div className="flex justify-between text-[11px] text-zinc-500">
                  <span>Модель: {forecastData.provider}. Коридор вероятностей — квантили 10–90 %.</span>
                  {forecastData.simulated && (
                    <span className="text-amber-500/80">Телеметрия генерируется по синтетическому профилю нагрузки</span>
                  )}
                </div>
              </div>
            )}
          </Panel>

          {/* WHAT-IF CAPACITY SIMULATOR */}
          <div className="rounded-xl border border-white/[0.08] bg-[#0c0e14] p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400">
                  <Sliders className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white">
                    What-If Симулятор емкости (Stress Test Simulator)
                  </h3>
                  <p className="text-xs text-zinc-400">
                    Оценка стабильности узла при пиковых нагрузках, падении соседних Spine или миграции сервисов.
                  </p>
                </div>
              </div>
              <span className="text-xs font-mono text-cyan-400 font-semibold">
                Добавочная нагрузка: +{whatIfExtraLoad}%
              </span>
            </div>

            {/* Scenario buttons */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <button
                onClick={() => setWhatIfExtraLoad(15)}
                className={`p-3 rounded-lg border text-left transition-all cursor-pointer ${
                  whatIfExtraLoad === 15
                    ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-300'
                    : 'bg-white/[0.02] border-white/[0.06] text-zinc-300 hover:bg-white/[0.05]'
                }`}
              >
                <div className="text-xs font-semibold">+15% Трафик</div>
                <div className="text-[11px] text-zinc-500 mt-0.5">Всплеск пользовательской активности</div>
              </button>

              <button
                onClick={() => setWhatIfExtraLoad(35)}
                className={`p-3 rounded-lg border text-left transition-all cursor-pointer ${
                  whatIfExtraLoad === 35
                    ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-300'
                    : 'bg-white/[0.02] border-white/[0.06] text-zinc-300 hover:bg-white/[0.05]'
                }`}
              >
                <div className="text-xs font-semibold">+35% Failover</div>
                <div className="text-[11px] text-zinc-500 mt-0.5">Отказ соседнего коммутатора фабрики</div>
              </button>

              <button
                onClick={() => setWhatIfExtraLoad(60)}
                className={`p-3 rounded-lg border text-left transition-all cursor-pointer ${
                  whatIfExtraLoad === 60
                    ? 'bg-rose-500/15 border-rose-500/40 text-rose-300'
                    : 'bg-white/[0.02] border-white/[0.06] text-zinc-300 hover:bg-white/[0.05]'
                }`}
              >
                <div className="text-xs font-semibold">+60% DDoS / Spike</div>
                <div className="text-[11px] text-zinc-500 mt-0.5">Аномальный объем входящего трафика</div>
              </button>

              <button
                onClick={() => setWhatIfExtraLoad(0)}
                className="p-3 rounded-lg border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05] text-zinc-400 hover:text-white text-left transition-all cursor-pointer"
              >
                <div className="text-xs font-semibold">Сброс нагрузки</div>
                <div className="text-[11px] text-zinc-500 mt-0.5">Штатный расчет модели</div>
              </button>
            </div>

            {/* Projected Outcome Card */}
            {whatIfExtraLoad > 0 && (
              <div className={`p-4 rounded-xl border flex items-start gap-3 animate-fade-in ${
                whatIfExtraLoad < 40
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                  : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
              }`}>
                {whatIfExtraLoad < 40 ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
                )}
                <div>
                  <div className="text-xs font-semibold text-white">
                    {whatIfExtraLoad < 40
                      ? `Запас пропускной способности достаточен (Headroom: ~${65 - whatIfExtraLoad}%)`
                      : `Критический риск исчерпания емкости буферов и сброса BFD-пакетов`}
                  </div>
                  <p className="text-[11px] text-zinc-400 mt-1 leading-relaxed">
                    {whatIfExtraLoad < 40
                      ? `При увеличении нагрузки на ${whatIfExtraLoad}% узел ${device.hostname} удержит утилизацию портов в безопасной зоне до 68%. BGP пиринг и задержки пакетов останутся в SLA.`
                      : `При росте нагрузки на ${whatIfExtraLoad}% утилизация аплинков достигнет 92%. Очереди Tail-Drop возрастут в 4.2 раза. Рекомендуется активировать альтернативные маршруты в BGP Intent до всплеска.`}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: SSH ТЕРМИНАЛ (WebTTY Console) */}
      {tab === 'SSH Терминал' && (
        <div className="rounded-xl border border-white/[0.08] bg-[#07090e] overflow-hidden flex flex-col h-[550px]">
          {/* Terminal Titlebar */}
          <div className="px-4 py-2.5 bg-white/[0.03] border-b border-white/[0.06] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-500/80" />
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500/80" />
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/80" />
              </div>
              <span className="text-xs font-mono text-zinc-400 ml-2">
                ssh://{device.auth_profile}@{device.management_ip}:{device.management_port}
                {device.proxy_jump ? ` (via ${device.proxy_jump})` : ''}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-mono text-emerald-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                LIVE TTY
              </span>
              <button
                onClick={() => handleRunCommand('clear')}
                className="px-2 py-0.5 rounded text-[11px] text-zinc-400 hover:text-white hover:bg-white/[0.06]"
              >
                Clear
              </button>
            </div>
          </div>

          {/* Quick Command Chips */}
          <div className="px-4 py-2 bg-white/[0.01] border-b border-white/[0.04] flex items-center gap-2 overflow-x-auto text-xs">
            <span className="text-zinc-500 text-[11px] shrink-0">Быстрые команды:</span>
            {isServer ? (
              <>
                <button
                  onClick={() => handleRunCommand('uptime')}
                  className="px-2 py-0.5 rounded bg-white/[0.04] hover:bg-white/[0.08] text-zinc-300 font-mono text-[11px]"
                >
                  uptime
                </button>
                <button
                  onClick={() => handleRunCommand('free -m')}
                  className="px-2 py-0.5 rounded bg-white/[0.04] hover:bg-white/[0.08] text-zinc-300 font-mono text-[11px]"
                >
                  free -m
                </button>
                <button
                  onClick={() => handleRunCommand('ip a')}
                  className="px-2 py-0.5 rounded bg-white/[0.04] hover:bg-white/[0.08] text-zinc-300 font-mono text-[11px]"
                >
                  ip a
                </button>
                <button
                  onClick={() => handleRunCommand('uname -a')}
                  className="px-2 py-0.5 rounded bg-white/[0.04] hover:bg-white/[0.08] text-zinc-300 font-mono text-[11px]"
                >
                  uname -a
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => handleRunCommand('show ip bgp summary')}
                  className="px-2 py-0.5 rounded bg-white/[0.04] hover:bg-white/[0.08] text-zinc-300 font-mono text-[11px]"
                >
                  show ip bgp summary
                </button>
                <button
                  onClick={() => handleRunCommand('show interfaces status')}
                  className="px-2 py-0.5 rounded bg-white/[0.04] hover:bg-white/[0.08] text-zinc-300 font-mono text-[11px]"
                >
                  show interfaces status
                </button>
                <button
                  onClick={() => handleRunCommand('show version')}
                  className="px-2 py-0.5 rounded bg-white/[0.04] hover:bg-white/[0.08] text-zinc-300 font-mono text-[11px]"
                >
                  show version
                </button>
              </>
            )}
          </div>

          {/* Terminal Screen */}
          <div className="flex-1 p-4 font-mono text-xs overflow-y-auto space-y-3 text-zinc-300 selection:bg-cyan-500/40">
            {terminalOutput.map((item, idx) => (
              <div key={idx} className="space-y-1">
                <div className="flex items-center gap-2 text-cyan-400">
                  <span className="text-zinc-600">[{item.time}]</span>
                  <span>{device.hostname}#</span>
                  <span className="text-white font-semibold">{item.command}</span>
                </div>
                <pre className="text-zinc-300 whitespace-pre-wrap pl-4 border-l border-white/[0.06] text-[12px]">
                  {item.output}
                </pre>
              </div>
            ))}
          </div>

          {/* Terminal Input Bar */}
          <div className="p-3 bg-white/[0.02] border-t border-white/[0.06] flex items-center gap-2">
            <span className="font-mono text-xs text-cyan-400 pl-1">{device.hostname}#</span>
            <input
              type="text"
              value={commandInput}
              onChange={(e) => setCommandInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRunCommand();
              }}
              placeholder={
                !isManaged
                  ? 'Команды аудита (режим MONITORING_ONLY). Мутации заблокированы.'
                  : 'Введите команду (например, show ip route или df -h)…'
              }
              className="flex-1 bg-transparent text-xs text-zinc-100 font-mono focus:outline-none"
            />
            <button
              onClick={() => handleRunCommand()}
              className="px-3 py-1 rounded bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30 text-xs font-mono transition-colors cursor-pointer"
            >
              Отправить
            </button>
          </div>
        </div>
      )}

      {/* TAB 4: AI COPILOT & РЕКОМЕНДАЦИИ */}
      {tab === 'AI Copilot' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-white/[0.08] bg-[#0c0e14] p-5 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white">
                  Интеллектуальный ассистент узла {device.hostname}
                </h3>
                <p className="text-xs text-zinc-400">
                  Анализ текущей телеметрии, дрейфа, резервирования емкости и синтез рекомендаций по конфигурации.
                </p>
              </div>
            </div>

            {/* Quick Prompt Chips */}
            <div className="flex flex-wrap gap-2 pt-1">
              <button
                onClick={() => handleAskCopilot(`Потянет ли этот узел дополнительную нагрузку +30%?`)}
                className="px-3 py-1.5 rounded-lg text-xs bg-white/[0.03] hover:bg-indigo-500/10 border border-white/[0.08] hover:border-indigo-500/30 text-zinc-300 hover:text-indigo-200 transition-colors cursor-pointer text-left"
              >
                💡 Потянет ли узел нагрузку +30%?
              </button>
              <button
                onClick={() => handleAskCopilot(`Как безопасно вывести узел ${device.hostname} на техобслуживание (Drain)?`)}
                className="px-3 py-1.5 rounded-lg text-xs bg-white/[0.03] hover:bg-indigo-500/10 border border-white/[0.08] hover:border-indigo-500/30 text-zinc-300 hover:text-indigo-200 transition-colors cursor-pointer text-left"
              >
                🛡️ Сценарий вывода на техобслуживание (Drain)
              </button>
              <button
                onClick={() => handleAskCopilot(`Проанализируй связность BGP и проверь риск сплит-брейна.`)}
                className="px-3 py-1.5 rounded-lg text-xs bg-white/[0.03] hover:bg-indigo-500/10 border border-white/[0.08] hover:border-indigo-500/30 text-zinc-300 hover:text-indigo-200 transition-colors cursor-pointer text-left"
              >
                🌐 Проверка BGP связности и сплит-брейна
              </button>
            </div>

            {/* Conversation Log */}
            <div className="space-y-3 min-h-[160px] max-h-[350px] overflow-y-auto p-4 rounded-xl bg-black/30 border border-white/[0.04]">
              {copilotHistory.length === 0 && (
                <div className="text-center text-xs text-zinc-500 py-10">
                  Задайте вопрос по узлу или выберите одну из готовых тем выше.
                </div>
              )}
              {copilotHistory.map((msg, i) => (
                <div
                  key={i}
                  className={`p-3 rounded-xl text-xs leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-indigo-600/20 border border-indigo-500/30 text-indigo-100 ml-12'
                      : 'bg-white/[0.04] border border-white/[0.06] text-zinc-200 mr-12'
                  }`}
                >
                  <div className="font-semibold mb-1 text-[11px] text-zinc-400">
                    {msg.role === 'user' ? 'Вы' : 'NetOps Copilot'}
                  </div>
                  <div className="whitespace-pre-wrap">{msg.text}</div>
                </div>
              ))}
              {copilotLoading && (
                <div className="text-xs text-indigo-400 flex items-center gap-2 p-2">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Формирование аналитического ответа…</span>
                </div>
              )}
            </div>

            {/* Input Bar */}
            <div className="flex gap-2">
              <input
                type="text"
                value={copilotInput}
                onChange={(e) => setCopilotInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAskCopilot(copilotInput);
                }}
                placeholder="Задайте вопрос по этому устройству или попросите сгенерировать конфиг…"
                className="flex-1 bg-zinc-900 border border-white/[0.08] focus:border-indigo-500/50 rounded-xl px-4 py-2.5 text-xs text-zinc-100 focus:outline-none"
              />
              <button
                onClick={() => handleAskCopilot(copilotInput)}
                disabled={copilotLoading || !copilotInput.trim()}
                className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-2 transition-colors disabled:opacity-40 cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Спросить</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Emergency Action Modal */}
      {emergencyModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="bg-[#0e1117] border border-rose-500/40 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl p-6 space-y-4">
            <div className="flex items-center gap-3 text-rose-400">
              <AlertOctagon className="w-6 h-6" />
              <h3 className="text-base font-bold text-white">{emergencyModal.title}</h3>
            </div>

            <p className="text-xs text-zinc-300 leading-relaxed">{emergencyModal.description}</p>

            <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs">
              ⚠️ Данное воздействие применяется немедленно в обход очередей верификации.
            </div>

            <div>
              <label className="block text-[11px] uppercase tracking-wider font-semibold text-zinc-400 mb-1.5">
                Обоснование экстренного воздействия (для Audit Trail) <span className="text-rose-400">*</span>
              </label>
              <input
                type="text"
                value={emergencyReason}
                onChange={(e) => setEmergencyReason(e.target.value)}
                placeholder="например: Инцидент INC-8402, зависание BGP пиринга"
                className="w-full bg-zinc-900 border border-white/[0.08] focus:border-rose-500/60 rounded-lg px-3 py-2 text-xs text-zinc-100 font-mono focus:outline-none"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/[0.06]">
              <button
                onClick={() => setEmergencyModal({ open: false, action: null, title: '', description: '' })}
                className="px-4 py-2 rounded-lg text-xs font-medium text-zinc-400 hover:text-white hover:bg-white/[0.05]"
              >
                Отмена
              </button>
              <button
                onClick={handleExecuteEmergencyAction}
                disabled={emergencyExecuting}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-600/20 transition-all disabled:opacity-40 cursor-pointer"
              >
                {emergencyExecuting ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Выполняется…</span>
                  </>
                ) : (
                  <>
                    <AlertOctagon className="w-3.5 h-3.5" />
                    <span>Подтвердить экстренное воздействие</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
