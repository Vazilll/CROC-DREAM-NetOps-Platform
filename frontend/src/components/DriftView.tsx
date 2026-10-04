import { useEffect, useState } from 'react';
import {
  ShieldCheck,
  ShieldAlert,
  RotateCw,
  Server,
  Wrench,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Terminal,
} from 'lucide-react';
import { api } from '../api';
import type { DriftReportItem } from '../api';

interface DriftViewProps {
  onRemediate: (deviceId: number) => void;
  onScanDrift: () => void;
}

export const DriftView: React.FC<DriftViewProps> = ({ onRemediate, onScanDrift }) => {
  const [report, setReport] = useState<DriftReportItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchReport = () => {
    setLoading(true);
    api
      .getDriftReport()
      .then((data) => {
        setReport(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to load drift report', err);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchReport();
  }, []);

  const inSyncCount = report.filter((r) => r.status === 'IN_SYNC').length;
  const driftCount = report.filter((r) => r.status === 'DRIFT_DETECTED').length;
  const complianceRate =
    report.length > 0 ? Math.round((inSyncCount / report.length) * 100) : 100;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-5 rounded-2xl bg-[#0c0e14] border border-white/[0.08] flex items-center justify-between">
          <div>
            <span className="text-xs font-mono text-zinc-400">Комплаенс Фабрики</span>
            <div className="mt-2 text-3xl font-bold font-mono text-white tracking-tight">{complianceRate}%</div>
            <p className="mt-1 text-[11px] font-mono text-zinc-500">
              {inSyncCount} из {report.length} узлов в эталоне
            </p>
          </div>
          <div
            className={`p-3 rounded-xl border ${
              complianceRate === 100
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25'
                : 'bg-amber-500/10 text-amber-400 border-amber-500/25'
            }`}
          >
            {complianceRate === 100 ? (
              <ShieldCheck className="w-6 h-6" />
            ) : (
              <ShieldAlert className="w-6 h-6" />
            )}
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-[#0c0e14] border border-white/[0.08] flex items-center justify-between">
          <div>
            <span className="text-xs font-mono text-amber-400">Дрейф Конфигурации</span>
            <div className="mt-2 text-3xl font-bold font-mono text-amber-300 tracking-tight">{driftCount}</div>
            <p className="mt-1 text-[11px] font-mono text-amber-500/80">Внепроцессные правки</p>
          </div>
          <div className="p-3 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/25">
            <AlertTriangle className="w-6 h-6" />
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-[#0c0e14] border border-white/[0.08] flex flex-col justify-between">
          <div>
            <span className="text-xs font-mono text-zinc-400">Фоновый Скан (Celery Beat)</span>
            <p className="mt-1 text-xs text-zinc-300 leading-relaxed font-mono text-[11px]">
              Периодический опрос running-config нод для снуления расхождений.
            </p>
          </div>
          <div className="flex items-center space-x-2 mt-4">
            <button
              onClick={onScanDrift}
              className="flex-1 px-3 py-2 bg-cyan-500 hover:bg-cyan-400 text-zinc-950 rounded-xl text-xs font-mono font-semibold flex items-center justify-center space-x-1.5 transition shadow-lg shadow-cyan-500/20 cursor-pointer"
            >
              <RotateCw className="w-3.5 h-3.5" />
              <span>Внеочередной скан</span>
            </button>
            <button
              onClick={fetchReport}
              className="p-2 bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white rounded-xl border border-white/[0.08] transition cursor-pointer"
              title="Обновить отчет"
            >
              <RotateCw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="text-xs font-bold font-mono uppercase tracking-wider text-white flex items-center space-x-2">
          <Terminal className="w-4 h-4 text-cyan-400" />
          <span>Детализация Расхождений по Оборудованию</span>
        </h3>

        {report.map((item) => (
          <div
            key={item.device_id}
            className={`p-5 rounded-2xl bg-[#0c0e14] border transition ${
              item.status === 'DRIFT_DETECTED'
                ? 'border-amber-500/40 bg-amber-500/[0.02]'
                : 'border-white/[0.08]'
            }`}
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-white/[0.06]">
              <div className="flex items-center space-x-3">
                <div className="p-2 rounded-xl bg-zinc-900 border border-white/[0.06] text-zinc-300">
                  <Server className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white font-mono">{item.hostname}</h4>
                  <div className="flex items-center space-x-2 text-[11px] font-mono text-zinc-400">
                    <Clock className="w-3 h-3 text-zinc-500" />
                    <span>Проверено: {new Date(item.checked_at).toLocaleTimeString()}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center space-x-3">
                <span
                  className={`px-2.5 py-0.5 rounded-full text-[11px] font-mono font-semibold ${
                    item.status === 'IN_SYNC'
                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                      : item.status === 'DRIFT_DETECTED'
                      ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                      : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                  }`}
                >
                  {item.status}
                </span>

                {item.status === 'DRIFT_DETECTED' && (
                  <button
                    onClick={() => onRemediate(item.device_id)}
                    className="px-3.5 py-1.5 bg-amber-500 hover:bg-amber-400 text-zinc-950 rounded-xl text-xs font-mono font-bold flex items-center space-x-1.5 transition shadow-lg shadow-amber-500/20 cursor-pointer"
                  >
                    <Wrench className="w-3.5 h-3.5" />
                    <span>Устранить дрейф (Remediate)</span>
                  </button>
                )}
              </div>
            </div>

            {item.status === 'DRIFT_DETECTED' ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-mono pt-3">
                <div className="p-3.5 rounded-xl bg-zinc-950 border border-rose-500/20 space-y-2">
                  <span className="text-[11px] font-bold text-rose-400 uppercase tracking-wider block">
                    Несанкционированные строки (+) ({item.unauthorized_lines.length})
                  </span>
                  <div className="space-y-1">
                    {item.unauthorized_lines.map((line, i) => (
                      <div key={i} className="text-rose-300 bg-rose-950/40 px-2 py-1 rounded">
                        + {line}
                      </div>
                    ))}
                    {item.unauthorized_lines.length === 0 && (
                      <span className="text-zinc-500 italic">Нет лишних строк</span>
                    )}
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-zinc-950 border border-amber-500/20 space-y-2">
                  <span className="text-[11px] font-bold text-amber-400 uppercase tracking-wider block">
                    Отсутствующие строки из эталона (-) ({item.missing_lines.length})
                  </span>
                  <div className="space-y-1">
                    {item.missing_lines.map((line, i) => (
                      <div key={i} className="text-amber-300 bg-amber-950/40 px-2 py-1 rounded">
                        - {line}
                      </div>
                    ))}
                    {item.missing_lines.length === 0 && (
                      <span className="text-zinc-500 italic">Нет пропущенных строк</span>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-xs font-mono text-emerald-400/90 flex items-center space-x-2 pt-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>Рабочая конфигурация на 100% соответствует эталону в Git.</span>
              </div>
            )}
          </div>
        ))}

        {report.length === 0 && (
          <div className="p-16 rounded-2xl bg-[#0c0e14] border border-white/[0.08] text-center text-zinc-500 space-y-2 font-mono text-xs">
            <ShieldCheck className="w-8 h-8 mx-auto opacity-30 text-cyan-400" />
            <p>
              {loading ? 'Загрузка отчета о дрейфе...' : 'Отчет о дрейфе пуст. Запустите сканирование.'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
