import { useState, useEffect } from 'react';
import { DiffEditor, Editor } from '@monaco-editor/react';
import {
  Terminal,
  Play,
  Bot,
  Server,
  Code2,
  Undo2,
  FileCheck,
} from 'lucide-react';
import { api } from '../api';
import type { JobDiff, DeviceDiff, JobSummary } from '../api';

interface DiffViewerProps {
  jobs: JobSummary[];
  selectedJobId: string | null;
  onSelectJob: (jobId: string) => void;
  onDeploy: (jobId: string) => void;
}

export const DiffViewer: React.FC<DiffViewerProps> = ({
  jobs,
  selectedJobId,
  onSelectJob,
  onDeploy,
}) => {
  const [diffData, setDiffData] = useState<JobDiff | null>(null);
  const [selectedDeviceIndex, setSelectedDeviceIndex] = useState(0);
  const [activeViewMode, setActiveViewMode] = useState<'diff' | 'remediation' | 'rollback'>('diff');
  const [loading, setLoading] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState<{
    summary: string;
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    keyPoints: string[];
    recommendations?: string[];
    provider?: string;
  } | null>(null);
  const [analyzingAi, setAnalyzingAi] = useState(false);

  // Filter jobs that have diffs (usually DRY_RUN or DEPLOY)
  const diffJobs = jobs.filter((j) => j.type === 'DRY_RUN' || j.type === 'DEPLOY');

  useEffect(() => {
    if (!selectedJobId) {
      if (diffJobs.length > 0) {
        onSelectJob(diffJobs[0].id);
      }
      return;
    }

    setLoading(true);
    setAiAnalysis(null);
    api
      .getJobDiff(selectedJobId)
      .then((data) => {
        setDiffData(data);
        setSelectedDeviceIndex(0);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to load diff', err);
        setLoading(false);
      });
  }, [selectedJobId]);

  const activeDeviceDiff: DeviceDiff | undefined = diffData?.devices[selectedDeviceIndex];

  // AI Diff Explainer: invokes backend LLM service (MiMo-V2.6-Flash) with graceful fallback
  const handleAnalyzeWithAI = async () => {
    if (!activeDeviceDiff || !selectedJobId) return;
    setAnalyzingAi(true);

    try {
      const res = await api.explainDiff(selectedJobId.toString(), activeDeviceDiff.hostname);
      setAiAnalysis({
        summary: res.summary,
        riskLevel: res.risk_level,
        keyPoints: res.key_points,
        recommendations: res.recommendations,
        provider: res.provider,
      });
    } catch (err) {
      console.warn('Backend LLM explain endpoint failed, using client heuristic fallback', err);
      const remediation = activeDeviceDiff.remediation_patch || '';
      const hasBgp = remediation.includes('bgp') || remediation.includes('router-id');
      const hasInterface = remediation.includes('interface') || remediation.includes('mtu');
      const hasAcl = remediation.includes('access-list') || remediation.includes('permit');

      let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'LOW';
      const keyPoints: string[] = [];

      if (!remediation.trim()) {
        keyPoints.push('Конфигурация устройства полностью синхронизирована с Git SoT.');
        keyPoints.push('Патч пустой: нет необходимости применять изменения.');
      } else {
        if (hasBgp) {
          riskLevel = 'MEDIUM';
          keyPoints.push('Внесены изменения в конфигурацию процесса BGP или списки соседей.');
          keyPoints.push('Рекомендуется контроль таймеров сходимости BGP (до 60 секунд).');
        }
        if (hasInterface) {
          keyPoints.push('Модификация параметров физических интерфейсов или MTU.');
        }
        if (hasAcl) {
          riskLevel = 'HIGH';
          keyPoints.push('Правка списков контроля доступа (ACL) — риск блокировки трафика.');
        }
        keyPoints.push('Сгенерирован зеркальный патч отката (Rollback Patch) для экстренного восстановления.');
      }

      setAiAnalysis({
        summary: remediation.trim()
          ? `Анализ диффа для ${activeDeviceDiff.hostname}: обнаружены модификации сетевого намерения.`
          : `Устройство ${activeDeviceDiff.hostname} находится в актуальном эталонном состоянии.`,
        riskLevel,
        keyPoints,
        recommendations: ['Проверьте ping до шлюза после наката'],
        provider: 'Client-side Heuristic Fallback',
      });
    } finally {
      setAnalyzingAi(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Selector Toolbar */}
      <div className="p-4 rounded-2xl bg-[#0c0e14] border border-white/[0.08] flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center space-x-3 w-full md:w-auto">
          <div className="p-2 rounded-lg bg-zinc-900 border border-white/[0.08]">
            <Terminal className="w-4 h-4 text-cyan-400" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h2 className="text-sm font-bold font-mono text-white">Monaco Diff & LLM Guard</h2>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">
                hier_config AST
              </span>
            </div>
            <p className="text-xs text-zinc-400">
              Иерархическое сравнение (Running vs Intended) с расчетом remediate/rollback
            </p>
          </div>
        </div>

        {/* Job selector & Deploy CTA */}
        <div className="flex items-center space-x-3 w-full md:w-auto justify-end">
          <label className="text-xs font-mono text-zinc-400">Задача:</label>
          <select
            value={selectedJobId || ''}
            onChange={(e) => onSelectJob(e.target.value)}
            className="bg-zinc-950 border border-white/[0.08] rounded-xl px-3 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-cyan-500 font-mono cursor-pointer"
          >
            {diffJobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.type} [{j.status}] - {new Date(j.created_at).toLocaleTimeString()}
              </option>
            ))}
          </select>

          {selectedJobId && (
            <button
              onClick={() => onDeploy(selectedJobId)}
              className="px-4 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-zinc-950 rounded-xl text-xs font-semibold flex items-center space-x-1.5 transition shadow-lg shadow-emerald-500/20 cursor-pointer"
            >
              <Play className="w-3 h-3 fill-current" />
              <span>Деплой (Commit Confirmed)</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Diff Work Area */}
      {diffData && diffData.devices.length > 0 ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left: Device Tabs & AI Summary */}
          <div className="lg:col-span-3 space-y-4">
            {/* Device list for this job */}
            <div className="p-3 rounded-2xl bg-[#0c0e14] border border-white/[0.08] space-y-1.5">
              <span className="text-[11px] font-mono font-semibold uppercase tracking-wider text-zinc-400 px-2 py-1 block">
                Устройства ({diffData.devices.length})
              </span>
              {diffData.devices.map((dev, idx) => {
                const isSelected = idx === selectedDeviceIndex;
                const hasDiff = Boolean(dev.remediation_patch?.trim());
                return (
                  <button
                    key={dev.hostname}
                    onClick={() => {
                      setSelectedDeviceIndex(idx);
                      setAiAnalysis(null);
                    }}
                    className={`w-full text-left p-2.5 rounded-xl border text-xs font-mono flex items-center justify-between transition cursor-pointer ${
                      isSelected
                        ? 'bg-cyan-500/10 border-cyan-500/40 text-cyan-300 font-medium'
                        : 'bg-zinc-950/40 border-white/[0.04] text-zinc-400 hover:border-white/[0.1]'
                    }`}
                  >
                    <div className="flex items-center space-x-2 truncate">
                      <Server className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                      <span className="truncate">{dev.hostname}</span>
                    </div>
                    {hasDiff ? (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 shrink-0">
                        Δ Изменения
                      </span>
                    ) : (
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shrink-0">
                        In Sync
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* AI Assistant Card */}
            <div className="p-4 rounded-2xl bg-[#0c0e14] border border-white/[0.08] space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-1.5">
                  <Bot className="w-4 h-4 text-cyan-400" />
                  <span className="text-xs font-bold font-mono text-white">LLM Risk Assistant</span>
                </div>
                <button
                  onClick={handleAnalyzeWithAI}
                  disabled={analyzingAi}
                  className="px-2.5 py-1 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 text-[11px] font-mono border border-cyan-500/30 transition flex items-center space-x-1 cursor-pointer"
                >
                  <span>{analyzingAi ? 'Анализ...' : 'Оценить риски'}</span>
                </button>
              </div>

              {aiAnalysis ? (
                <div className="space-y-2.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-400 text-[11px] font-mono">Уровень риска:</span>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                        aiAnalysis.riskLevel === 'HIGH' || aiAnalysis.riskLevel === 'CRITICAL'
                          ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40 shadow-[0_0_8px_rgba(244,63,94,0.3)]'
                          : aiAnalysis.riskLevel === 'MEDIUM'
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                          : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                      }`}
                    >
                      {aiAnalysis.riskLevel} RISK
                    </span>
                  </div>

                  <p className="text-zinc-300 text-[11px] leading-relaxed">
                    {aiAnalysis.summary}
                  </p>

                  <div className="space-y-1 pt-2 border-t border-white/[0.06]">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 block">Факторы риска:</span>
                    {aiAnalysis.keyPoints.map((pt, i) => (
                      <div key={i} className="flex items-start space-x-1.5 text-[11px] text-zinc-400">
                        <span className="text-cyan-400 mt-0.5">•</span>
                        <span>{pt}</span>
                      </div>
                    ))}
                  </div>

                  {aiAnalysis.recommendations && aiAnalysis.recommendations.length > 0 && (
                    <div className="space-y-1 pt-2 border-t border-white/[0.06]">
                      <span className="text-[10px] font-mono uppercase tracking-wider text-cyan-400 block">Рекомендации:</span>
                      {aiAnalysis.recommendations.map((rec, i) => (
                        <div key={i} className="flex items-start space-x-1.5 text-[11px] text-zinc-300">
                          <span className="text-emerald-400 mt-0.5">✓</span>
                          <span>{rec}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {aiAnalysis.provider && (
                    <div className="pt-2 flex items-center justify-between text-[10px] font-mono text-zinc-500 border-t border-white/[0.06]">
                      <span>Анализатор:</span>
                      <span className="text-cyan-400">{aiAnalysis.provider}</span>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-[11px] text-zinc-500 leading-relaxed">
                  Нажмите «Оценить риски» для автоматического аудита сгенерированных CLI-команд через языковую модель.
                </p>
              )}
            </div>
          </div>

          {/* Right: Monaco Editor Area */}
          <div className="lg:col-span-9 p-4 rounded-2xl bg-[#0c0e14] border border-white/[0.08] overflow-hidden flex flex-col min-h-[620px]">
            {/* View Mode Bar */}
            <div className="px-3 py-2 bg-zinc-950/80 rounded-xl border border-white/[0.06] flex flex-wrap items-center justify-between gap-2 mb-3">
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setActiveViewMode('diff')}
                  className={`px-3 py-1 rounded-lg text-xs font-mono transition flex items-center space-x-1.5 cursor-pointer ${
                    activeViewMode === 'diff'
                      ? 'bg-zinc-800 text-cyan-300 border border-cyan-500/40'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <Code2 className="w-3.5 h-3.5" />
                  <span>Monaco Side-by-Side</span>
                </button>

                <button
                  onClick={() => setActiveViewMode('remediation')}
                  className={`px-3 py-1 rounded-lg text-xs font-mono transition flex items-center space-x-1.5 cursor-pointer ${
                    activeViewMode === 'remediation'
                      ? 'bg-zinc-800 text-emerald-300 border border-emerald-500/40'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <FileCheck className="w-3.5 h-3.5" />
                  <span>Remediation Patch (+)</span>
                </button>

                <button
                  onClick={() => setActiveViewMode('rollback')}
                  className={`px-3 py-1 rounded-lg text-xs font-mono transition flex items-center space-x-1.5 cursor-pointer ${
                    activeViewMode === 'rollback'
                      ? 'bg-zinc-800 text-rose-300 border border-rose-500/40'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <Undo2 className="w-3.5 h-3.5" />
                  <span>Rollback Patch (-)</span>
                </button>
              </div>

              {activeDeviceDiff && (
                <div className="text-xs text-zinc-400 font-mono">
                  {activeDeviceDiff.hostname}
                </div>
              )}
            </div>

            {/* Monaco Container */}
            <div className="flex-1 w-full h-[560px] rounded-xl overflow-hidden border border-white/[0.04]">
              {activeDeviceDiff ? (
                activeViewMode === 'diff' ? (
                  <DiffEditor
                    height="100%"
                    theme="vs-dark"
                    original={activeDeviceDiff.running_config || '# Running config empty'}
                    modified={activeDeviceDiff.intended_config || '# Intended config empty'}
                    language="shell"
                    options={{
                      readOnly: true,
                      renderSideBySide: true,
                      minimap: { enabled: false },
                      fontSize: 12,
                      scrollBeyondLastLine: false,
                    }}
                  />
                ) : activeViewMode === 'remediation' ? (
                  <Editor
                    height="100%"
                    theme="vs-dark"
                    value={
                      activeDeviceDiff.remediation_patch?.trim() ||
                      '! No remediation commands needed (Already in sync)'
                    }
                    language="shell"
                    options={{
                      readOnly: true,
                      minimap: { enabled: false },
                      fontSize: 12,
                      scrollBeyondLastLine: false,
                    }}
                  />
                ) : (
                  <Editor
                    height="100%"
                    theme="vs-dark"
                    value={
                      activeDeviceDiff.rollback_patch?.trim() ||
                      '! No rollback commands needed'
                    }
                    language="shell"
                    options={{
                      readOnly: true,
                      minimap: { enabled: false },
                      fontSize: 12,
                      scrollBeyondLastLine: false,
                    }}
                  />
                )
              ) : (
                <div className="p-16 text-center text-zinc-500 font-mono">
                  Выберите устройство для просмотра различий.
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="p-16 rounded-2xl bg-[#0c0e14] border border-white/[0.08] text-center text-zinc-500 space-y-3 font-mono">
          <Code2 className="w-8 h-8 mx-auto opacity-30 text-cyan-400" />
          <p className="text-sm">
            {loading ? 'Загрузка диффа...' : 'Нет доступных диффов. Запустите Холостой прогон (Dry Run).'}
          </p>
        </div>
      )}
    </div>
  );
};
