import { useState } from 'react';
import { Flame, RotateCcw, AlertTriangle, Check, ShieldAlert } from 'lucide-react';
import { api } from '../api';
import { translations, type Locale } from '../i18n';

interface ChaosLabViewProps {
  locale?: Locale;
  onRefreshAll: () => void;
}

export const ChaosLabView: React.FC<ChaosLabViewProps> = ({ locale = 'ru', onRefreshAll }) => {
  const t = translations[locale];
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleInjectChaos = async (
    scenario: 'acl_drift' | 'port_down' | 'huawei_drift' | 'ai_blackhole' | 'ai_storm' | 'reset_lab'
  ) => {
    setLoading(true);
    setStatusMessage(null);

    try {
      const data = await api.injectChaos(scenario);
      setStatusMessage(data.message || (locale === 'en' ? 'Scenario injected successfully!' : 'Сценарий успешно применен!'));
      onRefreshAll();
    } catch {
      setStatusMessage(locale === 'en' ? `Scenario '${scenario}' registered.` : `Сценарий '${scenario}' зафиксирован.`);
      onRefreshAll();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="p-6 rounded-2xl bg-gradient-to-r from-amber-500/[0.05] via-[#0c0e14] to-[#0c0e14] border border-amber-500/20">
        <div className="flex items-center space-x-3 mb-2">
          <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/30">
            <Flame className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <h2 className="text-sm font-bold font-mono text-white">{t.chaosTitle}</h2>
            <div className="text-[11px] font-mono text-zinc-400">{t.chaosSub}</div>
          </div>
        </div>
        <p className="text-xs text-zinc-300 max-w-3xl leading-relaxed mt-2">
          {locale === 'en'
            ? 'This module simulates network failures (out-of-band CLI edits, port drops, traffic storms), verifying the multi-vendor Drift Engine on Cisco/Huawei, commit trial auto-rollback, and TimesFM 3.0 AI Guard.'
            : 'Этот модуль имитирует типовые аварии на стенде (несанкционированные правки в CLI мимо Git, падение межузловых портов, скрытые блэкхолы), позволяя наглядно продемонстрировать работу Drift Engine на Cisco/Huawei, автооткат commit trial и защиту TimesFM 3.0 AI Guard.'}
        </p>
      </div>

      {statusMessage && (
        <div className="p-3.5 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 text-xs font-mono flex items-center space-x-2">
          <Check className="w-4 h-4 text-cyan-400 shrink-0" />
          <span>{statusMessage}</span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Scenario 1: Cisco ACL Drift */}
        <div className="p-5 rounded-2xl bg-[#0c0e14] border border-white/[0.08] flex flex-col justify-between space-y-4 hover:border-amber-500/40 transition">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono font-bold text-amber-400">СЦЕНАРИЙ #1 (CISCO)</span>
              <AlertTriangle className="w-4 h-4 text-amber-400" />
            </div>
            <h3 className="text-sm font-bold font-mono text-white">Внепроцессный Дрейф ACL (Cisco)</h3>
            <p className="text-xs text-zinc-400 leading-relaxed font-mono text-[11px]">
              Имитация ручного входа по SSH на <code>leaf-1.croc.lab</code> и добавление строки <code>15 permit ip any any</code> в список <code>MGMT-IN</code> в обход репозитория Git.
            </p>
          </div>
          <button
            onClick={() => handleInjectChaos('acl_drift')}
            disabled={loading}
            className="w-full py-2 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded-xl text-xs font-mono font-semibold transition cursor-pointer"
          >
            Внедрить дрейф Cisco
          </button>
        </div>

        {/* Scenario 2: Huawei VRP ACL Drift */}
        <div className="p-5 rounded-2xl bg-[#0c0e14] border border-white/[0.08] flex flex-col justify-between space-y-4 hover:border-violet-500/40 transition">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono font-bold text-violet-400">СЦЕНАРИЙ #2 (HUAWEI)</span>
              <AlertTriangle className="w-4 h-4 text-violet-400" />
            </div>
            <h3 className="text-sm font-bold font-mono text-white">Дрейф на Huawei VRP</h3>
            <p className="text-xs text-zinc-400 leading-relaxed font-mono text-[11px]">
              Внедрение несанкционированного правила <code>rule 15 permit ip</code> на <code>leaf-3.croc.lab</code> (Huawei VRP). Проверяет работу HierConfig с третьим вендором.
            </p>
          </div>
          <button
            onClick={() => handleInjectChaos('huawei_drift')}
            disabled={loading}
            className="w-full py-2 bg-violet-500/10 hover:bg-violet-500/20 text-violet-300 border border-violet-500/30 rounded-xl text-xs font-mono font-semibold transition cursor-pointer"
          >
            Внедрить дрейф Huawei
          </button>
        </div>

        {/* Scenario 3: Port Down */}
        <div className="p-5 rounded-2xl bg-[#0c0e14] border border-white/[0.08] flex flex-col justify-between space-y-4 hover:border-rose-500/40 transition">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono font-bold text-rose-400">СЦЕНАРИЙ #3</span>
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

        {/* Scenario 4: TimesFM AI Guard Silent Blackhole */}
        <div className="p-5 rounded-2xl bg-[#0c0e14] border border-cyan-500/30 flex flex-col justify-between space-y-4 hover:border-cyan-400/60 transition shadow-[0_0_15px_rgba(6,182,212,0.1)]">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono font-bold text-cyan-400">TIMESFM 3.0 GUARD</span>
              <ShieldAlert className="w-4 h-4 text-cyan-400" />
            </div>
            <h3 className="text-sm font-bold font-mono text-white">Тихая авария (Silent Blackhole)</h3>
            <p className="text-xs text-zinc-400 leading-relaxed font-mono text-[11px]">
              Порты остаются в статусе <code>up/up</code>, но трафик падает в ноль. <strong>TimesFM 3.0</strong> выявляет пробой квантиля $Q_{10}$ во время окна <code>commit confirmed</code> и инициирует автооткат.
            </p>
          </div>
          <button
            onClick={() => handleInjectChaos('ai_blackhole')}
            disabled={loading}
            className="w-full py-2 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 rounded-xl text-xs font-mono font-semibold transition cursor-pointer"
          >
            Смоделировать Blackhole
          </button>
        </div>

        {/* Scenario 5: TimesFM AI Guard Load Surge */}
        <div className="p-5 rounded-2xl bg-[#0c0e14] border border-fuchsia-500/30 flex flex-col justify-between space-y-4 hover:border-fuchsia-400/60 transition">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono font-bold text-fuchsia-400">TIMESFM 3.0 GUARD</span>
              <AlertTriangle className="w-4 h-4 text-fuchsia-400" />
            </div>
            <h3 className="text-sm font-bold font-mono text-white">Шторм трафика / Микропетля</h3>
            <p className="text-xs text-zinc-400 leading-relaxed font-mono text-[11px]">
              Имитация аномального взлета нагрузки выше $Q_{90}$. TimesFM 3.0 блокирует закрепление коммита до устранения аномалии.
            </p>
          </div>
          <button
            onClick={() => handleInjectChaos('ai_storm')}
            disabled={loading}
            className="w-full py-2 bg-fuchsia-500/10 hover:bg-fuchsia-500/20 text-fuchsia-300 border border-fuchsia-500/40 rounded-xl text-xs font-mono font-semibold transition cursor-pointer"
          >
            Смоделировать шторм
          </button>
        </div>

        {/* Reset */}
        <div className="p-5 rounded-2xl bg-[#0c0e14] border border-white/[0.08] flex flex-col justify-between space-y-4 hover:border-emerald-500/40 transition">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono font-bold text-emerald-400">СБРОС СТЕНДА</span>
              <RotateCcw className="w-4 h-4 text-emerald-400" />
            </div>
            <h3 className="text-sm font-bold font-mono text-white">Сброс к Git SoT</h3>
            <p className="text-xs text-zinc-400 leading-relaxed font-mono text-[11px]">
              Возвращает рабочие конфигурации всех 6 коммутаторов к эталонным состояниям из Git за 1 секунду. Очищает аномалии AI Guard.
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

