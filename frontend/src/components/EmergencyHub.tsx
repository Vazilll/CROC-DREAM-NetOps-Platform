import React, { useState, useEffect } from 'react';
import {
  Terminal as TerminalIcon,
  ShieldAlert,
  Play,
  RotateCcw,
  RefreshCw,
  AlertTriangle,
  Send,
  Trash2,
  Zap,
  Lock,
  ArrowRight,
  Copy,
  Check,
  History,
  Clock,
  User,
} from 'lucide-react';
import { api } from '../api';

const DEVICES = [
  { hostname: 'spine-1.croc.lab', platform: 'arista_eos', label: 'Spine-1 (Arista cEOS)' },
  { hostname: 'spine-2.croc.lab', platform: 'arista_eos', label: 'Spine-2 (Arista cEOS)' },
  { hostname: 'leaf-1.croc.lab', platform: 'cisco_iosxe', label: 'Leaf-1 (Cisco 8000V)' },
  { hostname: 'leaf-2.croc.lab', platform: 'cisco_iosxe', label: 'Leaf-2 (Cisco 8000V)' },
  { hostname: 'leaf-3.croc.lab', platform: 'huawei_vrp', label: 'Leaf-3 (Huawei CE12800)' },
  { hostname: 'leaf-4.croc.lab', platform: 'huawei_vrp', label: 'Leaf-4 (Huawei CE12800)' },
];

const PRESETS: Record<string, string[]> = {
  arista_eos: ['show ip bgp summary', 'show ip route', 'show interfaces status', 'show running-config'],
  cisco_iosxe: ['show ip bgp summary', 'show ip interface brief', 'show ip route', 'show version'],
  huawei_vrp: ['display bgp peer', 'display ip interface brief', 'display ip routing-table', 'display current-configuration'],
};

interface EmergencyHubProps {
  currentRole: 'operator' | 'admin';
  onSwitchRole: (role: 'operator' | 'admin') => void;
}

