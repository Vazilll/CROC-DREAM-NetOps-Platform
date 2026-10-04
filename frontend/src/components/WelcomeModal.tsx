import React, { useState } from 'react';
import { Shield, Activity, ArrowRight, Server, CheckCircle2, Cpu, Eye, Key } from 'lucide-react';
import { api } from '../api';
import type { UserRole } from '../api';

interface WelcomeModalProps {
  isOpen: boolean;
  onClose: (role: UserRole) => void;
}

export const WelcomeModal: React.FC<WelcomeModalProps> = ({ isOpen, onClose }) => {
  const [selectedRole, setSelectedRole] = useState<UserRole>('admin');

  if (!isOpen) return null;

  const handleConfirm = () => {
    api.setRole(selectedRole);
    localStorage.setItem('netops_onboarding_done', 'true');
    onClose(selectedRole);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fade-in">
      <div className="relative w-full max-w-4xl overflow-hidden rounded-2xl border border-white/10 bg-[#0d0f14] shadow-2xl shadow-cyan-950/20 text-slate-200 flex flex-col max-h-[90vh]">
        {/* Glow Header */}
        <div className="relative p-6 sm:p-7 border-b border-white/[0.08] bg-gradient-to-b from-white/[0.03] to-transparent shrink-0">
          <div className="flex items-center gap-3 mb-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono font-medium tracking-wide uppercase bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
              CROC DREAM NetOps Platform
            </span>
            <span className="text-xs font-mono text-slate-400">Enterprise Multi-Vendor DCIM &amp; IBN</span>
          </div>

          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-white mb-2">
            Добро пожаловать в платформу управления фабрикой
          </h2>
          <p className="text-sm text-slate-400 max-w-2xl leading-relaxed">
            Единая среда управления гетерогенными сетевыми фабриками (Arista, Cisco, Huawei) и вычислительными Linux-серверами с валидацией инвариантов Z3, предиктивной аналитикой TimesFM 3.0 и безопасным онбордингом.
          </p>

          {/* Supported Vendors */}
          <div className="mt-3 flex flex-wrap gap-2 pt-2 border-t border-white/[0.06]">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/[0.04] border border-white/[0.08] text-xs font-mono text-slate-300">
              <Cpu className="w-3.5 h-3.5 text-cyan-400" />
              Arista cEOS (Spine)
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/[0.04] border border-white/[0.08] text-xs font-mono text-slate-300">
              <Server className="w-3.5 h-3.5 text-blue-400" />
              Cisco 8000V (Leaf)
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/[0.04] border border-white/[0.08] text-xs font-mono text-slate-300">
              <Server className="w-3.5 h-3.5 text-red-400" />
              Huawei CE12800 (Leaf)
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/[0.04] border border-white/[0.08] text-xs font-mono text-slate-300">
              <Server className="w-3.5 h-3.5 text-emerald-400" />
              Linux Compute / Aeza Bare-Metal
            </div>
          </div>
        </div>

        {/* Persona Choice Section */}
        <div className="p-6 sm:p-7 space-y-4 overflow-y-auto flex-1">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Шаг 1 из 2 · Выберите профиль доступа для текущей сессии:
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {/* Owner Card */}
            <div
              onClick={() => setSelectedRole('owner')}
              className={`relative flex flex-col justify-between p-4 rounded-xl border transition-all cursor-pointer ${
                selectedRole === 'owner'
                  ? 'border-purple-500/60 bg-purple-500/[0.08] shadow-lg shadow-purple-950/20'
                  : 'border-white/[0.08] bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]'
              }`}
            >
              {selectedRole === 'owner' && (
                <div className="absolute top-3 right-3 text-purple-400">
                  <CheckCircle2 className="w-4 h-4" />
                </div>
              )}
              <div>
                <div className="w-9 h-9 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400 mb-2.5">
                  <Key className="w-4 h-4" />
                </div>
                <h4 className="text-base font-semibold text-white mb-1">Владелец (Owner)</h4>
                <p className="text-xs text-slate-400 mb-3 leading-relaxed">
                  Абсолютный суверенитет: управление системными параметрами фабрики, выпуск API-токенов администраторам.
                </p>
                <ul className="space-y-1 text-[11px] text-slate-300">
                  <li className="flex items-center gap-1.5">
                    <span className="w-1 h-1 rounded-full bg-purple-400" />
                    Выпуск и ротация API токенов
                  </li>
                  <li className="flex items-center gap-1.5">
                    <span className="w-1 h-1 rounded-full bg-purple-400" />
                    Полный доступ ко всем слоям
                  </li>
                </ul>
              </div>
              <div className="mt-3 pt-2 border-t border-white/[0.06] text-[10px] font-mono text-purple-400/90">
                dev-owner-token
              </div>
            </div>

            {/* Admin Card */}
            <div
              onClick={() => setSelectedRole('admin')}
              className={`relative flex flex-col justify-between p-4 rounded-xl border transition-all cursor-pointer ${
                selectedRole === 'admin'
                  ? 'border-amber-500/60 bg-amber-500/[0.08] shadow-lg shadow-amber-950/20'
                  : 'border-white/[0.08] bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]'
              }`}
            >
              {selectedRole === 'admin' && (
                <div className="absolute top-3 right-3 text-amber-400">
                  <CheckCircle2 className="w-4 h-4" />
                </div>
              )}
              <div>
                <div className="w-9 h-9 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 mb-2.5">
                  <Shield className="w-4 h-4" />
                </div>
                <h4 className="text-base font-semibold text-white mb-1">Администратор (Admin)</h4>
                <p className="text-xs text-slate-400 mb-3 leading-relaxed">
                  Полный операционный контроль: онбординг узлов, SSH WebTTY, деплой с rollback и аварийный сброс.
                </p>
                <ul className="space-y-1 text-[11px] text-slate-300">
                  <li className="flex items-center gap-1.5">
                    <span className="w-1 h-1 rounded-full bg-amber-400" />
                    SSH Probe &amp; Promote оборудования
                  </li>
                  <li className="flex items-center gap-1.5">
                    <span className="w-1 h-1 rounded-full bg-amber-400" />
                    Деплой с Commit Confirmed таймером
                  </li>
                </ul>
              </div>
              <div className="mt-3 pt-2 border-t border-white/[0.06] text-[10px] font-mono text-amber-400/90">
                dev-admin-token
              </div>
            </div>

            {/* Operator Card */}
            <div
              onClick={() => setSelectedRole('operator')}
              className={`relative flex flex-col justify-between p-4 rounded-xl border transition-all cursor-pointer ${
                selectedRole === 'operator'
                  ? 'border-emerald-500/60 bg-emerald-500/[0.08] shadow-lg shadow-emerald-950/20'
                  : 'border-white/[0.08] bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]'
              }`}
            >
              {selectedRole === 'operator' && (
                <div className="absolute top-3 right-3 text-emerald-400">
                  <CheckCircle2 className="w-4 h-4" />
                </div>
              )}
              <div>
                <div className="w-9 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 mb-2.5">
                  <Activity className="w-4 h-4" />
                </div>
                <h4 className="text-base font-semibold text-white mb-1">Оператор (NOC Operator)</h4>
                <p className="text-xs text-slate-400 mb-3 leading-relaxed">
                  Мониторинг телеметрии, симуляция Dry-Run без риска мутаций и аудит дрейфа конфигурации.
                </p>
                <ul className="space-y-1 text-[11px] text-slate-300">
                  <li className="flex items-center gap-1.5">
                    <span className="w-1 h-1 rounded-full bg-emerald-400" />
                    Топологический граф &amp; телеметрия
                  </li>
                  <li className="flex items-center gap-1.5">
                    <span className="w-1 h-1 rounded-full bg-emerald-400" />
                    Dry-Run diff расчёт в реальном времени
                  </li>
                </ul>
              </div>
              <div className="mt-3 pt-2 border-t border-white/[0.06] text-[10px] font-mono text-emerald-400/90">
                dev-operator-token
              </div>
            </div>

            {/* Viewer Card */}
            <div
              onClick={() => setSelectedRole('viewer')}
              className={`relative flex flex-col justify-between p-4 rounded-xl border transition-all cursor-pointer ${
                selectedRole === 'viewer'
                  ? 'border-zinc-400/60 bg-white/[0.08] shadow-lg shadow-zinc-950/20'
                  : 'border-white/[0.08] bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]'
              }`}
            >
              {selectedRole === 'viewer' && (
                <div className="absolute top-3 right-3 text-zinc-300">
                  <CheckCircle2 className="w-4 h-4" />
                </div>
              )}
              <div>
                <div className="w-9 h-9 rounded-lg bg-white/[0.06] border border-white/[0.1] flex items-center justify-center text-zinc-300 mb-2.5">
                  <Eye className="w-4 h-4" />
                </div>
                <h4 className="text-base font-semibold text-white mb-1">Наблюдатель (Viewer)</h4>
                <p className="text-xs text-slate-400 mb-3 leading-relaxed">
                  Безопасный аудит в режиме Read-Only. Просмотр топологии, дашбордов и отчетов стейкхолдеров.
                </p>
                <ul className="space-y-1 text-[11px] text-slate-300">
                  <li className="flex items-center gap-1.5">
                    <span className="w-1 h-1 rounded-full bg-zinc-400" />
                    Только чтение, мутации заблокированы
                  </li>
                  <li className="flex items-center gap-1.5">
                    <span className="w-1 h-1 rounded-full bg-zinc-400" />
                    Аудит соответствия политикам Git SoT
                  </li>
                </ul>
              </div>
              <div className="mt-3 pt-2 border-t border-white/[0.06] text-[10px] font-mono text-zinc-400/90">
                dev-viewer-token
              </div>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-5 sm:p-6 bg-white/[0.02] border-t border-white/[0.08] flex items-center justify-between shrink-0">
          <p className="text-xs text-slate-400">
            Роль можно переключить в любой момент в шапке дашборда.
          </p>
          <button
            onClick={handleConfirm}
            className="flex items-center gap-2 px-6 py-2 rounded-xl text-xs font-semibold text-black bg-gradient-to-r from-cyan-400 to-indigo-400 hover:from-cyan-300 hover:to-indigo-300 shadow-lg shadow-cyan-500/20 transition-all cursor-pointer"
          >
            <span>Войти как {selectedRole.toUpperCase()}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
