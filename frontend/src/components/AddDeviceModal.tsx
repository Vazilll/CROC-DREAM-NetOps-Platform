import React, { useState } from 'react';
import {
  X,
  Server,
  Cpu,
  HardDrive,
  Network,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  ArrowLeft,
  Loader2,
  ShieldAlert,
  Radio,
} from 'lucide-react';
import { api } from '../api';
import type { Device, DeviceProbeResult, Platform, DeviceRole, UserRole } from '../api';
import { PLATFORM_NAMES, ROLE_NAMES } from './ui';

interface AddDeviceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (device: Device) => void;
  userRole: UserRole;
}

export const AddDeviceModal: React.FC<AddDeviceModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  userRole,
}) => {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [ip, setIp] = useState('');
  const [port, setPort] = useState(22);
  const [username, setUsername] = useState('root');
  const [password, setPassword] = useState('');
  const [proxyJump, setProxyJump] = useState('');
  const [authProfile, setAuthProfile] = useState('lab_creds');
  const [customCreds, setCustomCreds] = useState(false);

  const [platform, setPlatform] = useState<Platform>('linux_server');
  const [role, setRole] = useState<DeviceRole>('server');
  const [hostname, setHostname] = useState('');

  const [probing, setProbing] = useState(false);
  const [probeResult, setProbeResult] = useState<DeviceProbeResult | null>(null);
  const [probeError, setProbeError] = useState('');

  const [saving, setSaving] = useState(false);

  if (!isOpen) return null;

  const handleProbe = async () => {
    if (!ip.trim()) {
      setProbeError('Укажите IP-адрес или FQDN устройства');
      return;
    }
    setProbing(true);
    setProbeError('');
    try {
      const res = await api.probeDevice({
        management_ip: ip.trim(),
        management_port: port,
        username: customCreds ? username : undefined,
        password: customCreds ? password : undefined,
        proxy_jump: proxyJump.trim() || undefined,
      });
      setProbeResult(res);
      if (res.hostname && !hostname) {
        setHostname(res.hostname);
      }
      if (res.detected_platform) {
        setPlatform(res.detected_platform);
      }
      if (res.detected_role) {
        setRole(res.detected_role);
      }
      setStep(2);
    } catch (err: any) {
      setProbeError(err.message || 'Ошибка SSH-пробы оборудования');
    } finally {
      setProbing(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const finalHostname = hostname.trim() || probeResult?.hostname || `host-${ip.replace(/\./g, '-')}`;
      const newDev = await api.createDevice({
        hostname: finalHostname,
        management_ip: ip.trim(),
        management_port: port,
        platform,
        role,
        auth_profile: customCreds ? 'custom_ssh' : authProfile,
        management_mode: 'MONITORING_ONLY',
        proxy_jump: proxyJump.trim() || null,
        hardware_specs: probeResult ? JSON.stringify({
          cpu_cores: probeResult.cpu_cores,
          ram_gb: probeResult.ram_gb,
          disk_gb: probeResult.disk_gb,
          os_version: probeResult.os_version,
          interfaces: probeResult.interfaces,
        }) : null,
      });

      onSuccess(newDev);
      handleClose();
    } catch (err: any) {
      setProbeError(err.message || 'Ошибка создания устройства в инвентаре');
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    setStep(1);
    setProbeResult(null);
    setProbeError('');
    onClose();
  };

  const isPermitted = userRole === 'admin' || userRole === 'owner';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
      <div className="bg-[#0e1117] border border-white/[0.1] rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.08] bg-white/[0.02]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-500/20 to-indigo-500/20 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
              <Server className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white tracking-tight">
                Добавление устройства / сервера
              </h2>
              <p className="text-xs text-zinc-400">
                Шаг {step} из 2 · SSH Probe &amp; Безопасный онбординг (Safe-First)
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="text-zinc-500 hover:text-white p-1 rounded-lg hover:bg-white/[0.06] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5 flex-1 overflow-y-auto max-h-[75vh]">
          {!isPermitted ? (
            <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs flex items-center gap-3">
              <ShieldAlert className="w-5 h-5 shrink-0" />
              <span>
                Для добавления оборудования в фабрику требуются права <strong>Администратора</strong> или <strong>Владельца</strong>.
              </span>
            </div>
          ) : (
            <>
              {/* STEP 1: Connection & Auth */}
              {step === 1 && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="sm:col-span-2">
                      <label className="block text-[11px] uppercase tracking-wider font-semibold text-zinc-400 mb-1.5">
                        IP-адрес или хостнейм <span className="text-cyan-400">*</span>
                      </label>
                      <input
                        type="text"
                        value={ip}
                        onChange={(e) => setIp(e.target.value)}
                        placeholder="например, 10.0.10.15 или vps.bare-tan.net"
                        className="w-full bg-zinc-900 border border-white/[0.08] focus:border-cyan-500/60 rounded-lg px-3 py-2 text-xs text-zinc-100 font-mono focus:outline-none transition-colors"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] uppercase tracking-wider font-semibold text-zinc-400 mb-1.5">
                        SSH Порт
                      </label>
                      <input
                        type="number"
                        value={port}
                        onChange={(e) => setPort(Number(e.target.value))}
                        className="w-full bg-zinc-900 border border-white/[0.08] focus:border-cyan-500/60 rounded-lg px-3 py-2 text-xs text-zinc-100 font-mono focus:outline-none transition-colors"
                      />
                    </div>
                  </div>

                  {/* Bastion / ProxyJump (Enterprise Pattern) */}
                  <div>
                    <label className="flex items-center justify-between text-[11px] uppercase tracking-wider font-semibold text-zinc-400 mb-1.5">
                      <span>Bastion / ProxyJump (Опционально)</span>
                      <span className="text-zinc-500 font-normal lowercase">GlavNOC Jump Host</span>
                    </label>
                    <input
                      type="text"
                      value={proxyJump}
                      onChange={(e) => setProxyJump(e.target.value)}
                      placeholder="bastion-user@jump.infra.internal:22"
                      className="w-full bg-zinc-900 border border-white/[0.08] focus:border-cyan-500/60 rounded-lg px-3 py-2 text-xs text-zinc-200 font-mono focus:outline-none transition-colors"
                    />
                    <p className="text-[11px] text-zinc-500 mt-1">
                      Используется при нахождении ноды в изолированном сегменте DMZ/VPC без прямого внешнего IP.
                    </p>
                  </div>

                  {/* Auth Configuration */}
                  <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/[0.06] space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-zinc-300">Аутентификация SSH</span>
                      <label className="flex items-center gap-2 cursor-pointer text-xs text-zinc-400 hover:text-zinc-200">
                        <input
                          type="checkbox"
                          checked={customCreds}
                          onChange={(e) => setCustomCreds(e.target.checked)}
                          className="rounded bg-zinc-900 border-zinc-700"
                        />
                        <span>Указать кастомные учетные данные</span>
                      </label>
                    </div>

                    {!customCreds ? (
                      <div className="flex items-center gap-3">
                        <select
                          value={authProfile}
                          onChange={(e) => setAuthProfile(e.target.value)}
                          className="bg-zinc-900 border border-white/[0.08] rounded-lg px-3 py-1.5 text-xs text-zinc-200 flex-1 focus:outline-none"
                        >
                          <option value="lab_creds">Профиль по умолчанию: lab_creds (admin/admin)</option>
                          <option value="production_vault">Корпоративный HashiCorp Vault (AppRole)</option>
                          <option value="ed25519_key">SSH-ключ ed25519 (~/.ssh/id_netops)</option>
                        </select>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-3 pt-1">
                        <div>
                          <label className="block text-[11px] text-zinc-400 mb-1">Пользователь</label>
                          <input
                            type="text"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            className="w-full bg-zinc-900 border border-white/[0.08] rounded-lg px-3 py-1.5 text-xs text-zinc-100 font-mono"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] text-zinc-400 mb-1">Пароль / Secret Key</label>
                          <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="••••••••••••"
                            className="w-full bg-zinc-900 border border-white/[0.08] rounded-lg px-3 py-1.5 text-xs text-zinc-100 font-mono"
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {probeError && (
                    <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
                      <span>{probeError}</span>
                    </div>
                  )}
                </div>
              )}

              {/* STEP 2: Probe Results & Confirmation */}
              {step === 2 && probeResult && (
                <div className="space-y-4 animate-fade-in">
                  <div className={`p-4 rounded-xl border flex items-center justify-between ${
                    probeResult.reachable
                      ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300'
                      : 'bg-rose-500/10 border-rose-500/25 text-rose-300'
                  }`}>
                    <div className="flex items-center gap-3">
                      {probeResult.reachable ? (
                        <CheckCircle2 className="w-6 h-6 text-emerald-400 shrink-0" />
                      ) : (
                        <AlertTriangle className="w-6 h-6 text-rose-400 shrink-0" />
                      )}
                      <div>
                        <div className="font-semibold text-xs text-white">
                          {probeResult.reachable ? 'Оборудование успешно обнаружено' : 'Узел не отвечает по SSH'}
                        </div>
                        <div className="text-[11px] text-zinc-400">{probeResult.message}</div>
                      </div>
                    </div>
                    <span className="text-[11px] font-mono uppercase px-2 py-0.5 rounded bg-black/40">
                      {probeResult.reachable ? 'SSH Reachable' : 'Unreachable'}
                    </span>
                  </div>

                  {/* Discovered Specs Bento */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.06]">
                      <div className="flex items-center gap-1.5 text-zinc-400 text-[11px] mb-1">
                        <Cpu className="w-3.5 h-3.5 text-cyan-400" />
                        <span>CPU Cores</span>
                      </div>
                      <div className="text-base font-bold text-zinc-100 font-mono">
                        {probeResult.cpu_cores ? `${probeResult.cpu_cores} vCPU` : '—'}
                      </div>
                    </div>

                    <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.06]">
                      <div className="flex items-center gap-1.5 text-zinc-400 text-[11px] mb-1">
                        <HardDrive className="w-3.5 h-3.5 text-indigo-400" />
                        <span>Память RAM</span>
                      </div>
                      <div className="text-base font-bold text-zinc-100 font-mono">
                        {probeResult.ram_gb ? `${probeResult.ram_gb} GB` : '—'}
                      </div>
                    </div>

                    <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.06]">
                      <div className="flex items-center gap-1.5 text-zinc-400 text-[11px] mb-1">
                        <HardDrive className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Диск NVMe</span>
                      </div>
                      <div className="text-base font-bold text-zinc-100 font-mono">
                        {probeResult.disk_gb ? `${probeResult.disk_gb} GB` : '—'}
                      </div>
                    </div>

                    <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.06]">
                      <div className="flex items-center gap-1.5 text-zinc-400 text-[11px] mb-1">
                        <Radio className="w-3.5 h-3.5 text-amber-400" />
                        <span>Интерфейсы</span>
                      </div>
                      <div className="text-base font-bold text-zinc-100 font-mono">
                        {probeResult.interfaces ? `${probeResult.interfaces.length} портов` : '—'}
                      </div>
                    </div>
                  </div>

                  {/* Device Meta Form */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                    <div>
                      <label className="block text-[11px] uppercase tracking-wider font-semibold text-zinc-400 mb-1">
                        Хостнейм в фабрике
                      </label>
                      <input
                        type="text"
                        value={hostname}
                        onChange={(e) => setHostname(e.target.value)}
                        placeholder={probeResult.hostname || 'server-01'}
                        className="w-full bg-zinc-900 border border-white/[0.08] focus:border-cyan-500/60 rounded-lg px-3 py-1.5 text-xs text-zinc-100 font-mono focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] uppercase tracking-wider font-semibold text-zinc-400 mb-1">
                        Роль в топологии
                      </label>
                      <select
                        value={role}
                        onChange={(e) => setRole(e.target.value as DeviceRole)}
                        className="w-full bg-zinc-900 border border-white/[0.08] focus:border-cyan-500/60 rounded-lg px-3 py-1.5 text-xs text-zinc-200 focus:outline-none"
                      >
                        {Object.entries(ROLE_NAMES).map(([k, v]) => (
                          <option key={k} value={k}>{v}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] uppercase tracking-wider font-semibold text-zinc-400 mb-1">
                        Сетевая ОС / Платформа
                      </label>
                      <select
                        value={platform}
                        onChange={(e) => setPlatform(e.target.value as Platform)}
                        className="w-full bg-zinc-900 border border-white/[0.08] focus:border-cyan-500/60 rounded-lg px-3 py-1.5 text-xs text-zinc-200 focus:outline-none"
                      >
                        {Object.entries(PLATFORM_NAMES).map(([k, v]) => (
                          <option key={k} value={k}>{v}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Safe-First Callout */}
                  <div className="p-3.5 rounded-xl bg-cyan-950/30 border border-cyan-500/20 text-cyan-200 text-xs flex items-start gap-3">
                    <Network className="w-5 h-5 text-cyan-400 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-semibold text-cyan-300">Безопасный Safe-First режим</div>
                      <p className="text-[11px] text-zinc-400 mt-0.5">
                        Устройство добавляется в режиме <strong>MONITORING_ONLY</strong>. В этом режиме собирается телеметрия, но исключены случайные мутации конфигурации и деплои до явного подтверждения администратором.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {isPermitted && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-white/[0.08] bg-white/[0.02]">
            {step === 1 ? (
              <div className="flex items-center justify-between w-full">
                <button
                  onClick={handleClose}
                  className="px-4 py-2 rounded-lg text-xs font-medium text-zinc-400 hover:text-white hover:bg-white/[0.05] transition-colors"
                >
                  Отмена
                </button>
                <button
                  onClick={handleProbe}
                  disabled={probing || !ip.trim()}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-gradient-to-r from-cyan-500 to-indigo-600 text-white hover:from-cyan-400 hover:to-indigo-500 transition-all disabled:opacity-40 shadow-lg shadow-cyan-500/20 cursor-pointer"
                >
                  {probing ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Выполняется SSH Probe…</span>
                    </>
                  ) : (
                    <>
                      <span>Сканировать (SSH Probe)</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </>
                  )}
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between w-full">
                <button
                  onClick={() => setStep(1)}
                  disabled={saving}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium text-zinc-400 hover:text-white hover:bg-white/[0.05] transition-colors"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Назад к настройкам</span>
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 text-zinc-950 transition-all disabled:opacity-40 shadow-lg shadow-emerald-500/20 cursor-pointer"
                >
                  {saving ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Сохранение в инвентарь…</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Добавить в инвентарь (MONITORING_ONLY)</span>
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
