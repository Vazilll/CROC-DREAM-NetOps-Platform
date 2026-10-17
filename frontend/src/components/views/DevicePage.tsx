import React, { useEffect, useState, useCallback } from 'react';
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
  FileDown,
} from 'lucide-react';
import { api, getErrorMessage } from '../../api';
import type {
  DeviceDetail,
  DeviceHardwareSpecs,
  Forecast,
  UserRole,
  DeviceEmergencyAction,
} from '../../api';
import type { Locale } from '../../i18n';
import { ForecastChart } from '../charts/ForecastChart';
import {
  Panel,
  StatusBadge,
  OperStatusBadge,
  ManagementModeBadge,
} from '../layout/ui';
import { PLATFORM_NAMES, ROLE_NAMES } from '../../constants';

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
  { id: 'memory_pct', label: 'Память (RAM)' },
  { id: 'load_1m', label: 'Load Average (1m)' },
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

const renderFormattedText = (text: string) => {
  return text.split('\n').map((line, lineIdx) => {
    const parts = line.split(/(\*\*.*?\*\*|`.*?`)/g);
    return (
      <div key={lineIdx} className={line.trim() === '' ? 'h-2' : 'min-h-[1.25rem]'}>
        {parts.map((part, partIdx) => {
          if (part.startsWith('**') && part.endsWith('**')) {
            return (
              <strong key={partIdx} className="font-bold text-slate-900 dark:text-white">
                {part.slice(2, -2)}
              </strong>
            );
          }
          if (part.startsWith('`') && part.endsWith('`')) {
            return (
              <code
                key={partIdx}
                className="px-1.5 py-0.5 rounded bg-slate-200/80 dark:bg-white/[0.1] text-indigo-700 dark:text-cyan-300 font-mono text-[11px] font-semibold"
              >
                {part.slice(1, -1)}
              </code>
            );
          }
          return <span key={partIdx}>{part}</span>;
        })}
      </div>
    );
  });
};

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
  const [prevDeviceId, setPrevDeviceId] = useState(deviceId);
  const [tab, setTab] = useState<Tab>('Обзор');
  const [promoting, setPromoting] = useState(false);

  if (deviceId !== prevDeviceId) {
    setPrevDeviceId(deviceId);
    setDevice(null);
    setError('');
  }

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
  const [prevForecastKey, setPrevForecastKey] = useState(`${deviceId}-${METRICS[0].id}-${tab}`);

  const forecastKey = `${deviceId}-${forecastMetric}-${tab}`;
  if (forecastKey !== prevForecastKey) {
    setPrevForecastKey(forecastKey);
    if (tab === 'Прогноз и What-If') {
      setForecastData(null);
      setForecastError('');
    }
  }

  // Terminal State
  const [terminalOutput, setTerminalOutput] = useState<Array<{ command: string; output: string; time: string }>>([]);
  const [commandInput, setCommandInput] = useState('');
  const [terminalRunning, setTerminalRunning] = useState(false);

  // Device-scoped Copilot state
  const [copilotHistory, setCopilotHistory] = useState<Array<{ role: 'user' | 'assistant'; text: string }>>([]);
  const [copilotInput, setCopilotInput] = useState('');
  const [copilotLoading, setCopilotLoading] = useState(false);

  const fetchDevice = useCallback(() => {
    api.getDevice(deviceId)
      .then((d) => setDevice(d))
      .catch((e) => setError(e.message));
  }, [deviceId]);

  useEffect(() => {
    let active = true;
    api.getDevice(deviceId)
      .then((d) => {
        if (active) setDevice(d);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [deviceId]);

  // Load forecast when tab is Forecast
  useEffect(() => {
    if (tab !== 'Прогноз и What-If') return;
    let active = true;
    api.getForecast(deviceId, forecastMetric)
      .then((data) => {
        if (active) setForecastData(data);
      })
      .catch((e) => {
        if (active) setForecastError(e.message);
      });
    return () => {
      active = false;
    };
  }, [deviceId, forecastMetric, tab]);

  if (error) return <div className="text-rose-400 p-6">{error}</div>;
  if (!device) return <div className="text-zinc-500 p-6">Загрузка данных устройства…</div>;

  const isServer = device.platform === 'linux_server' || device.role === 'server';
  const isManaged = device.management_mode === 'MANAGED';
  const canAdmin = userRole === 'admin' || userRole === 'owner';

  // Parse hardware specs
  let specs: DeviceHardwareSpecs | null = null;
  if (device.hardware_specs) {
    try {
      specs = JSON.parse(device.hardware_specs) as DeviceHardwareSpecs;
    } catch {
      // fallback
    }
  }

  const handlePromote = async () => {
    setPromoting(true);
    try {
      const updated = await api.promoteDevice(device.id);
      setDevice((prev) => (prev ? { ...prev, management_mode: updated.management_mode } : null));
    } catch (err: unknown) {
      alert(`Ошибка перевода в управление: ${getErrorMessage(err)}`);
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
    } catch (err: unknown) {
      setEmergencyResult({
        status: 'ERROR',
        message: getErrorMessage(err, 'Ошибка выполнения действия'),
      });
    } finally {
      setEmergencyExecuting(false);
    }
  };

  // Run terminal command
  const handleRunCommand = async (cmdToRun?: string) => {
    const cmd = (cmdToRun || commandInput).trim();
    if (!cmd) return;

    const time = new Date().toLocaleTimeString('ru-RU');

    if (cmd === 'clear') {
      setTerminalOutput([]);
      setCommandInput('');
      return;
    }

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

    setTerminalRunning(true);
    setCommandInput('');

    try {
      const res = await api.executeEmergencyCommand(device.hostname, cmd);
      setTerminalOutput((prev) => [
        ...prev,
        {
          command: cmd,
          output: res.output?.trim() || (res.failed ? '[ERROR] Команда завершилась ошибкой' : '[OK] (пустой ответ устройства)'),
          time,
        },
      ]);
    } catch (err: unknown) {
      setTerminalOutput((prev) => [
        ...prev,
        {
          command: cmd,
          output: `[SSH ERROR] ${getErrorMessage(err, 'Ошибка соединения с узлом')}`,
          time,
        },
      ]);
    } finally {
      setTerminalRunning(false);
    }
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
    } catch (err: unknown) {
      setCopilotHistory((prev) => [
        ...prev,
        { role: 'assistant', text: `Ошибка получения ответа: ${getErrorMessage(err)}` },
      ]);
    } finally {
      setCopilotLoading(false);
    }
  };

  const handleExportPassport = () => {
    if (!device) return;
    const md = `# ТЕХНИЧЕСКИЙ ПАСПОРТ УЗЛА: ${device.hostname}
**Платформа**: ${PLATFORM_NAMES[device.platform] ?? device.platform}
**Роль в фабрике**: ${ROLE_NAMES[device.role] ?? device.role}
**Управленческий IP**: ${device.management_ip}:${device.management_port}
**Oper Status**: ${device.oper_status ?? 'UP'}
**Intent Status**: ${device.status}
**Режим управления**: ${device.management_mode}
**Дата выгрузки**: ${new Date().toLocaleString('ru-RU')}

---

## 1. Аппаратная спецификация
- **CPU**: ${specs?.cpu_cores ? `${specs.cpu_cores} vCPU` : '—'}
- **RAM**: ${specs?.ram_gb ? `${specs.ram_gb} GB RAM` : '—'}
- **Disk**: ${specs?.disk_gb ? `${specs.disk_gb} GB` : '—'}
- **Версия ОС**: ${specs?.os_version || 'Телеметрия не получена'}

## 2. Сетевая конфигурация
- **BGP AS**: ${device.intent?.bgp?.asn ?? '—'}
- **Router ID**: ${device.intent?.bgp?.router_id ?? '—'}
- **Сетевые интерфейсы**:
${(device.intent?.interfaces || []).map((i) => `  - \`${i.name}\`: IP ${i.ipv4_address || 'L2'} (${i.mode.toUpperCase()}) ${i.description ? `[${i.description}]` : ''}`).join('\n') || '  - Нет данных'}

---
*Документ сформирован платформой CROC DREAM NetOps Platform*
`;
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Passport_${device.hostname}_${new Date().toISOString().slice(0, 10)}.md`;
    link.click();
    URL.revokeObjectURL(url);
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

          <button
            onClick={handleExportPassport}
            className={`${btn} border border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/10`}
            title={locale === 'en' ? 'Export Device Passport to Markdown' : 'Экспорт технического паспорта в Markdown'}
          >
            <FileDown className="w-3.5 h-3.5 text-cyan-400" />
            <span>{locale === 'en' ? 'Passport (MD)' : 'Паспорт (MD)'}</span>
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
                  } catch (err: unknown) {
                    alert(`Ошибка удаления: ${getErrorMessage(err)}`);
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
                <span>{isServer ? 'Вычислительные ядра' : 'Control Plane / ASIC'}</span>
              </div>
              <div className="text-lg font-bold text-white font-mono">
                {specs?.cpu_cores ? `${specs.cpu_cores} vCPU` : '—'}
              </div>
              <div className="text-[11px] text-zinc-500 mt-0.5">
                {specs?.os_version ||
                  (device.status === 'UNREACHABLE'
                    ? 'Нет данных (стенд выключен)'
                    : `${PLATFORM_NAMES[device.platform] || device.platform} (не опрошено)`)}
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
              <div className="text-[11px] text-zinc-500 mt-0.5">
                {specs?.ram_gb
                  ? 'RAM (по SSH опросу)'
                  : locale === 'en'
                  ? 'No telemetry data'
                  : 'Нет данных (телеметрия не снята)'}
              </div>
            </div>

            <div className="p-4 rounded-xl bg-[#0c0e14] border border-white/[0.08]">
              <div className="flex items-center gap-1.5 text-zinc-400 text-xs mb-1">
                <HardDrive className="w-3.5 h-3.5 text-emerald-400" />
                <span>{isServer ? 'Накопитель' : 'BGP Автономная система (Git SoT)'}</span>
              </div>
              <div className="text-lg font-bold text-white font-mono">
                {specs?.disk_gb
                  ? `${specs.disk_gb} GB`
                  : device.intent?.bgp?.asn
                  ? `AS ${device.intent.bgp.asn}`
                  : '—'}
              </div>
              <div className="text-[11px] text-zinc-500 mt-0.5">
                {specs?.disk_gb
                  ? 'Disk'
                  : device.intent?.bgp?.neighbors
                  ? `${device.intent.bgp.neighbors.length} eBGP пиров (из YAML Intent)`
                  : locale === 'en'
                  ? 'No data'
                  : 'Нет данных'}
              </div>
            </div>

            <div className="p-4 rounded-xl bg-[#0c0e14] border border-white/[0.08]">
              <div className="flex items-center gap-1.5 text-zinc-400 text-xs mb-1">
                <Radio className="w-3.5 h-3.5 text-amber-400" />
                <span>Сетевые порты (Git SoT)</span>
              </div>
              <div className="text-lg font-bold text-white font-mono">
                {specs?.interfaces ? `${specs.interfaces.length}` : `${device.intent?.interfaces.length ?? 0}`}
              </div>
              <div className="text-[11px] text-zinc-500 mt-0.5">{locale === 'en' ? 'Per Git intent' : 'По декларативному Git-intent'}</div>
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
                ) : device.platform === 'huawei_vrp' ? (
                  <span className="text-indigo-300">SSH Jump (Containerlab Host)</span>
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
              <span className="text-xs font-semibold text-white tracking-tight">Сетевые интерфейсы (декларативный профиль Git SoT)</span>
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
                      {device.status === 'UNREACHABLE' || device.oper_status === 'DOWN' ? (
                        <span className="inline-flex items-center gap-1 text-rose-400 text-xs" title="Устройство недоступно по SSH; в Git SoT интерфейс объявлен как enabled">
                          <span className="w-1.5 h-1.5 rounded-full bg-rose-400" /> unreachable ({i.enabled ? 'SoT: up' : 'SoT: down'})
                        </span>
                      ) : i.enabled ? (
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
          <div className="rounded-xl border border-rose-200 dark:border-rose-500/30 bg-rose-50/70 dark:bg-rose-950/10 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-rose-500/10 dark:bg-rose-500/20 border border-rose-300 dark:border-rose-500/40 flex items-center justify-center text-rose-600 dark:text-rose-400">
                  <AlertOctagon className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                    Аварийный пульт устройства (Emergency Operations)
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-zinc-400">
                    Прямые аварийные воздействия в обход очередей Git/CI. Все операции протоколируются в неотчуждаемый аудит-лог.
                  </p>
                </div>
              </div>
              <span className="text-[11px] font-mono uppercase px-2 py-0.5 rounded bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-500/30 font-semibold">
                Danger Zone
              </span>
            </div>

            {emergencyResult && (
              <div className={`p-3 rounded-lg border text-xs flex items-center gap-2 ${
                emergencyResult.status === 'SUCCESS'
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
                  : 'bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-300'
              }`}>
                {emergencyResult.status === 'SUCCESS' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 dark:text-emerald-400 shrink-0" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-rose-500 dark:text-rose-400 shrink-0" />
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
                className="p-3 rounded-xl bg-white dark:bg-white/[0.03] hover:bg-rose-50/80 dark:hover:bg-rose-500/10 border border-slate-200 hover:border-rose-300 dark:border-white/[0.08] dark:hover:border-rose-500/40 text-left transition-all group disabled:opacity-40 cursor-pointer shadow-xs"
              >
                <div className="flex items-center justify-between text-slate-400 dark:text-zinc-400 group-hover:text-rose-600 dark:group-hover:text-rose-400 mb-1.5">
                  <RotateCcw className="w-4 h-4" />
                  <ChevronRight className="w-3.5 h-3.5 opacity-50" />
                </div>
                <div className="text-xs font-semibold text-slate-800 dark:text-zinc-200 group-hover:text-rose-600 dark:group-hover:text-white">Откат (Rollback)</div>
                <div className="text-[11px] text-slate-500 dark:text-zinc-500 mt-0.5">К эталонному checkpoint</div>
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
                className="p-3 rounded-xl bg-white dark:bg-white/[0.03] hover:bg-amber-50/80 dark:hover:bg-amber-500/10 border border-slate-200 hover:border-amber-300 dark:border-white/[0.08] dark:hover:border-amber-500/40 text-left transition-all group disabled:opacity-40 cursor-pointer shadow-xs"
              >
                <div className="flex items-center justify-between text-slate-400 dark:text-zinc-400 group-hover:text-amber-600 dark:group-hover:text-amber-400 mb-1.5">
                  <RefreshCw className="w-4 h-4" />
                  <ChevronRight className="w-3.5 h-3.5 opacity-50" />
                </div>
                <div className="text-xs font-semibold text-slate-800 dark:text-zinc-200 group-hover:text-amber-600 dark:group-hover:text-white">Сброс BGP</div>
                <div className="text-[11px] text-slate-500 dark:text-zinc-500 mt-0.5 font-mono">
                  {device.platform === 'huawei_vrp' ? 'reset bgp all' : 'clear ip bgp * soft'}
                </div>
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
                className="p-3 rounded-xl bg-white dark:bg-white/[0.03] hover:bg-amber-50/80 dark:hover:bg-amber-500/10 border border-slate-200 hover:border-amber-300 dark:border-white/[0.08] dark:hover:border-amber-500/40 text-left transition-all group disabled:opacity-40 cursor-pointer shadow-xs"
              >
                <div className="flex items-center justify-between text-slate-400 dark:text-zinc-400 group-hover:text-amber-600 dark:group-hover:text-amber-400 mb-1.5">
                  <Zap className="w-4 h-4" />
                  <ChevronRight className="w-3.5 h-3.5 opacity-50" />
                </div>
                <div className="text-xs font-semibold text-slate-800 dark:text-zinc-200 group-hover:text-amber-600 dark:group-hover:text-white">Рестарт демона</div>
                <div className="text-[11px] text-slate-500 dark:text-zinc-500 mt-0.5 font-mono">
                  {device.platform === 'huawei_vrp' ? 'reset routing-engine' : 'systemctl restart frr'}
                </div>
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
                className="p-3 rounded-xl bg-white dark:bg-white/[0.03] hover:bg-rose-50/80 dark:hover:bg-rose-500/10 border border-slate-200 hover:border-rose-300 dark:border-white/[0.08] dark:hover:border-rose-500/40 text-left transition-all group disabled:opacity-40 cursor-pointer shadow-xs"
              >
                <div className="flex items-center justify-between text-slate-400 dark:text-zinc-400 group-hover:text-rose-600 dark:group-hover:text-rose-400 mb-1.5">
                  <AlertOctagon className="w-4 h-4" />
                  <ChevronRight className="w-3.5 h-3.5 opacity-50" />
                </div>
                <div className="text-xs font-semibold text-slate-800 dark:text-zinc-200 group-hover:text-rose-600 dark:group-hover:text-white">Перезагрузка ноды</div>
                <div className="text-[11px] text-slate-500 dark:text-zinc-500 mt-0.5">Graceful soft reboot</div>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: ПРОГНОЗ И WHAT-IF (Stress Testing) */}
      {tab === 'Прогноз и What-If' && (
        <div className="space-y-6">
          <Panel
            title="Прогноз телеметрии (горизонт 6 часов)"
            accent="bg-indigo-600"
            right={
              <span className="flex flex-wrap gap-1">
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
                <span>Расчёт прогноза телеметрии…</span>
              </div>
            )}
            {forecastData && (
              <div className="space-y-4">
                {forecastData.breach_in_minutes !== null ? (
                  <div className="flex items-center gap-2.5 text-sm text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-3">
                    <AlertTriangle className="w-5 h-5 shrink-0" />
                    <div>
                      <span className="font-semibold">Внимание! </span>
                      Метрика «{forecastData.label}» превысит порог {forecastData.threshold}{forecastData.metric === 'load_1m' ? '' : '%'} примерно через{' '}
                      <strong>{forecastData.breach_in_minutes} мин</strong>. Рекомендуется балансировка ECMP.
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2.5 text-sm text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-3">
                    <CheckCircle2 className="w-5 h-5 shrink-0" />
                    <div>
                      <span className="font-semibold">Штатный режим: </span>
                      В ближайшие 6 часов превышения порога {forecastData.threshold}{forecastData.metric === 'load_1m' ? '' : '%'} не прогнозируется.
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
            {whatIfExtraLoad > 0 && (() => {
              const baseVal = forecastData && forecastData.history.length > 0
                ? forecastData.history[forecastData.history.length - 1]
                : (device.sparkline && device.sparkline.length > 0 ? device.sparkline[device.sparkline.length - 1] : null);
              const peakForecast = forecastData && forecastData.median.length > 0
                ? Math.max(...forecastData.median)
                : baseVal;
              const threshold = forecastData ? forecastData.threshold : 85;
              if (baseVal === null || peakForecast === null) {
                return (
                  <div className="p-4 rounded-xl border border-white/[0.08] bg-white/[0.02] text-xs text-zinc-400">
                    Недостаточно данных телеметрии с {device.hostname} для расчета нагрузки (+{whatIfExtraLoad}%).
                  </div>
                );
              }
              const projectedNow = Math.min(100, +(baseVal + whatIfExtraLoad).toFixed(1));
              const projectedPeak = Math.min(100, +(peakForecast + whatIfExtraLoad).toFixed(1));
              const headroom = +(threshold - projectedPeak).toFixed(1);
              const isSafe = projectedPeak < threshold;
              return (
                <div className={`p-4 rounded-xl border flex items-start gap-3 animate-fade-in ${
                  isSafe
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                    : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                }`}>
                  {isSafe ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                  ) : (
                    <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
                  )}
                  <div>
                    <div className="text-xs font-semibold text-white">
                      {isSafe
                        ? `Запас до порога ${threshold}% достаточен (Headroom: ${headroom}%)`
                        : `Прогнозируется превышение порога ${threshold}% (пик: ${projectedPeak}%)`}
                    </div>
                    <p className="text-[11px] text-zinc-400 mt-1 leading-relaxed">
                      Текущий замер: {baseVal}% → с добавкой +{whatIfExtraLoad}% составит {projectedNow}% (пик по прогнозу: {projectedPeak}% при пороге {threshold}%).
                    </p>
                  </div>
                </div>
              );
            })()}
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
                ssh://{isServer ? 'root' : 'admin'}@{device.management_ip}:{device.management_port}
                {device.proxy_jump ? ` (via ${device.proxy_jump})` : ''}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-mono text-emerald-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                LIVE SSH
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
                  disabled={terminalRunning}
                  className="px-2 py-0.5 rounded bg-white/[0.04] hover:bg-white/[0.08] text-zinc-300 font-mono text-[11px] disabled:opacity-50 cursor-pointer"
                >
                  uptime
                </button>
                <button
                  onClick={() => handleRunCommand('free -m')}
                  disabled={terminalRunning}
                  className="px-2 py-0.5 rounded bg-white/[0.04] hover:bg-white/[0.08] text-zinc-300 font-mono text-[11px] disabled:opacity-50 cursor-pointer"
                >
                  free -m
                </button>
                <button
                  onClick={() => handleRunCommand('ip a')}
                  disabled={terminalRunning}
                  className="px-2 py-0.5 rounded bg-white/[0.04] hover:bg-white/[0.08] text-zinc-300 font-mono text-[11px] disabled:opacity-50 cursor-pointer"
                >
                  ip a
                </button>
                <button
                  onClick={() => handleRunCommand('uname -a')}
                  disabled={terminalRunning}
                  className="px-2 py-0.5 rounded bg-white/[0.04] hover:bg-white/[0.08] text-zinc-300 font-mono text-[11px] disabled:opacity-50 cursor-pointer"
                >
                  uname -a
                </button>
              </>
            ) : device.platform === 'huawei_vrp' ? (
              <>
                <button
                  onClick={() => handleRunCommand('display bgp peer')}
                  disabled={terminalRunning}
                  className="px-2 py-0.5 rounded bg-white/[0.04] hover:bg-white/[0.08] text-zinc-300 font-mono text-[11px] disabled:opacity-50 cursor-pointer"
                >
                  display bgp peer
                </button>
                <button
                  onClick={() => handleRunCommand('display interface brief')}
                  disabled={terminalRunning}
                  className="px-2 py-0.5 rounded bg-white/[0.04] hover:bg-white/[0.08] text-zinc-300 font-mono text-[11px] disabled:opacity-50 cursor-pointer"
                >
                  display interface brief
                </button>
                <button
                  onClick={() => handleRunCommand('display cpu')}
                  disabled={terminalRunning}
                  className="px-2 py-0.5 rounded bg-white/[0.04] hover:bg-white/[0.08] text-zinc-300 font-mono text-[11px] disabled:opacity-50 cursor-pointer"
                >
                  display cpu
                </button>
                <button
                  onClick={() => handleRunCommand('display version')}
                  disabled={terminalRunning}
                  className="px-2 py-0.5 rounded bg-white/[0.04] hover:bg-white/[0.08] text-zinc-300 font-mono text-[11px] disabled:opacity-50 cursor-pointer"
                >
                  display version
                </button>
              </>
            ) : device.platform === 'arista_eos' ? (
              <>
                <button
                  onClick={() => handleRunCommand('show ip bgp summary')}
                  disabled={terminalRunning}
                  className="px-2 py-0.5 rounded bg-white/[0.04] hover:bg-white/[0.08] text-zinc-300 font-mono text-[11px] disabled:opacity-50 cursor-pointer"
                >
                  show ip bgp summary
                </button>
                <button
                  onClick={() => handleRunCommand('show interfaces status')}
                  disabled={terminalRunning}
                  className="px-2 py-0.5 rounded bg-white/[0.04] hover:bg-white/[0.08] text-zinc-300 font-mono text-[11px] disabled:opacity-50 cursor-pointer"
                >
                  show interfaces status
                </button>
                <button
                  onClick={() => handleRunCommand('show version')}
                  disabled={terminalRunning}
                  className="px-2 py-0.5 rounded bg-white/[0.04] hover:bg-white/[0.08] text-zinc-300 font-mono text-[11px] disabled:opacity-50 cursor-pointer"
                >
                  show version
                </button>
                <button
                  onClick={() => handleRunCommand('show ip route')}
                  disabled={terminalRunning}
                  className="px-2 py-0.5 rounded bg-white/[0.04] hover:bg-white/[0.08] text-zinc-300 font-mono text-[11px] disabled:opacity-50 cursor-pointer"
                >
                  show ip route
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => handleRunCommand('show ip bgp summary')}
                  disabled={terminalRunning}
                  className="px-2 py-0.5 rounded bg-white/[0.04] hover:bg-white/[0.08] text-zinc-300 font-mono text-[11px] disabled:opacity-50 cursor-pointer"
                >
                  show ip bgp summary
                </button>
                <button
                  onClick={() => handleRunCommand('show ip interface brief')}
                  disabled={terminalRunning}
                  className="px-2 py-0.5 rounded bg-white/[0.04] hover:bg-white/[0.08] text-zinc-300 font-mono text-[11px] disabled:opacity-50 cursor-pointer"
                >
                  show ip interface brief
                </button>
                <button
                  onClick={() => handleRunCommand('show processes cpu sorted | include CPU')}
                  disabled={terminalRunning}
                  className="px-2 py-0.5 rounded bg-white/[0.04] hover:bg-white/[0.08] text-zinc-300 font-mono text-[11px] disabled:opacity-50 cursor-pointer"
                >
                  show processes cpu
                </button>
                <button
                  onClick={() => handleRunCommand('show version')}
                  disabled={terminalRunning}
                  className="px-2 py-0.5 rounded bg-white/[0.04] hover:bg-white/[0.08] text-zinc-300 font-mono text-[11px] disabled:opacity-50 cursor-pointer"
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
            {terminalRunning && (
              <div className="flex items-center gap-2 text-amber-400 py-2">
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
                <span className="text-xs">Выполнение команды по SSH...</span>
              </div>
            )}
          </div>

          {/* Terminal Input Bar */}
          <div className="p-3 bg-white/[0.02] border-t border-white/[0.06] flex items-center gap-2">
            <span className="font-mono text-xs text-cyan-400 pl-1">{device.hostname}#</span>
            <input
              type="text"
              value={commandInput}
              disabled={terminalRunning}
              onChange={(e) => setCommandInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRunCommand();
              }}
              placeholder={
                terminalRunning
                  ? 'Ожидание ответа устройства…'
                  : !isManaged
                  ? 'Команды аудита (режим MONITORING_ONLY). Мутации заблокированы.'
                  : 'Введите команду (например, display version или show ip route)…'
              }
              className="flex-1 bg-transparent text-xs text-zinc-100 font-mono focus:outline-none disabled:opacity-50"
            />
            <button
              onClick={() => handleRunCommand()}
              disabled={terminalRunning}
              className="px-3 py-1 rounded bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30 text-xs font-mono transition-colors cursor-pointer disabled:opacity-50"
            >
              {terminalRunning ? 'Выполняется…' : 'Отправить'}
            </button>
          </div>
        </div>
      )}

      {/* TAB 4: AI COPILOT & РЕКОМЕНДАЦИИ */}
      {tab === 'AI Copilot' && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#0c0e14] p-5 md:p-6 space-y-4 shadow-sm dark:shadow-none">
            <div className="flex items-center gap-3 pb-3 border-b border-[var(--border-subtle)]">
              <div className="w-9 h-9 rounded-md bg-[var(--bg-subtle)] border border-[var(--border-subtle)] flex items-center justify-center text-[var(--text-primary)]">
                <Sparkles className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
                  <span>Интеллектуальный ассистент узла</span>
                  <span className="font-mono text-xs px-2 py-0.5 rounded bg-[var(--bg-subtle)] border border-[var(--border-subtle)] text-[var(--text-secondary)]">
                    {device.hostname}
                  </span>
                </h3>
                <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
                  Анализ текущей телеметрии, дрейфа, резервирования емкости и синтез рекомендаций по конфигурации.
                </p>
              </div>
            </div>

            {/* Quick Prompt Chips */}
            <div>
              <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500 dark:text-zinc-400 font-bold mb-2">
                Рекомендуемые сценарии анализа
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => handleAskCopilot(`Потянет ли этот узел дополнительную нагрузку +30%?`)}
                  className="px-3.5 py-2 rounded-xl text-xs font-medium bg-slate-100/90 hover:bg-indigo-50 dark:bg-white/[0.04] dark:hover:bg-indigo-500/15 border border-slate-200 hover:border-indigo-300 dark:border-white/[0.08] dark:hover:border-indigo-500/40 text-slate-800 dark:text-zinc-200 hover:text-indigo-700 dark:hover:text-indigo-200 transition-all cursor-pointer text-left shadow-xs flex items-center gap-2"
                >
                  <span>Потянет ли узел нагрузку +30%?</span>
                </button>
                <button
                  onClick={() => handleAskCopilot(`Как безопасно вывести узел ${device.hostname} на техобслуживание (Drain)?`)}
                  className="px-3.5 py-2 rounded-xl text-xs font-medium bg-slate-100/90 hover:bg-indigo-50 dark:bg-white/[0.04] dark:hover:bg-indigo-500/15 border border-slate-200 hover:border-indigo-300 dark:border-white/[0.08] dark:hover:border-indigo-500/40 text-slate-800 dark:text-zinc-200 hover:text-indigo-700 dark:hover:text-indigo-200 transition-all cursor-pointer text-left shadow-xs flex items-center gap-2"
                >
                  <span>Сценарий вывода на техобслуживание (Drain)</span>
                </button>
                <button
                  onClick={() => handleAskCopilot(`Проанализируй связность BGP и проверь риск сплит-брейна.`)}
                  className="px-3.5 py-2 rounded-xl text-xs font-medium bg-slate-100/90 hover:bg-indigo-50 dark:bg-white/[0.04] dark:hover:bg-indigo-500/15 border border-slate-200 hover:border-indigo-300 dark:border-white/[0.08] dark:hover:border-indigo-500/40 text-slate-800 dark:text-zinc-200 hover:text-indigo-700 dark:hover:text-indigo-200 transition-all cursor-pointer text-left shadow-xs flex items-center gap-2"
                >
                  <span>Проверка BGP связности и сплит-брейна</span>
                </button>
              </div>
            </div>

            {/* Conversation Log */}
            <div className="space-y-3 min-h-[180px] max-h-[420px] overflow-y-auto p-4 md:p-5 rounded-2xl bg-slate-50/90 dark:bg-black/40 border border-slate-200/90 dark:border-white/[0.06] flex flex-col">
              {copilotHistory.length === 0 && (
                <div className="m-auto text-center text-xs text-slate-500 dark:text-zinc-500 py-12 font-mono flex flex-col items-center gap-2">
                  <Sparkles className="w-6 h-6 text-indigo-400 opacity-60 animate-pulse" />
                  <span>Задайте вопрос по узлу или выберите одну из готовых тем выше.</span>
                </div>
              )}
              {copilotHistory.map((msg, i) => (
                <div
                  key={i}
                  className={`flex flex-col ${
                    msg.role === 'user' ? 'items-end' : 'items-start'
                  } w-full`}
                >
                  <div className="flex items-center gap-1.5 mb-1 px-1">
                    <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400">
                      {msg.role === 'user' ? 'Вы' : 'NetOps Copilot'}
                    </span>
                  </div>
                  <div
                    className={`rounded-2xl text-xs leading-relaxed max-w-[85%] md:max-w-[75%] px-4 py-3 shadow-xs ${
                      msg.role === 'user'
                        ? 'bg-indigo-600 text-white rounded-tr-xs shadow-indigo-500/10'
                        : 'bg-white dark:bg-zinc-900 border border-slate-200/80 dark:border-white/[0.08] text-slate-800 dark:text-zinc-200 rounded-tl-xs'
                    }`}
                  >
                    {renderFormattedText(msg.text)}
                  </div>
                </div>
              ))}
              {copilotLoading && (
                <div className="self-start flex items-center gap-2.5 p-3 rounded-2xl bg-white dark:bg-zinc-900 border border-slate-200/80 dark:border-white/[0.08] text-xs text-indigo-600 dark:text-indigo-400 shadow-xs">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span className="font-mono">Формирование аналитического ответа…</span>
                </div>
              )}
            </div>

            {/* Input Bar */}
            <div className="flex gap-2 pt-1">
              <input
                type="text"
                value={copilotInput}
                onChange={(e) => setCopilotInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAskCopilot(copilotInput);
                }}
                placeholder="Задайте вопрос по этому устройству или попросите сгенерировать конфиг…"
                className="flex-1 bg-white dark:bg-zinc-900 border border-slate-300 dark:border-white/[0.08] focus:border-indigo-500/70 focus:ring-2 focus:ring-indigo-500/20 rounded-xl px-4 py-2.5 text-xs text-slate-900 dark:text-zinc-100 placeholder:text-slate-400 dark:placeholder:text-zinc-500 focus:outline-none transition-all"
              />
              <button
                onClick={() => handleAskCopilot(copilotInput)}
                disabled={copilotLoading || !copilotInput.trim()}
                className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-2 transition-all disabled:opacity-40 disabled:hover:bg-indigo-600 cursor-pointer shadow-sm hover:shadow-indigo-500/25 active:scale-[0.98]"
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
              Данное воздействие применяется немедленно в обход очередей верификации.
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
