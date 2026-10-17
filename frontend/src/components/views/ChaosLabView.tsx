import { useState } from 'react';
import { Flame, RotateCcw, AlertTriangle, Check, ShieldAlert } from 'lucide-react';
import { api } from '../../api';
import { translations, type Locale } from '../../i18n';

interface ChaosLabViewProps {
  locale?: Locale;
  onRefreshAll: () => void;
}

export const ChaosLabView: React.FC<ChaosLabViewProps> = ({ locale = 'ru', onRefreshAll }) => {
  const t = translations[locale];
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleInjectChaos = async (
    scenario: 'acl_drift' | 'port_down' | 'huawei_drift' | 'ai_blackhole' | 'ai_storm' | 'reset_lab'
  ) => {
    setLoading(true);
    setStatusMessage(null);
    setErrorMessage(null);

    try {
      const data = await api.injectChaos(scenario);
      setStatusMessage(data.message || (locale === 'en' ? 'Scenario injected successfully!' : 'Сценарий успешно применен!'));
      onRefreshAll();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg || (locale === 'en' ? `Failed to execute '${scenario}'.` : `Ошибка выполнения сценария '${scenario}'.`));
      onRefreshAll();
    } finally {
      setLoading(false);
    }
  };

  const cardClass =
    'p-4 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] hover:border-[var(--border-hover)] flex flex-col justify-between gap-3 transition-colors';
  const actionBtn =
    'w-full py-2 px-3 bg-[var(--bg-elevated)] hover:bg-[var(--text-primary)] text-[var(--text-primary)] hover:text-[var(--bg-main)] border border-[var(--border-subtle)] rounded-md text-xs font-medium transition-colors cursor-pointer disabled:opacity-50';

  return (
    <div className="w-full max-w-[2560px] mx-auto space-y-4">
      {/* Header Banner */}
      <div className="p-4 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-md bg-[var(--bg-elevated)] border border-[var(--border-subtle)]">
            <Flame className="w-4 h-4 text-amber-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-[var(--text-primary)] tracking-tight">{t.chaosTitle}</h2>
            <div className="text-[11px] font-mono text-[var(--text-muted)]">{t.chaosSub}</div>
          </div>
        </div>
      </div>

      {statusMessage && (
        <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-emerald-600 dark:text-emerald-300 text-xs font-mono flex items-center gap-2">
          <Check className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{statusMessage}</span>
        </div>
      )}

      {errorMessage && (
        <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/25 text-rose-600 dark:text-rose-300 text-xs font-mono flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6 gap-3">
        {/* Scenario 1: Cisco ACL Drift */}
        <div className={cardClass}>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-1">
              <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-secondary)] truncate">
                СЦЕНАРИЙ #1 · CISCO IOS-XE
              </span>
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            </div>
            <h3 className="text-sm font-semibold text-[var(--text-primary)] tracking-tight">
              Внепроцессный Дрейф ACL (Cisco)
            </h3>
          </div>
          <button
            onClick={() => handleInjectChaos('acl_drift')}
            disabled={loading}
            className={actionBtn}
          >
            Внедрить дрейф Cisco
          </button>
        </div>

        {/* Scenario 2: Huawei VRP / Multi-Vendor ACL Drift */}
        <div className={cardClass}>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-1">
              <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-secondary)] truncate">
                СЦЕНАРИЙ #2 · MULTI-VENDOR
              </span>
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            </div>
            <h3 className="text-sm font-semibold text-[var(--text-primary)] tracking-tight">
              Дрейф на Huawei VRP
            </h3>
          </div>
          <button
            onClick={() => handleInjectChaos('huawei_drift')}
            disabled={loading}
            className={actionBtn}
          >
            Внедрить мультивендорный дрейф
          </button>
        </div>

        {/* Scenario 3: Port Down */}
        <div className={cardClass}>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-1">
              <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-secondary)] truncate">
                СЦЕНАРИЙ #3 · ФИЗИКА
              </span>
              <ShieldAlert className="w-3.5 h-3.5 text-rose-400 shrink-0" />
            </div>
            <h3 className="text-sm font-semibold text-[var(--text-primary)] tracking-tight">
              Авария Линка (Port Down)
            </h3>
          </div>
          <button
            onClick={() => handleInjectChaos('port_down')}
            disabled={loading}
            className={actionBtn}
          >
            Уронить интерфейс
          </button>
        </div>

        {/* Scenario 4: Silent Blackhole */}
        <div className={cardClass}>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-1">
              <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-secondary)] truncate">
                TELEMETRY · Q10 GUARD
              </span>
              <ShieldAlert className="w-3.5 h-3.5 text-[var(--text-secondary)] shrink-0" />
            </div>
            <h3 className="text-sm font-semibold text-[var(--text-primary)] tracking-tight">
              Тихая авария (Silent Blackhole)
            </h3>
          </div>
          <button
            onClick={() => handleInjectChaos('ai_blackhole')}
            disabled={loading}
            className={actionBtn}
          >
            Смоделировать Blackhole
          </button>
        </div>

        {/* Scenario 5: Load Surge */}
        <div className={cardClass}>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-1">
              <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-secondary)] truncate">
                TELEMETRY · Q90 GUARD
              </span>
              <AlertTriangle className="w-3.5 h-3.5 text-[var(--text-secondary)] shrink-0" />
            </div>
            <h3 className="text-sm font-semibold text-[var(--text-primary)] tracking-tight">
              Шторм трафика / Микропетля
            </h3>
          </div>
          <button
            onClick={() => handleInjectChaos('ai_storm')}
            disabled={loading}
            className={actionBtn}
          >
            Смоделировать шторм
          </button>
        </div>

        {/* Reset */}
        <div className={cardClass}>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-1">
              <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 truncate">
                ЭТАЛОН GIT SOT
              </span>
              <RotateCcw className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            </div>
            <h3 className="text-sm font-semibold text-[var(--text-primary)] tracking-tight">
              Сброс к Git SoT
            </h3>
          </div>
          <button
            onClick={() => handleInjectChaos('reset_lab')}
            disabled={loading}
            className="w-full py-2 px-3 bg-[var(--text-primary)] text-[var(--bg-main)] hover:opacity-90 rounded-md text-xs font-semibold transition-opacity cursor-pointer disabled:opacity-50"
          >
            Сбросить к эталону (Reset)
          </button>
        </div>
      </div>
    </div>
  );
};
