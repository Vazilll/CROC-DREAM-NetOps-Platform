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
  Zap,
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
  const [step, setStep] = useState<1 | 2>(1);
  const [ip, setIp] = useState('');
  const [port, setPort] = useState(22);
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('admin');
  const [proxyJump, setProxyJump] = useState('');
  const [authProfile, setAuthProfile] = useState('lab_creds');
  const [customCreds, setCustomCreds] = useState(true);

  const [platform, setPlatform] = useState<Platform>('linux_server');
  const [role, setRole] = useState<DeviceRole>('leaf');
  const [hostname, setHostname] = useState('');

  const [probing, setProbing] = useState(false);
  const [probeResult, setProbeResult] = useState<DeviceProbeResult | null>(null);
  const [probeError, setProbeError] = useState('');
  const [saving, setSaving] = useState(false);

  if (!isOpen) return null;

  // Smart IP handler that splits ip:port if pasted
  const handleIpChange = (val: string) => {
    let clean = val.trim();
    if (clean.includes(':')) {
      const parts = clean.split(':');
      setIp(parts[0]);
      const p = parseInt(parts[1], 10);
      if (!isNaN(p) && p > 0 && p <= 65535) {
        setPort(p);
      }
    } else {
      setIp(val);
    }
  };

  const handleProbe = async () => {
    let cleanIp = ip.trim().replace(/^https?:\/\//, '');
    let cleanPort = port;
    if (cleanIp.includes(':')) {
      const parts = cleanIp.split(':');
      cleanIp = parts[0];
      const p = parseInt(parts[1], 10);
      if (!isNaN(p) && p > 0 && p <= 65535) cleanPort = p;
    }

    if (!cleanIp) {
      setProbeError('Укажите IP-адрес или FQDN устройства');
      return;
    }

    setProbing(true);
    setProbeError('');
    try {
      const res = await api.probeDevice({
        management_ip: cleanIp,
        management_port: cleanPort,
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
    setProbeError('');
    try {
      let cleanIp = ip.trim().replace(/^https?:\/\//, '');
      let cleanPort = port;
      if (cleanIp.includes(':')) {
        const parts = cleanIp.split(':');
        cleanIp = parts[0];
        const p = parseInt(parts[1], 10);
        if (!isNaN(p) && p > 0 && p <= 65535) cleanPort = p;
      }

      const rawHostname = hostname.trim() || probeResult?.hostname || `node-${cleanPort}`;
      // Sanitize hostname to valid RFC label (only letters, digits, and hyphens)
      const finalHostname = rawHostname.replace(/[^A-Za-z0-9.-]/g, '-').toLowerCase();

      const newDev = await api.createDevice({
        hostname: finalHostname,
        management_ip: cleanIp,
        management_port: cleanPort,
        platform,
        role,
        auth_profile: customCreds ? 'custom_ssh' : authProfile,
        management_mode: 'MONITORING_ONLY',
        proxy_jump: proxyJump.trim() || null,
        hardware_specs: probeResult
          ? JSON.stringify({
              cpu_cores: probeResult.cpu_cores,
              ram_gb: probeResult.ram_gb,
              disk_gb: probeResult.disk_gb,
              os_version: probeResult.os_version,
              interfaces: probeResult.interfaces,
            })
          : null,
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/90 backdrop-blur-xl animate-fade-in">
      <div className="bg-[#08090c] border border-white/[0.08] rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl shadow-cyan-950/20 flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06] bg-gradient-to-b from-white/[0.02] to-transparent shrink-0">
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
            className="text-zinc-400 hover:text-white p-1 rounded-lg hover:bg-white/[0.05] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 overflow-y-auto flex-1">
          {!isPermitted ? (
            <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/25 text-rose-300 text-xs flex items-center gap-3">
              <ShieldAlert className="w-5 h-5 shrink-0 text-rose-400" />
              <span>
                Недостаточно прав. Добавление оборудования разрешено только ролям{' '}
                <strong>Владелец (Owner)</strong> или <strong>Администратор (Admin)</strong>.
              </span>
            </div>
          ) : (
            <>
              {/* STEP 1: Connection & Credentials */}
              {step === 1 && (
                <div className="space-y-4">
                  {/* Presets Chips for Live Lab */}
                  <div className="p-3 rounded-xl bg-[#0c0e14] border border-white/[0.06] space-y-2">
                    <div className="text-[11px] font-semibold text-zinc-400 flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-cyan-400">
                        <Zap className="w-3.5 h-3.5 text-cyan-400" />
                        Быстрый выбор узлов стенда (5.228.243.54):
                      </span>
                      <span className="text-[10px] text-zinc-500 font-mono">admin / admin</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {[
                        { label: 'spine-1 (:2211 Arista)', port: 2211, role: 'spine' as DeviceRole },
                        { label: 'spine-2 (:2212 Arista)', port: 2212, role: 'spine' as DeviceRole },
                        { label: 'leaf-1 (:2221 Cisco)', port: 2221, role: 'leaf' as DeviceRole },
                        { label: 'leaf-2 (:2222 Cisco)', port: 2222, role: 'leaf' as DeviceRole },
                        { label: 'leaf-3 (:2231 Huawei)', port: 2231, role: 'leaf' as DeviceRole },
                        { label: 'leaf-4 (:2232 Huawei)', port: 2232, role: 'leaf' as DeviceRole },
                        { label: 'Host (:22 Debian)', port: 22, role: 'server' as DeviceRole },
                      ].map((item) => (
                        <button
                          key={item.port}
                          type="button"
                          onClick={() => {
                            setIp('5.228.243.54');
                            setPort(item.port);
                            setCustomCreds(true);
                            setUsername('admin');
                            setPassword('admin');
                            setRole(item.role);
                          }}
                          className="px-2.5 py-1 rounded bg-white/[0.04] hover:bg-cyan-500/20 hover:text-cyan-300 border border-white/[0.08] hover:border-cyan-500/40 text-[11px] font-mono text-zinc-300 transition-all cursor-pointer"
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="sm:col-span-2">
                      <label className="block text-[11px] uppercase tracking-wider font-semibold text-zinc-400 mb-1.5">
                        IP-адрес или хостнейм <span className="text-cyan-400">*</span>
                      </label>
                      <input
                        type="text"
                        value={ip}
                        onChange={(e) => handleIpChange(e.target.value)}
                        placeholder="например, 5.228.243.54 или 10.0.10.15"
                        className="w-full bg-[#050608] border border-white/[0.08] focus:border-cyan-500/60 rounded-lg px-3 py-2 text-xs text-zinc-100 font-mono focus:outline-none transition-colors"
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
                        className="w-full bg-[#050608] border border-white/[0.08] focus:border-cyan-500/60 rounded-lg px-3 py-2 text-xs text-zinc-100 font-mono focus:outline-none transition-colors"
                      />
                    </div>
                  </div>

                  {/* Bastion / ProxyJump */}
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
                      className="w-full bg-[#050608] border border-white/[0.08] focus:border-cyan-500/60 rounded-lg px-3 py-2 text-xs text-zinc-200 font-mono focus:outline-none transition-colors"
                    />
                  </div>

                  {/* Auth Configuration */}
                  <div className="p-3.5 rounded-xl bg-[#0c0e14] border border-white/[0.06] space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-zinc-300">Аутентификация SSH</span>
                      <label className="flex items-center gap-2 cursor-pointer text-xs text-zinc-400 hover:text-zinc-200">
                        <input
                          type="checkbox"
                          checked={customCreds}
                          onChange={(e) => setCustomCreds(e.target.checked)}
                          className="rounded bg-zinc-900 border-zinc-700"
                        />
                        <span>Кастомные реквизиты</span>
                      </label>
                    </div>

                    {!customCreds ? (
                      <div className="flex items-center gap-3">
                        <select
                          value={authProfile}
                          onChange={(e) => setAuthProfile(e.target.value)}
                          className="bg-[#050608] border border-white/[0.08] rounded-lg px-3 py-1.5 text-xs text-zinc-200 flex-1 focus:outline-none"
                        >
                          <option value="lab_creds">Профиль по умолчанию: lab_creds (admin/admin)</option>
                          <option value="production_vault">Корпоративный HashiCorp Vault</option>
                          <option value="ed25519_key">SSH-ключ ed25519</option>
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
                            className="w-full bg-[#050608] border border-white/[0.08] rounded-lg px-3 py-1.5 text-xs text-zinc-100 font-mono focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] text-zinc-400 mb-1">Пароль / Secret Key</label>
                          <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="••••••••••••"
                            className="w-full bg-[#050608] border border-white/[0.08] rounded-lg px-3 py-1.5 text-xs text-zinc-100 font-mono focus:outline-none"
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {probeError && (
                    <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/25 text-rose-300 text-xs flex items-center gap-2.5">
                      <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
                      <span>{probeError}</span>
                    </div>
                  )}
                </div>
              )}

              {/* STEP 2: Probe Results & Confirmation */}
              {step === 2 && probeResult && (
                <div className="space-y-4 animate-fade-in">
                  <div
                    className={`p-4 rounded-xl border flex items-center justify-between ${
                      probeResult.reachable
                        ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300'
                        : 'bg-rose-500/10 border-rose-500/25 text-rose-300'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      {probeResult.reachable ? (
                        <CheckCircle2 className="w-6 h-6 text-emerald-400 shrink-0" />
                      ) : (
                        <AlertTriangle className="w-6 h-6 text-rose-400 shrink-0" />
                      )}
                      <div>
                        <div className="font-semibold text-xs text-white">
                          {probeResult.reachable
                            ? 'Оборудование успешно обнаружено'
                            : 'Узел не отвечает по указанному порту'}
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
                    <div className="p-3 rounded-xl bg-[#0c0e14] border border-white/[0.06]">
                      <div className="flex items-center gap-1.5 text-zinc-400 text-[11px] mb-1">
                        <Cpu className="w-3.5 h-3.5 text-cyan-400" />
                        <span>CPU Cores</span>
                      </div>
                      <div className="text-base font-bold text-zinc-100 font-mono">
                        {probeResult.cpu_cores ? `${probeResult.cpu_cores} vCPU` : '—'}
                      </div>
                    </div>

                    <div className="p-3 rounded-xl bg-[#0c0e14] border border-white/[0.06]">
                      <div className="flex items-center gap-1.5 text-zinc-400 text-[11px] mb-1">
                        <HardDrive className="w-3.5 h-3.5 text-indigo-400" />
                        <span>Память RAM</span>
                      </div>
                      <div className="text-base font-bold text-zinc-100 font-mono">
                        {probeResult.ram_gb ? `${probeResult.ram_gb} GB` : '—'}
                      </div>
                    </div>

                    <div className="p-3 rounded-xl bg-[#0c0e14] border border-white/[0.06]">
                      <div className="flex items-center gap-1.5 text-zinc-400 text-[11px] mb-1">
                        <HardDrive className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Диск NVMe</span>
                      </div>
                      <div className="text-base font-bold text-zinc-100 font-mono">
                        {probeResult.disk_gb ? `${probeResult.disk_gb} GB` : '—'}
                      </div>
                    </div>

                    <div className="p-3 rounded-xl bg-[#0c0e14] border border-white/[0.06]">
                      <div className="flex items-center gap-1.5 text-zinc-400 text-[11px] mb-1">
                        <Radio className="w-3.5 h-3.5 text-amber-400" />
                        <span>Интерфейсы</span>
                      </div>
                      <div className="text-base font-bold text-zinc-100 font-mono">
                        {probeResult.interfaces && probeResult.interfaces.length > 0
                          ? `${probeResult.interfaces.length} портов`
                          : '—'}
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
                        placeholder={probeResult.hostname || 'leaf-1'}
                        className="w-full bg-[#050608] border border-white/[0.08] focus:border-cyan-500/60 rounded-lg px-3 py-1.5 text-xs text-zinc-100 font-mono focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] uppercase tracking-wider font-semibold text-zinc-400 mb-1">
                        Роль в топологии
                      </label>
                      <select
                        value={role}
                        onChange={(e) => setRole(e.target.value as DeviceRole)}
                        className="w-full bg-[#050608] border border-white/[0.08] focus:border-cyan-500/60 rounded-lg px-3 py-1.5 text-xs text-zinc-200 focus:outline-none"
                      >
                        {Object.entries(ROLE_NAMES).map(([k, v]) => (
                          <option key={k} value={k}>
                            {v}
                          </option>
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
                        className="w-full bg-[#050608] border border-white/[0.08] focus:border-cyan-500/60 rounded-lg px-3 py-1.5 text-xs text-zinc-200 focus:outline-none"
                      >
                        {Object.entries(PLATFORM_NAMES).map(([k, v]) => (
                          <option key={k} value={k}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Safe-First Callout */}
                  <div className="p-3.5 rounded-xl bg-cyan-950/20 border border-cyan-500/20 text-cyan-200 text-xs flex items-start gap-3">
                    <Network className="w-5 h-5 text-cyan-400 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-semibold text-cyan-300">Безопасный Safe-First режим</div>
                      <p className="text-[11px] text-zinc-400 mt-0.5">
                        Устройство добавляется в режиме <strong>MONITORING_ONLY</strong>. В этом режиме
                        собирается телеметрия, но исключены случайные мутации конфигурации до явного
                        подтверждения администратором.
                      </p>
                    </div>
                  </div>

                  {/* Error in Step 2 */}
                  {probeError && (
                    <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/25 text-rose-300 text-xs flex items-center gap-2.5">
                      <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
                      <span>{probeError}</span>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {isPermitted && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-white/[0.06] bg-[#050608] shrink-0">
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
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-semibold bg-gradient-to-r from-cyan-500 to-indigo-600 text-white hover:from-cyan-400 hover:to-indigo-500 transition-all disabled:opacity-40 shadow-lg shadow-cyan-500/20 cursor-pointer"
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
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium text-zinc-400 hover:text-white hover:bg-white/[0.05] transition-colors cursor-pointer"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Назад к настройкам</span>
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold transition-all disabled:opacity-40 shadow-lg shadow-emerald-500/20 cursor-pointer"
                >
                  {saving ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Сохранение в инвентарь…</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
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
