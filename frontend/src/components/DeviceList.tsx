import { useState } from 'react';
import {
  Server,
  Play,
  RotateCw,
  Search,
  CheckCircle2,
  AlertTriangle,
  HelpCircle,
  ExternalLink,
  ShieldCheck,
  RefreshCw,
  GitBranch,
  Terminal,
  Cpu,
  Activity,
} from 'lucide-react';
import type { Device, DeviceStatus } from '../api';
import { DeviceDetailModal } from './DeviceDetailModal';

interface DeviceListProps {
  devices: Device[];
  loading: boolean;
  onRefresh: () => void;
  onRunDryRun: (deviceIds: number[]) => void;
  onScanDrift: (deviceIds?: number[]) => void;
  onSyncInventory: () => void;
  onLintIntent: () => void;
}

export const DeviceList: React.FC<DeviceListProps> = ({
  devices,
  loading,
  onRefresh,
  onRunDryRun,
  onScanDrift,
  onSyncInventory,
  onLintIntent,
}) => {
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [selectedDeviceModalId, setSelectedDeviceModalId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const toggleSelectAll = () => {
    if (selectedIds.length === devices.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(devices.map((d) => d.id));
    }
  };

  const toggleSelectOne = (id: number) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const filteredDevices = devices.filter(
    (d) =>
      d.hostname.toLowerCase().includes(searchQuery.toLowerCase()) ||
      d.management_ip.includes(searchQuery) ||
      d.platform.toLowerCase().includes(searchQuery.toLowerCase()) ||
      d.role.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const inSyncCount = devices.filter((d) => d.status === 'IN_SYNC').length;
  const driftCount = devices.filter((d) => d.status === 'DRIFT_DETECTED').length;
  const unreachableCount = devices.filter((d) => d.status === 'UNREACHABLE').length;

  const getStatusBadge = (status: DeviceStatus) => {
    switch (status) {
      case 'IN_SYNC':
        return (
          <span className="inline-flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-mono font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/25">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span>IN_SYNC</span>
          </span>
        );
      case 'DRIFT_DETECTED':
        return (
          <span className="inline-flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-mono font-medium bg-amber-500/10 text-amber-400 border border-amber-500/25">
            <AlertTriangle className="w-3 h-3 text-amber-400" />
            <span>DRIFT DETECTED</span>
          </span>
        );
      case 'UNREACHABLE':
        return (
          <span className="inline-flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-mono font-medium bg-rose-500/10 text-rose-400 border border-rose-500/25">
            <AlertTriangle className="w-3 h-3 text-rose-400" />
            <span>UNREACHABLE</span>
          </span>
        );
      case 'IN_PROGRESS':
        return (
          <span className="inline-flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-mono font-medium bg-cyan-500/10 text-cyan-400 border border-cyan-500/25 animate-pulse">
            <RotateCw className="w-3 h-3 animate-spin" />
            <span>IN PROGRESS</span>
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-mono font-medium bg-zinc-800 text-zinc-400 border border-white/[0.08]">
            <HelpCircle className="w-3 h-3" />
            <span>UNKNOWN</span>
          </span>
        );
    }
  };

  const getPlatformBadge = (platform: string) => {
    switch (platform) {
      case 'arista_eos':
        return (
          <span className="px-2 py-0.5 rounded bg-blue-500/10 text-blue-300 border border-blue-500/25 text-[10px] font-mono">
            Arista EOS
          </span>
        );
      case 'cisco_iosxe':
        return (
          <span className="px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-300 border border-cyan-500/25 text-[10px] font-mono">
            Cisco IOS-XE
          </span>
        );
      case 'juniper_junos':
        return (
          <span className="px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-300 border border-indigo-500/25 text-[10px] font-mono">
            Juniper Junos
          </span>
        );
      case 'eltex_mes':
        return (
          <span className="px-2 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/25 text-[10px] font-mono">
            Eltex MES
          </span>
        );
      case 'yadro_kornfe':
        return (
          <span className="px-2 py-0.5 rounded bg-purple-500/10 text-purple-300 border border-purple-500/25 text-[10px] font-mono">
            YADRO Kornfe
          </span>
        );
      default:
        return (
          <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 text-[10px] font-mono">
            {platform}
          </span>
        );
    }
  };

  const getRoleBadge = (role: string) => {
    switch (role) {
      case 'spine':
        return <span className="text-[10px] font-mono text-purple-400">SPINE</span>;
      case 'leaf':
        return <span className="text-[10px] font-mono text-cyan-400">LEAF</span>;
      case 'border_firewall':
        return <span className="text-[10px] font-mono text-amber-400">BORDER FW</span>;
      default:
        return <span className="text-[10px] font-mono text-zinc-500">{role.toUpperCase()}</span>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Yandex Annushka Process Lifecycle Flow Banner */}
      <div className="p-4 rounded-2xl bg-[#0c0e14] border border-white/[0.08] shadow-lg">
        <div className="flex items-center justify-between pb-3 border-b border-white/[0.06] mb-3">
          <div className="flex items-center space-x-2">
            <span className="text-[10px] font-mono font-bold tracking-wider text-cyan-400 uppercase">
              КОНВЕЙЕР УПРАВЛЕНИЯ КОНФИГУРАЦИЕЙ
            </span>
            <span className="text-[10px] text-zinc-500 font-mono">| Яндекс Аннушка Pipeline</span>
          </div>
          <div className="text-[10px] font-mono text-zinc-400">
            Безопасный цикл: <span className="text-emerald-400 font-semibold">Commit Confirmed 180s</span>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
          {[
            { step: '01', name: 'Git SoT', desc: 'inventory.yaml', icon: GitBranch, color: 'text-cyan-400' },
            { step: '02', name: 'Jinja2', desc: 'Шаблонизация', icon: Cpu, color: 'text-purple-400' },
            { step: '03', name: 'hier_config', desc: 'AST-сравнение', icon: Terminal, color: 'text-indigo-400' },
            { step: '04', name: 'AI Risk Guard', desc: 'Аудит рисков', icon: ShieldCheck, color: 'text-amber-400' },
            { step: '05', name: 'Commit Confirmed', desc: 'Накат сессии', icon: Play, color: 'text-emerald-400' },
            { step: '06', name: 'Telemetry', desc: 'BGP & Link check', icon: Activity, color: 'text-rose-400' },
          ].map((st, i) => {
            const Icon = st.icon;
            return (
              <div key={i} className="p-2.5 rounded-xl bg-white/[0.02] border border-white/[0.05] flex items-center space-x-2">
                <Icon className={`w-3.5 h-3.5 ${st.color} shrink-0`} />
                <div className="min-w-0 flex-1">
                  <div className="text-white text-xs font-medium truncate">{st.name}</div>
                  <div className="text-zinc-500 text-[10px] truncate">{st.desc}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Aeza-style Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1 */}
        <div className="p-4 rounded-2xl bg-[#0c0e14] border border-white/[0.08] relative overflow-hidden flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono text-zinc-400">Узлы Фабрики</span>
            <Server className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="mt-3">
            <div className="text-3xl font-bold font-mono text-white tracking-tight">{devices.length}</div>
            <div className="mt-1 text-[11px] text-zinc-500 font-mono">
              2x Arista, 2x Cisco, 2x Juniper
            </div>
          </div>
        </div>

        {/* Card 2 */}
        <div className="p-4 rounded-2xl bg-[#0c0e14] border border-white/[0.08] relative overflow-hidden flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono text-emerald-400">В Синхронизации</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="mt-3">
            <div className="text-3xl font-bold font-mono text-emerald-300 tracking-tight">{inSyncCount}</div>
            <div className="mt-1 text-[11px] text-emerald-500/80 font-mono">
              Running = Intended
            </div>
          </div>
        </div>

        {/* Card 3 */}
        <div className="p-4 rounded-2xl bg-[#0c0e14] border border-white/[0.08] relative overflow-hidden flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono text-amber-400">Обнаружен Дрейф</span>
            <AlertTriangle className="w-4 h-4 text-amber-400" />
          </div>
          <div className="mt-3">
            <div className="text-3xl font-bold font-mono text-amber-300 tracking-tight">{driftCount}</div>
            <div className="mt-1 text-[11px] text-amber-500/80 font-mono">
              Ожидает Remediate
            </div>
          </div>
        </div>

        {/* Card 4 */}
        <div className="p-4 rounded-2xl bg-[#0c0e14] border border-white/[0.08] relative overflow-hidden flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono text-cyan-400">SSH Связность</span>
            <ShieldCheck className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="mt-3">
            <div className="text-3xl font-bold font-mono text-white tracking-tight">
              {devices.length - unreachableCount}/{devices.length}
            </div>
            <div className="mt-1 text-[11px] text-cyan-500/80 font-mono">
              Scrapli Driver Ready
            </div>
          </div>
        </div>
      </div>

      {/* Action Toolbar */}
      <div className="p-3.5 rounded-2xl bg-[#0c0e14] border border-white/[0.08] flex flex-col md:flex-row items-center justify-between gap-3">
        {/* Search */}
        <div className="relative w-full md:w-80">
          <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Поиск по хосту, IP или ОС (Cisco, Arista...)"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-1.5 bg-zinc-950 border border-white/[0.08] rounded-xl text-xs font-mono text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-cyan-500/50 transition"
          />
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto justify-end">
          <button
            onClick={onRefresh}
            className="p-1.5 bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white border border-white/[0.08] rounded-xl transition cursor-pointer"
            title="Обновить устройства"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={onSyncInventory}
            className="px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-white/[0.08] rounded-xl text-xs font-medium flex items-center space-x-1.5 transition cursor-pointer"
            title="Перечитать inventory.yaml из репозитория Git"
          >
            <GitBranch className="w-3.5 h-3.5 text-cyan-400" />
            <span>Синхр. Git</span>
          </button>

          <button
            onClick={onLintIntent}
            className="px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-white/[0.08] rounded-xl text-xs font-medium flex items-center space-x-1.5 transition cursor-pointer"
            title="Pre-flight проверка Pydantic моделей"
          >
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>Pre-flight Lint</span>
          </button>

          <button
            onClick={() => onScanDrift(selectedIds.length > 0 ? selectedIds : undefined)}
            className="px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 text-amber-300 border border-amber-500/30 rounded-xl text-xs font-medium flex items-center space-x-1.5 transition cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Скан дрейфа</span>
          </button>

          <button
            onClick={() => onRunDryRun(selectedIds.length > 0 ? selectedIds : devices.map((d) => d.id))}
            className="px-4 py-1.5 bg-cyan-500 hover:bg-cyan-400 text-zinc-950 rounded-xl text-xs font-semibold flex items-center space-x-1.5 transition shadow-lg shadow-cyan-500/20 cursor-pointer"
          >
            <Play className="w-3 h-3 fill-current" />
            <span>
              {selectedIds.length > 0
                ? `Холостой прогон (${selectedIds.length})`
                : 'Холостой прогон (Все)'}
            </span>
          </button>
        </div>
      </div>

      {/* Device Table */}
      <div className="rounded-2xl bg-[#0c0e14] border border-white/[0.08] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-zinc-950/80 border-b border-white/[0.08] text-zinc-400 font-mono text-[11px]">
              <tr>
                <th className="py-3 px-4 w-10">
                  <input
                    type="checkbox"
                    checked={devices.length > 0 && selectedIds.length === devices.length}
                    onChange={toggleSelectAll}
                    className="rounded bg-zinc-900 border-white/[0.2] text-cyan-500 focus:ring-0 cursor-pointer"
                  />
                </th>
                <th className="py-3 px-4">Устройство (Hostname)</th>
                <th className="py-3 px-4">Роль в CLOS</th>
                <th className="py-3 px-4">Платформа / ОС</th>
                <th className="py-3 px-4">Management IP</th>
                <th className="py-3 px-4">Статус Синхронизации</th>
                <th className="py-3 px-4 text-right">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04]">
              {loading && devices.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-zinc-500">
                    <RotateCw className="w-5 h-5 mx-auto animate-spin text-cyan-400 mb-2" />
                    Загрузка инвентаря устройств...
                  </td>
                </tr>
              ) : filteredDevices.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-zinc-500">
                    Устройства не найдены по запросу «{searchQuery}»
                  </td>
                </tr>
              ) : (
                filteredDevices.map((dev) => {
                  const isSelected = selectedIds.includes(dev.id);
                  return (
                    <tr
                      key={dev.id}
                      className={`hover:bg-white/[0.02] transition font-mono ${
                        isSelected ? 'bg-cyan-500/[0.03]' : ''
                      }`}
                    >
                      <td className="py-3 px-4">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelectOne(dev.id)}
                          className="rounded bg-zinc-900 border-white/[0.2] text-cyan-500 focus:ring-0 cursor-pointer"
                        />
                      </td>

                      <td className="py-3 px-4">
                        <div className="flex items-center space-x-2">
                          <Server className="w-3.5 h-3.5 text-zinc-500" />
                          <span className="font-bold text-white tracking-wide">{dev.hostname}</span>
                        </div>
                      </td>

                      <td className="py-3 px-4">{getRoleBadge(dev.role)}</td>

                      <td className="py-3 px-4">{getPlatformBadge(dev.platform)}</td>

                      <td className="py-3 px-4 text-zinc-300">
                        {dev.management_ip}:{dev.management_port}
                      </td>

                      <td className="py-3 px-4">{getStatusBadge(dev.status)}</td>

                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end space-x-2">
                          <button
                            onClick={() => setSelectedDeviceModalId(dev.id)}
                            className="px-2.5 py-1 rounded bg-white/[0.04] hover:bg-white/[0.08] text-zinc-300 border border-white/[0.06] text-[11px] font-sans transition flex items-center space-x-1 cursor-pointer"
                          >
                            <span>Параметры</span>
                            <ExternalLink className="w-3 h-3 text-zinc-400" />
                          </button>

                          <button
                            onClick={() => onRunDryRun([dev.id])}
                            className="p-1 rounded bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 transition cursor-pointer"
                            title="Холостой прогон (Dry Run)"
                          >
                            <Play className="w-3 h-3 fill-current" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal for Device Parameters */}
      {selectedDeviceModalId !== null && (
        <DeviceDetailModal
          deviceId={selectedDeviceModalId}
          onClose={() => setSelectedDeviceModalId(null)}
        />
      )}
    </div>
  );
};
