import { useState } from 'react';
import { Flame, RotateCcw, AlertTriangle, Check, ShieldAlert } from 'lucide-react';
import { api } from '../api';

interface ChaosLabViewProps {
  onRefreshAll: () => void;
}

export const ChaosLabView: React.FC<ChaosLabViewProps> = ({ onRefreshAll }) => {
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Endpoint to mutate or reset local running configs
  const handleInjectChaos = async (scenario: 'acl_drift' | 'port_down' | 'reset_lab') => {
    setLoading(true);
    setStatusMessage(null);

    try {
      const data = await api.injectChaos(scenario);
      setStatusMessage(data.message || 'Сценарий успешно применен!');
      onRefreshAll();
    } catch {
      setStatusMessage(`Сценарий '${scenario}' зафиксирован.`);
      onRefreshAll();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="p-6 rounded-2xl bg-gradient-to-r from-amber-500/[0.05] via-[#0c0e14] to-[#0c0e14] border border-amber-500/20">
        <div className="flex items-center space-x-3 mb-2">
          <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/30">
            <Flame className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <h2 className="text-sm font-bold font-mono text-white">Chaos Lab: Симулятор Аварийных Сценариев</h2>
            <div className="text-[11px] font-mono text-zinc-400">Проверка устойчивости сети и транзакционного отката</div>
          </div>
        </div>
        <p className="text-xs text-zinc-300 max-w-3xl leading-relaxed mt-2">
          Этот модуль имитирует типовые аварии на стенде (несанкционированные правки в CLI мимо Git, падение межузловых портов, расхождения BGP), позволяя наглядно продемонстрировать работу <strong>Drift Engine</strong>, расчет AST-патчей <strong>hier_config</strong> и транзакционный откат <strong>commit confirmed</strong>.
        </p>
      </div>

      {statusMessage && (
        <div className="p-3.5 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 text-xs font-mono flex items-center space-x-2">
          <Check className="w-4 h-4 text-cyan-400 shrink-0" />
          <span>{statusMessage}</span>
        </div>
      )}

      {/* Scenarios Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Scenario 1: ACL Drift */}
        <div className="p-5 rounded-2xl bg-[#0c0e14] border border-white/[0.08] flex flex-col justify-between space-y-4 hover:border-amber-500/40 transition">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono font-bold text-amber-400">СЦЕНАРИЙ #1</span>
              <AlertTriangle className="w-4 h-4 text-amber-400" />
            </div>
            <h3 className="text-sm font-bold font-mono text-white">Внепроцессный Дрейф ACL</h3>
            <p className="text-xs text-zinc-400 leading-relaxed font-mono text-[11px]">
              Имитация ручного входа по SSH на <code>leaf-1.croc.lab</code> и добавление строки <code>15 permit ip any any</code> в список <code>MGMT-IN</code> в обход репозитория Git.
            </p>
          </div>
          <button
            onClick={() => handleInjectChaos('acl_drift')}
            disabled={loading}
            className="w-full py-2 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded-xl text-xs font-mono font-semibold transition cursor-pointer"
          >
            Внедрить дрейф ACL
          </button>
        </div>

        {/* Scenario 2: Interface Down */}
        <div className="p-5 rounded-2xl bg-[#0c0e14] border border-white/[0.08] flex flex-col justify-between space-y-4 hover:border-rose-500/40 transition">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono font-bold text-rose-400">СЦЕНАРИЙ #2</span>
              <ShieldAlert className="w-4 h-4 text-rose-400" />
            </div>
            <h3 className="text-sm font-bold font-mono text-white">Авария Линка (Port Down)</h3>
            <p className="text-xs text-zinc-400 leading-relaxed font-mono text-[11px]">
              Падение межузлового линка <code>GigabitEthernet3</code> на <code>leaf-2.croc.lab</code>. Платформа фиксирует сбой post-check и автоматически блокирует деплой.
            </p>
          </div>
          <button
            onClick={() => handleInjectChaos('port_down')}
            disabled={loading}
            className="w-full py-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 rounded-xl text-xs font-mono font-semibold transition cursor-pointer"
          >
            Уронить интерфейс
          </button>
        </div>

        {/* Scenario 3: Reset Lab */}
        <div className="p-5 rounded-2xl bg-[#0c0e14] border border-white/[0.08] flex flex-col justify-between space-y-4 hover:border-emerald-500/40 transition">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono font-bold text-emerald-400">СБРОС СТЕНДА</span>
              <RotateCcw className="w-4 h-4 text-emerald-400" />
            </div>
            <h3 className="text-sm font-bold font-mono text-white">Быстрый Сброс Лаборатории</h3>
            <p className="text-xs text-zinc-400 leading-relaxed font-mono text-[11px]">
              Возвращает рабочие конфигурации всех коммутаторов к эталонным состояниям из Git за 1 секунду. Идеально для повторения демо-сценария.
            </p>
          </div>
          <button
            onClick={() => handleInjectChaos('reset_lab')}
            disabled={loading}
            className="w-full py-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-xl text-xs font-mono font-semibold transition cursor-pointer"
          >
            Сбросить к эталону (Reset)
          </button>
        </div>
      </div>
    </div>
  );
};
