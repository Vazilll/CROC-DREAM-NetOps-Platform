import React, { useState } from 'react';
import { Shield, Activity, ArrowRight, Server, CheckCircle2, Cpu } from 'lucide-react';
import { api } from '../api';

interface WelcomeModalProps {
  isOpen: boolean;
  onClose: (role: 'operator' | 'admin') => void;
}

export const WelcomeModal: React.FC<WelcomeModalProps> = ({ isOpen, onClose }) => {
  const [selectedRole, setSelectedRole] = useState<'operator' | 'admin'>('operator');

  if (!isOpen) return null;

  const handleSelectRole = (role: 'operator' | 'admin') => {
    setSelectedRole(role);
  };

  const handleConfirm = () => {
    api.setRole(selectedRole);
    localStorage.setItem('netops_onboarding_done', 'true');
    onClose(selectedRole);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
      <div className="relative w-full max-w-3xl overflow-hidden rounded-2xl border border-white/10 bg-[#0d0f14] shadow-2xl shadow-cyan-950/20 text-slate-200">
        {/* Glow Header */}
        <div className="relative p-6 sm:p-8 border-b border-white/[0.08] bg-gradient-to-b from-white/[0.03] to-transparent">
          <div className="flex items-center gap-3 mb-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono font-medium tracking-wide uppercase bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Live Bare Metal Clab Active
            </span>
            <span className="text-xs font-mono text-slate-400">CLOS Fabric 5.228.243.54</span>
          </div>

          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-white mb-2">
            Добро пожаловать в CROC DREAM NetOps
          </h2>
          <p className="text-sm sm:text-base text-slate-400 max-w-xl leading-relaxed">
            Автономная платформа управления гетерогенной сетевой инфраструктурой. Подключено 6 реальных Bare Metal серверов: 2 Arista cEOS Spines, 2 Cisco 8000V Leafs и 2 Huawei CE12800 Leafs.
          </p>

          {/* Quick Hardware Badges */}
          <div className="mt-4 flex flex-wrap gap-2 pt-2 border-t border-white/[0.06]">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/[0.04] border border-white/[0.08] text-xs font-mono text-slate-300">
              <Cpu className="w-3.5 h-3.5 text-cyan-400" />
              Arista cEOS (Spine 1 & 2)
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/[0.04] border border-white/[0.08] text-xs font-mono text-slate-300">
              <Server className="w-3.5 h-3.5 text-blue-400" />
              Cisco 8000V (Leaf 1 & 2)
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/[0.04] border border-white/[0.08] text-xs font-mono text-slate-300">
              <Server className="w-3.5 h-3.5 text-red-400" />
              Huawei VRP (Leaf 3 & 4)
            </div>
          </div>
        </div>

        {/* Persona Choice Section */}
        <div className="p-6 sm:p-8 space-y-6">
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400 mb-3">
              Выберите вашу роль для текущей сессии:
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Operator Card */}
              <div
                onClick={() => handleSelectRole('operator')}
                className={`relative flex flex-col justify-between p-5 rounded-xl border transition-all cursor-pointer ${
                  selectedRole === 'operator'
                    ? 'border-emerald-500/50 bg-emerald-500/[0.06] shadow-lg shadow-emerald-950/20'
                    : 'border-white/[0.08] bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]'
                }`}
              >
                {selectedRole === 'operator' && (
                  <div className="absolute top-3 right-3 text-emerald-400">
                    <CheckCircle2 className="w-5 h-5" />
                  </div>
                )}
                <div>
                  <div className="w-10 h-10 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 mb-3">
                    <Activity className="w-5 h-5" />
                  </div>
                  <h4 className="text-lg font-semibold text-white mb-1">Оператор (NOC)</h4>
                  <p className="text-xs text-slate-400 mb-4 leading-relaxed">
                    Мониторинг телеметрии, симуляция Dry-Run без риска и аудит дрейфа конфигурации.
                  </p>
                  <ul className="space-y-1.5 text-xs text-slate-300">
                    <li className="flex items-center gap-2">
                      <span className="w-1 h-1 rounded-full bg-emerald-400" />
                      Интерактивная карта CLOS топологии
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="w-1 h-1 rounded-full bg-emerald-400" />
                      Dry-Run diff расчёт в реальном времени
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="w-1 h-1 rounded-full bg-emerald-400" />
                      Детекция дрейфа от Git эталона
                    </li>
                  </ul>
                </div>
                <div className="mt-5 pt-3 border-t border-white/[0.06] text-[11px] font-mono text-emerald-400/80">
                  Режим безопасного просмотра
                </div>
              </div>

              {/* Admin Card */}
              <div
                onClick={() => handleSelectRole('admin')}
                className={`relative flex flex-col justify-between p-5 rounded-xl border transition-all cursor-pointer ${
                  selectedRole === 'admin'
                    ? 'border-amber-500/50 bg-amber-500/[0.06] shadow-lg shadow-amber-950/20'
                    : 'border-white/[0.08] bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]'
                }`}
              >
                {selectedRole === 'admin' && (
                  <div className="absolute top-3 right-3 text-amber-400">
                    <CheckCircle2 className="w-5 h-5" />
                  </div>
                )}
                <div>
                  <div className="w-10 h-10 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 mb-3">
                    <Shield className="w-5 h-5" />
                  </div>
                  <h4 className="text-lg font-semibold text-white mb-1">Администратор / Lead</h4>
                  <p className="text-xs text-slate-400 mb-4 leading-relaxed">
                    Полный контроль: аварийный пульт прямого доступа, 2-уровневый сброс и деплой.
                  </p>
                  <ul className="space-y-1.5 text-xs text-slate-300">
                    <li className="flex items-center gap-2">
                      <span className="w-1 h-1 rounded-full bg-amber-400" />
                      <strong className="text-amber-300">Аварийный пульт</strong>: Web CLI & Hot-Patch
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="w-1 h-1 rounded-full bg-amber-400" />
                      <strong className="text-amber-300">2-Tier Reset</strong>: Мягкий (5s) & Жесткий сброс
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="w-1 h-1 rounded-full bg-amber-400" />
                      Деплой с Commit Confirmed таймером
                    </li>
                  </ul>
                </div>
                <div className="mt-5 pt-3 border-t border-white/[0.06] text-[11px] font-mono text-amber-400/80">
                  Полный административный доступ
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-6 bg-white/[0.02] border-t border-white/[0.08] flex items-center justify-between">
          <p className="text-xs text-slate-400">
            Роль можно переключить в любой момент в шапке дашборда.
          </p>
          <button
            onClick={handleConfirm}
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl font-medium text-sm text-black bg-gradient-to-r from-emerald-400 to-cyan-400 hover:from-emerald-300 hover:to-cyan-300 shadow-lg shadow-cyan-500/20 transition-all cursor-pointer font-semibold"
          >
            Войти как {selectedRole === 'admin' ? 'Администратор' : 'Оператор'}
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