export const EmergencyHub: React.FC<EmergencyHubProps> = ({ currentRole, onSwitchRole }) => {
  const [selectedDevice, setSelectedDevice] = useState<string>(DEVICES[0].hostname);
  const [command, setCommand] = useState<string>('show ip bgp summary');
  const [cliOutput, setCliOutput] = useState<string>('// Готов к приему команд оператора...');
  const [isExecutingCmd, setIsExecutingCmd] = useState<boolean>(false);

  // Hot Patching
  const [patchText, setPatchText] = useState<string>('');
  const [patchReason, setPatchReason] = useState<string>('Аварийное вмешательство');
  const [isApplyingPatch, setIsApplyingPatch] = useState<boolean>(false);
  const [patchResult, setPatchResult] = useState<{ status: string; message: string } | null>(null);

  // Recovery
  const [isSoftResetting, setIsSoftResetting] = useState<boolean>(false);
  const [isHardResetting, setIsHardResetting] = useState<boolean>(false);
  const [resetModal, setResetModal] = useState<'soft' | 'hard' | null>(null);
  const [resetLog, setResetLog] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);

  // Audit Logs
  const [auditLogs, setAuditLogs] = useState<Array<{
    timestamp: string;
    user: string;
    action: string;
    device: string;
    payload: string;
    reason: string;
    success: boolean;
    output_preview: string;
  }>>([]);
  const [isLoadingAudit, setIsLoadingAudit] = useState<boolean>(false);

  const loadAudit = async () => {
    setIsLoadingAudit(true);
    try {
      const logs = await api.getEmergencyAudit();
      setAuditLogs([...logs].reverse());
    } catch (err) {
      console.error('Failed to load audit logs', err);
    } finally {
      setIsLoadingAudit(false);
    }
  };

  useEffect(() => {
    loadAudit();
  }, []);

  const activeDeviceObj = DEVICES.find((d) => d.hostname === selectedDevice) || DEVICES[0];
  const activePresets = PRESETS[activeDeviceObj.platform] || PRESETS.arista_eos;

  const handleRunCommand = async (cmdToRun = command) => {
    if (!cmdToRun.trim()) return;
    setIsExecutingCmd(true);
    setCliOutput((prev) => `${prev}\n\n$ [${selectedDevice}] # ${cmdToRun}\nВыполнение...`);
    try {
      const res = await api.executeEmergencyCommand(selectedDevice, cmdToRun);
      setCliOutput((prev) => `${prev}\n${res.output || '(нет вывода)'}`);
    } catch (err: any) {
      setCliOutput((prev) => `${prev}\n[ОШИБКА]: ${err.message || String(err)}`);
    } finally {
      setIsExecutingCmd(false);
      loadAudit();
    }
  };

  const handleApplyPatch = async () => {
    if (!patchText.trim()) return;
    setIsApplyingPatch(true);
    setPatchResult(null);
    try {
      const res = await api.applyEmergencyPatch(selectedDevice, patchText, patchReason);
      setPatchResult({
        status: 'ok',
        message: `Патч успешно применен на ${selectedDevice} (${res.applied_lines.length} строк).`,
      });
      setCliOutput((prev) => `${prev}\n\n[EMERGENCY PATCH APPLIED on ${selectedDevice}]:\n${res.output}`);
    } catch (err: any) {
      setPatchResult({
        status: 'error',
        message: `Сбой применения патча: ${err.message || String(err)}`,
      });
    } finally {
      setIsApplyingPatch(false);
      loadAudit();
    }
  };

  const handleSoftReset = async () => {
    setIsSoftResetting(true);
    setResetModal(null);
    setResetLog('Запуск мягкого сброса фабрики к эталонному Git SoT Intent...');
    try {
      const res = await api.softResetFabric();
      setResetLog(`[МЯГКИЙ СБРОС ЗАВЕРШЕН]: ${res.message}\nДетали: ${res.details}`);
    } catch (err: any) {
      setResetLog(`[ОШИБКА МЯГКОГО СБРОСА]: ${err.message || String(err)}`);
    } finally {
      setIsSoftResetting(false);
    }
  };

  const handleHardReset = async () => {
    setIsHardResetting(true);
    setResetModal(null);
    setResetLog('Передеплой Containerlab топологии на хосте 5.228.243.54 (reconfigure)...');
    try {
      const res = await api.hardResetFabric();
      setResetLog(`[ХАРД-СБРОС ЗАВЕРШЕН]: ${res.message}\n\nЛог:\n${res.details}`);
    } catch (err: any) {
      setResetLog(`[ОШИБКА ХАРД-СБРОСА]: ${err.message || String(err)}`);
    } finally {
      setIsHardResetting(false);
    }
  };

  const handleCopyCli = () => {
    navigator.clipboard.writeText(cliOutput);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // If Operator, show authorization barrier with easy switch
  if (currentRole !== 'admin') {
    return (
      <div className="max-w-4xl mx-auto p-8 animate-fade-in">
        <div className="p-8 rounded-2xl border border-amber-500/20 bg-amber-500/[0.04] text-center space-y-4">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
            <Lock className="w-7 h-7" />
          </div>
          <h2 className="text-xl font-bold text-white">Доступ к Аварийному пульту ограничен</h2>
          <p className="text-sm text-slate-400 max-w-md mx-auto leading-relaxed">
            Модуль аварийного вмешательства (прямой Web CLI, накатывание хот-патчей и двухуровневый сброс фабрики) доступен только пользователям с ролью <strong className="text-amber-300">Администратор</strong>.
          </p>
          <div className="pt-2">
            <button
              onClick={() => onSwitchRole('admin')}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm text-black bg-amber-400 hover:bg-amber-300 transition-all cursor-pointer shadow-lg shadow-amber-500/20"
            >
              Переключиться в режим Администратора
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto p-4 sm:p-6 animate-fade-in">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl border border-amber-500/30 bg-gradient-to-r from-amber-500/[0.08] via-amber-500/[0.02] to-transparent">
        <div className="flex items-center gap-3.5">
          <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold text-white tracking-tight">Аварийный пульт прямого управления</h1>
              <span className="px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-amber-500/20 text-amber-300 border border-amber-500/30">
                ADMIN EXCLUSIVE
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Прямой доступ к CLI Bare Metal оборудования, экстренное накатывание конфигурации и двухуровневый сброс сети.
            </p>
          </div>
        </div>

        {/* 2-Tier Recovery Quick Buttons */}
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => setResetModal('soft')}
            disabled={isSoftResetting || isHardResetting}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 transition-all cursor-pointer"
          >
            <RotateCcw className={`w-3.5 h-3.5 ${isSoftResetting ? 'animate-spin' : ''}`} />
            Мягкий сброс (Soft Reset)
          </button>
          <button
            onClick={() => setResetModal('hard')}
            disabled={isSoftResetting || isHardResetting}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold text-red-300 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 transition-all cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isHardResetting ? 'animate-spin' : ''}`} />
            Хард-рестарт Clab
          </button>
        </div>
      </div>

      {/* Recovery Log Feedback (if any) */}
      {resetLog && (
        <div className="p-4 rounded-xl border border-white/10 bg-[#0d0f14] text-xs font-mono text-slate-300 whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">
          {resetLog}
        </div>
      )}

      {/* Main Grid: CLI Terminal & Patch Studio */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Interactive Web CLI (7 cols) */}
        <div className="lg:col-span-7 flex flex-col rounded-2xl border border-white/10 bg-[#0d0f14] overflow-hidden">
          {/* CLI Header */}
          <div className="p-4 border-b border-white/[0.08] bg-white/[0.02] flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <TerminalIcon className="w-4 h-4 text-cyan-400" />
              <span className="text-xs font-bold uppercase tracking-wider text-slate-200">
                Interactive Web CLI
              </span>
            </div>

            {/* Device Selector */}
            <select
              value={selectedDevice}
              onChange={(e) => {
                setSelectedDevice(e.target.value);
                const dev = DEVICES.find((d) => d.hostname === e.target.value);
                if (dev && PRESETS[dev.platform]) {
                  setCommand(PRESETS[dev.platform][0]);
                }
              }}
              className="px-3 py-1.5 rounded-lg text-xs font-mono bg-white/[0.05] border border-white/10 text-white focus:outline-none focus:border-cyan-500"
            >
              {DEVICES.map((d) => (
                <option key={d.hostname} value={d.hostname} className="bg-slate-900 text-white">
                  {d.label}
                </option>
              ))}
            </select>
          </div>

          {/* Quick Command Pills */}
          <div className="px-4 py-2 border-b border-white/[0.06] bg-black/20 flex flex-wrap gap-1.5 items-center">
            <span className="text-[11px] font-mono text-slate-400 mr-1">Шаблоны:</span>
            {activePresets.map((preset) => (
              <button
                key={preset}
                onClick={() => {
                  setCommand(preset);
                  handleRunCommand(preset);
                }}
                className="px-2 py-0.5 rounded text-[11px] font-mono bg-white/[0.04] hover:bg-cyan-500/20 hover:text-cyan-300 text-slate-300 border border-white/[0.08] transition-all cursor-pointer"
              >
                {preset}
              </button>
            ))}
          </div>

          {/* Terminal Screen */}
          <div className="relative flex-1 p-4 bg-black/70 font-mono text-xs text-emerald-400/90 min-h-[340px] max-h-[460px] overflow-y-auto whitespace-pre-wrap selection:bg-emerald-500/30 leading-relaxed">
            {cliOutput}
            <div className="absolute top-3 right-3 flex items-center gap-1.5">
              <button
                onClick={handleCopyCli}
                title="Копировать вывод"
                className="p-1.5 rounded bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-all cursor-pointer"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
              <button
                onClick={() => setCliOutput(`// Очищено. Узел: ${selectedDevice}`)}
                title="Очистить терминал"
                className="p-1.5 rounded bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-all cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Command Input Bar */}
          <div className="p-3 border-t border-white/[0.08] bg-white/[0.02] flex items-center gap-2">
            <span className="text-xs font-mono text-cyan-400 pl-2">#</span>
            <input
              type="text"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleRunCommand()}
              placeholder="Введите команду (например: show ip bgp summary)..."
              disabled={isExecutingCmd}
              className="flex-1 bg-transparent border-0 text-xs font-mono text-white placeholder-slate-400 focus:outline-none"
            />
            <button
              onClick={() => handleRunCommand()}
              disabled={isExecutingCmd || !command.trim()}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold text-black bg-cyan-400 hover:bg-cyan-300 disabled:opacity-50 transition-all cursor-pointer shadow-md shadow-cyan-500/20"
            >
              {isExecutingCmd ? (
                <div className="w-3.5 h-3.5 border-2 border-black/30 border-t-black rounded-full animate-spin" />
              ) : (
                <Send className="w-3.5 h-3.5" />
              )}
              Отправить
            </button>
          </div>
        </div>

        {/* Right Column: Emergency Patch Studio (5 cols) */}
        <div className="lg:col-span-5 flex flex-col rounded-2xl border border-white/10 bg-[#0d0f14] overflow-hidden">
          <div className="p-4 border-b border-white/[0.08] bg-white/[0.02] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-400" />
              <span className="text-xs font-bold uppercase tracking-wider text-slate-200">
                Экстренный Патч-Студио
              </span>
            </div>
            <span className="text-[11px] font-mono text-slate-400">
              На узел: <strong className="text-cyan-400">{selectedDevice}</strong>
            </span>
          </div>

          <div className="p-4 space-y-4 flex-1 flex flex-col justify-between">
            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-mono text-slate-400 uppercase tracking-wider mb-1">
                  Причина вмешательства (Audit Log):
                </label>
                <input
                  type="text"
                  value={patchReason}
                  onChange={(e) => setPatchReason(e.target.value)}
                  placeholder="Обоснование для аудита..."
                  className="w-full px-3 py-1.5 rounded-lg text-xs font-mono bg-white/[0.04] border border-white/10 text-white focus:outline-none focus:border-amber-400"
                />
              </div>

              <div>
                <label className="block text-[11px] font-mono text-slate-400 uppercase tracking-wider mb-1">
                  Конфигурационные строки для применения:
                </label>
                <textarea
                  rows={8}
                  value={patchText}
                  onChange={(e) => setPatchText(e.target.value)}
                  placeholder={
                    activeDeviceObj.platform === 'huawei_vrp'
                      ? 'interface GE1/0/1\n undo shutdown\n quit'
                      : activeDeviceObj.platform === 'cisco_iosxe'
                      ? 'interface GigabitEthernet2\n no shutdown\n exit'
                      : 'interface Ethernet1\n no shutdown\n exit'
                  }
                  className="w-full p-3 rounded-lg text-xs font-mono bg-black/60 border border-white/10 text-amber-300 placeholder-slate-400 focus:outline-none focus:border-amber-400"
                />
              </div>

              {patchResult && (
                <div
                  className={`p-3 rounded-xl text-xs font-mono ${
                    patchResult.status === 'ok'
                      ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300'
                      : 'bg-red-500/10 border border-red-500/30 text-red-300'
                  }`}
                >
                  {patchResult.message}
                </div>
              )}
            </div>

            <div className="pt-2">
              <button
                onClick={handleApplyPatch}
                disabled={isApplyingPatch || !patchText.trim()}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-semibold text-xs text-black bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 disabled:opacity-50 transition-all cursor-pointer shadow-lg shadow-amber-500/20"
              >
                {isApplyingPatch ? (
                  <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                ) : (
                  <Play className="w-4 h-4 fill-current" />
                )}
                Применить экстренный патч на {selectedDevice}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Emergency Audit Trail Card */}
      <div className="rounded-2xl border border-white/5 bg-[#0a0c10]/80 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400">
              <History className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white">Журнал аудита аварийных вмешательств (Audit Trail)</h3>
              <p className="text-xs text-slate-400">
                Фиксация низкоуровневых команд, хот-патчей и сбросов администратора с таймстемпом
              </p>
            </div>
          </div>
          <button
            onClick={loadAudit}
            disabled={isLoadingAudit}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-300 bg-white/5 hover:bg-white/10 transition-all cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoadingAudit ? 'animate-spin' : ''}`} />
            Обновить
          </button>
        </div>

        {auditLogs.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-500">
            Журнал пуст. Экстренные действия еще не фиксировались.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-white/5 text-slate-400">
                  <th className="pb-2.5 font-medium">Время (UTC)</th>
                  <th className="pb-2.5 font-medium">Пользователь</th>
                  <th className="pb-2.5 font-medium">Узел</th>
                  <th className="pb-2.5 font-medium">Действие</th>
                  <th className="pb-2.5 font-medium">Команда / Детали</th>
                  <th className="pb-2.5 font-medium">Причина</th>
                  <th className="pb-2.5 font-medium text-right">Статус</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {auditLogs.map((entry, idx) => (
                  <tr key={idx} className="hover:bg-white/[0.02] transition-colors">
                    <td className="py-2.5 font-mono text-slate-400 whitespace-nowrap">
                      {new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </td>
                    <td className="py-2.5 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-mono text-[10px] bg-amber-500/10 border border-amber-500/20 text-amber-300">
                        <User className="w-3 h-3" />
                        {entry.user}
                      </span>
                    </td>
                    <td className="py-2.5 font-mono text-slate-300 whitespace-nowrap">{entry.device}</td>
                    <td className="py-2.5 whitespace-nowrap">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-md font-mono text-[10px] uppercase font-semibold ${
                          entry.action === 'cli_command'
                            ? 'bg-sky-500/10 border border-sky-500/20 text-sky-300'
                            : entry.action === 'emergency_patch'
                            ? 'bg-purple-500/10 border border-purple-500/20 text-purple-300'
                            : 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-300'
                        }`}
                      >
                        {entry.action}
                      </span>
                    </td>
                    <td className="py-2.5 font-mono text-slate-200 max-w-xs truncate" title={entry.payload}>
                      {entry.payload}
                    </td>
                    <td className="py-2.5 text-slate-400 max-w-xs truncate" title={entry.reason}>
                      {entry.reason}
                    </td>
                    <td className="py-2.5 text-right whitespace-nowrap">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-md font-mono text-[10px] font-semibold ${
                          entry.success
                            ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
                            : 'bg-red-500/10 border border-red-500/20 text-red-400'
                        }`}
                      >
                        {entry.success ? 'УСПЕШНО' : 'СБОЙ'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Confirmation Modals for Soft/Hard Reset */}
      {resetModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-md p-6 rounded-2xl border border-white/10 bg-[#0d0f14] shadow-2xl text-slate-200 space-y-4">
            <div className="flex items-center gap-3">
              <div
                className={`p-2.5 rounded-xl ${
                  resetModal === 'soft'
                    ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
                    : 'bg-red-500/10 border border-red-500/30 text-red-400'
                }`}
              >
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">
                  {resetModal === 'soft' ? 'Подтверждение Мягкого сброса' : 'Подтверждение Хард-рестарта Clab'}
                </h3>
                <p className="text-xs text-slate-400">
                  {resetModal === 'soft'
                    ? 'Перенакат золотого эталона Git SoT'
                    : 'Передеплой всех 6 контейнеров на сервере'}
                </p>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              {resetModal === 'soft' ? (
                <>
                  Будет выполнен прогон NetOps pipeline по всем 6 узлам фабрики. Все несанкционированные команды будут устранены, а недостающие маршруты и интерфейсы восстановлены (~5 секунд).
                </>
              ) : (
                <>
                  Внимание: будет вызвана команда <code className="text-red-300 font-mono">containerlab deploy --reconfigure</code> на сервере 5.228.243.54. Сетевые сессии перезапустятся.
                </>
              )}
            </p>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                onClick={() => setResetModal(null)}
                className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-white bg-white/5 hover:bg-white/10 transition-all cursor-pointer"
              >
                Отмена
              </button>
              <button
                onClick={resetModal === 'soft' ? handleSoftReset : handleHardReset}
                className={`px-5 py-2 rounded-xl text-xs font-semibold text-black transition-all cursor-pointer ${
                  resetModal === 'soft'
                    ? 'bg-emerald-400 hover:bg-emerald-300 shadow-lg shadow-emerald-500/20'
                    : 'bg-red-500 hover:bg-red-400 shadow-lg shadow-red-500/20 text-white'
                }`}
              >
                {resetModal === 'soft' ? 'Выполнить Soft Reset' : 'Выполнить Hard Reset'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
