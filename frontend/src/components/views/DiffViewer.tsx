import React, { useState, useEffect, useMemo } from 'react';
import { DiffEditor, Editor } from '@monaco-editor/react';
import {
  Terminal,
  Play,
  Bot,
  Server,
  Code2,
  Undo2,
  FileCheck,
  Copy,
  Check,
  Zap,
  GitBranch,
} from 'lucide-react';
import { api } from '../../api';
import type { JobDiff, DeviceDiff, JobSummary, RiskExplanation } from '../../api';
import { translations, type Locale } from '../../i18n';
import type { AppTheme } from '../layout/Header';

interface PlainDiffProps {
  original: string;
  modified: string;
  isMobile: boolean;
  theme: AppTheme;
}

const PlainDiffFallback: React.FC<PlainDiffProps> = ({ original, modified, isMobile, theme }) => {
  const origLines = (original || '').split('\n');
  const modLines = (modified || '').split('\n');

  return (
    <div
      className={`h-full w-full overflow-auto font-mono text-xs ${
        theme === 'light' ? 'bg-slate-50 text-slate-800' : 'bg-[#090a0f] text-zinc-300'
      }`}
    >
      <div
        className={`grid ${isMobile ? 'grid-cols-1 divide-y' : 'grid-cols-2 divide-x'} ${
          theme === 'light' ? 'divide-slate-200' : 'divide-white/[0.08]'
        }`}
      >
        <div>
          <div
            className={`sticky top-0 px-3 py-1.5 font-bold text-[10px] uppercase tracking-wider border-b ${
              theme === 'light'
                ? 'bg-slate-100 text-slate-700 border-slate-200'
                : 'bg-zinc-900/90 text-zinc-400 border-white/[0.08]'
            }`}
          >
            Текущая (Running Config)
          </div>
          <div className="p-2 space-y-0.5">
            {origLines.map((line, idx) => {
              const modLine = modLines[idx];
              const isDiff = line !== modLine;
              return (
                <div
                  key={`orig-${idx}`}
                  className={`flex items-start px-2 py-0.5 rounded-xs ${
                    isDiff && line ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400 font-medium' : ''
                  }`}
                >
                  <span className="w-8 select-none text-right pr-3 opacity-40 text-[10px]">{idx + 1}</span>
                  <span className="whitespace-pre overflow-x-auto flex-1">{line || ' '}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <div
            className={`sticky top-0 px-3 py-1.5 font-bold text-[10px] uppercase tracking-wider border-b ${
              theme === 'light'
                ? 'bg-slate-100 text-slate-700 border-slate-200'
                : 'bg-zinc-900/90 text-zinc-400 border-white/[0.08]'
            }`}
          >
            Целевая эталонная (Intended Git SoT)
          </div>
          <div className="p-2 space-y-0.5">
            {modLines.map((line, idx) => {
              const origLine = origLines[idx];
              const isDiff = line !== origLine;
              return (
                <div
                  key={`mod-${idx}`}
                  className={`flex items-start px-2 py-0.5 rounded-xs ${
                    isDiff && line ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-medium' : ''
                  }`}
                >
                  <span className="w-8 select-none text-right pr-3 opacity-40 text-[10px]">{idx + 1}</span>
                  <span className="whitespace-pre overflow-x-auto flex-1">{line || ' '}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

const PlainCodeFallback: React.FC<{ code: string; label: string; theme: AppTheme }> = ({ code, label, theme }) => {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const lines = (code || '').split('\n');

  return (
    <div
      className={`relative h-full w-full flex flex-col font-mono text-xs ${
        theme === 'light' ? 'bg-slate-50 text-slate-800' : 'bg-[#090a0f] text-zinc-300'
      }`}
    >
      <div
        className={`flex items-center justify-between px-3 py-1.5 border-b ${
          theme === 'light'
            ? 'bg-slate-100 text-slate-700 border-slate-200'
            : 'bg-zinc-900/90 text-zinc-400 border-white/[0.08]'
        }`}
      >
        <span className="text-[10px] uppercase font-bold tracking-wider">{label}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 border border-cyan-500/30 transition cursor-pointer"
        >
          {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
          <span>{copied ? 'Скопировано!' : 'Копировать'}</span>
        </button>
      </div>
      <div className="flex-1 overflow-auto p-2 space-y-0.5">
        {lines.map((line, idx) => (
          <div key={idx} className="flex items-start px-2 py-0.5">
            <span className="w-8 select-none text-right pr-3 opacity-40 text-[10px]">{idx + 1}</span>
            <span
              className={`whitespace-pre overflow-x-auto flex-1 ${
                line.startsWith('!')
                  ? 'opacity-50 italic'
                  : line.startsWith('no ') || line.startsWith('undo ')
                  ? 'text-rose-600 dark:text-rose-400 font-semibold'
                  : line.startsWith('interface ') || line.startsWith('router ')
                  ? 'text-cyan-600 dark:text-cyan-300 font-bold'
                  : ''
              }`}
            >
              {line || ' '}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

interface DiffViewerProps {
  jobs: JobSummary[];
  selectedJobId: string | null;
  locale?: Locale;
  theme?: AppTheme;
  onSelectJob: (jobId: string) => void;
  onDeploy: (jobId: string) => void;
}


const DiffViewerComponent: React.FC<DiffViewerProps> = ({
  jobs,
  selectedJobId,
  locale = 'ru',
  theme = 'dark',
  onSelectJob,
  onDeploy,
}) => {
  const t = translations[locale];
  const [diffData, setDiffData] = useState<JobDiff | null>(null);
  const [selectedDeviceIndex, setSelectedDeviceIndex] = useState(0);
  const [activeViewMode, setActiveViewMode] = useState<'diff' | 'remediation' | 'rollback'>('diff');
  const [viewEngine, setViewEngine] = useState<'monaco' | 'plain'>('monaco');
  const [loading, setLoading] = useState(false);
  const [prevSelectedJobId, setPrevSelectedJobId] = useState<string | null>(selectedJobId);
  const [committingGit, setCommittingGit] = useState(false);
  const [gitCommitNote, setGitCommitNote] = useState('');

  const [aiAnalysis, setAiAnalysis] = useState<RiskExplanation | null>(null);
  const [analyzingAi, setAnalyzingAi] = useState(false);
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);

  const diffJobs = useMemo(
    () => jobs.filter((j) => j.type === 'DRY_RUN' || j.type === 'DEPLOY'),
    [jobs]
  );

  if (selectedJobId !== prevSelectedJobId) {
    setPrevSelectedJobId(selectedJobId);
    setAiAnalysis(null);
    setGitCommitNote('');
    if (!selectedJobId) setDiffData(null);
    setLoading(Boolean(selectedJobId));
  }

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const selectedDiffJob = selectedJobId ? diffJobs.find((j) => j.id === selectedJobId) : undefined;
    if (!selectedDiffJob) {
      const readyJob = diffJobs.find((j) => j.status === 'SUCCESS' || j.status === 'FAILED') || diffJobs[0];
      if (readyJob) {
        onSelectJob(readyJob.id);
      }
      return;
    }

    if (selectedDiffJob.status === 'RUNNING' || selectedDiffJob.status === 'PENDING') {
      return;
    }

    let active = true;
    api
      .getJobDiff(selectedDiffJob.id)
      .then((data) => {
        if (!active) return;
        setDiffData(data);
        setSelectedDeviceIndex(0);
        setLoading(false);
      })
      .catch((err) => {
        if (!active) return;
        console.warn('Job diff pending or unavailable', err);
        setDiffData(null);
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [selectedJobId, diffJobs, jobs, onSelectJob]);

  const diffEditorOptions = useMemo(
    () => ({
      readOnly: true,
      renderSideBySide: !isMobile,
      minimap: { enabled: false },
      fontSize: isMobile ? 11 : 12,
      scrollBeyondLastLine: false,
    }),
    [isMobile]
  );

  const singleEditorOptions = useMemo(
    () => ({
      readOnly: true,
      minimap: { enabled: false },
      fontSize: 12,
      scrollBeyondLastLine: false,
    }),
    []
  );

  const activeDeviceDiff: DeviceDiff | undefined = diffData?.devices[selectedDeviceIndex];

  const handleAnalyzeWithAI = async () => {
    if (!activeDeviceDiff || !selectedJobId) return;
    setAnalyzingAi(true);

    try {
      const res = await api.explainDiff(selectedJobId.toString(), activeDeviceDiff.hostname);
      setAiAnalysis(res);
    } catch (err) {
      console.error('Backend LLM explain endpoint failed', err);
    } finally {
      setAnalyzingAi(false);
    }
  };

  const handleCommitDiffToGit = async () => {
    if (!selectedJobId) return;
    setCommittingGit(true);
    setGitCommitNote('');
    try {
      const res = await api.commitDiffToGit(selectedJobId);
      setGitCommitNote(
        res.pushed
          ? `Отправлено по SSH: ${res.branch}@${res.commit_short}`
          : `Коммит создан: ${res.branch}@${res.commit_short}`
      );
    } catch {
      setGitCommitNote('Ошибка git push по SSH');
    } finally {
      setCommittingGit(false);
    }
  };

  return (
    <div className="w-full max-w-[2560px] mx-auto space-y-4 2xl:space-y-6">
      <div className="p-3 sm:p-4 rounded-2xl bg-[#0c0e14] border border-white/[0.08] flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center space-x-3 min-w-0">
          <div className="p-2 rounded-lg bg-slate-100 dark:bg-zinc-900 border border-slate-200 dark:border-white/[0.08] shrink-0">
            <Terminal className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-bold font-mono text-slate-900 dark:text-white">Monaco Diff & LLM Guard</h2>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 border border-cyan-500/20">
                hier_config AST
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto md:justify-end">
          <label className="text-xs font-mono text-slate-600 dark:text-zinc-400 shrink-0">Задача:</label>
          <select
            value={selectedJobId || ''}
            onChange={(e) => onSelectJob(e.target.value)}
            disabled={diffJobs.length === 0}
            className="w-full sm:w-auto sm:min-w-[200px] bg-white dark:bg-zinc-900 border border-slate-300 dark:border-white/[0.12] rounded-xl px-3 py-1.5 text-xs text-slate-800 dark:text-zinc-200 focus:outline-none focus:border-cyan-500 font-mono cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed shadow-sm"
          >
            {diffJobs.length === 0 ? (
              <option value="">Нет задач деплоя (нужен Dry Run)</option>
            ) : (
              diffJobs.map((j) => (
                <option key={j.id} value={j.id} className="bg-white dark:bg-zinc-900 text-slate-900 dark:text-zinc-100">
                  {j.type} [{j.status}] - {new Date(j.created_at).toLocaleTimeString()}
                </option>
              ))
            )}
          </select>

          {selectedJobId && (
            <button
              onClick={handleCommitDiffToGit}
              disabled={committingGit}
              className="px-3 py-1.5 bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border border-cyan-500/30 rounded-xl text-xs font-mono font-semibold flex items-center space-x-1.5 transition cursor-pointer disabled:opacity-50"
              title="Сделать git commit снапшота Diff и отправить git push по SSH"
            >
              <GitBranch className="w-3.5 h-3.5 shrink-0" />
              <span>{committingGit ? 'Git Push...' : gitCommitNote || 'Коммит в Git (SSH)'}</span>
            </button>
          )}

          {selectedJobId && (
            <button
              onClick={() => onDeploy(selectedJobId)}
              disabled={!diffData?.devices.some((d) => Boolean(d.remediation_patch?.trim()))}
              title={
                !diffData?.devices.some((d) => Boolean(d.remediation_patch?.trim()))
                  ? 'Все устройства в синхроне (In Sync) — изменения для деплоя отсутствуют'
                  : 'Запустить транзакционный деплой патча'
              }
              className="px-3.5 py-1.5 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-950 rounded-xl text-xs font-semibold flex items-center space-x-1.5 transition shadow-lg shadow-emerald-500/20 cursor-pointer"
            >
              <Play className="w-3 h-3 fill-current shrink-0" />
              <span>Деплой (Commit Confirmed)</span>
            </button>
          )}
        </div>
      </div>

      {diffData && diffData.devices.length > 0 ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 2xl:gap-6">
          <div className="lg:col-span-3 space-y-4 min-w-0">
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
                        ? 'bg-cyan-500/10 border-cyan-500/40 text-cyan-600 dark:text-cyan-300 font-medium'
                        : 'bg-black/[0.03] dark:bg-zinc-950/40 border-[var(--border-subtle)] text-[var(--text-muted)] hover:border-cyan-500/30'
                    }`}
                  >
                    <div className="flex items-center space-x-2 truncate">
                      <Server className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
                      <span className="truncate text-[var(--text-primary)]">{dev.hostname}</span>
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

            <div className="p-4 rounded-2xl bg-[#0c0e14] border border-white/[0.08] space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center space-x-1.5 min-w-0">
                  <Bot className="w-4 h-4 text-cyan-400 shrink-0" />
                  <span className="text-xs font-bold font-mono text-white truncate">LLM Risk Assistant</span>
                </div>
                <button
                  onClick={handleAnalyzeWithAI}
                  disabled={analyzingAi}
                  className="px-2.5 py-1 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 text-[11px] font-mono border border-cyan-500/30 transition flex items-center space-x-1 cursor-pointer shrink-0"
                >
                  <span>{analyzingAi ? 'Анализ...' : 'Оценить риски'}</span>
                </button>
              </div>

              {aiAnalysis && (
                <div className="space-y-2.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-400 text-[11px] font-mono">Уровень риска:</span>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                        aiAnalysis.risk_level === 'HIGH' || aiAnalysis.risk_level === 'CRITICAL'
                          ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40 shadow-[0_0_8px_rgba(244,63,94,0.3)]'
                          : aiAnalysis.risk_level === 'MEDIUM'
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                          : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                      }`}
                    >
                      {aiAnalysis.risk_level} RISK
                    </span>
                  </div>

                  <p className="text-zinc-300 text-[11px] leading-relaxed">
                    {aiAnalysis.summary}
                  </p>

                  <div className="space-y-1 pt-2 border-t border-white/[0.06]">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 block">Факторы риска:</span>
                    {aiAnalysis.key_points.map((pt, i) => (
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
              )}
            </div>
          </div>

          <div className="lg:col-span-9 p-3 sm:p-4 rounded-2xl bg-[#0c0e14] border border-white/[0.08] overflow-hidden flex flex-col min-h-[360px] sm:min-h-[520px] 2xl:min-h-[680px] min-w-0">
            <div className="px-3 py-2 bg-slate-100/90 dark:bg-zinc-950/80 rounded-xl border border-slate-200 dark:border-white/[0.06] flex flex-wrap items-center justify-between gap-2 mb-3">
              <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                <button
                  onClick={() => setActiveViewMode('diff')}
                  className={`px-2.5 sm:px-3 py-1 rounded-lg text-xs font-mono transition flex items-center space-x-1.5 cursor-pointer ${
                    activeViewMode === 'diff'
                      ? 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 border border-cyan-500/40 font-semibold'
                      : 'text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-200'
                  }`}
                >
                  <Code2 className="w-3.5 h-3.5" />
                  <span>{t.modeDiff}</span>
                </button>

                <button
                  onClick={() => setActiveViewMode('remediation')}
                  className={`px-2.5 sm:px-3 py-1 rounded-lg text-xs font-mono transition flex items-center space-x-1.5 cursor-pointer ${
                    activeViewMode === 'remediation'
                      ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/40 font-semibold'
                      : 'text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-200'
                  }`}
                >
                  <FileCheck className="w-3.5 h-3.5" />
                  <span>{t.modeRemediation}</span>
                </button>

                <button
                  onClick={() => setActiveViewMode('rollback')}
                  className={`px-2.5 sm:px-3 py-1 rounded-lg text-xs font-mono transition flex items-center space-x-1.5 cursor-pointer ${
                    activeViewMode === 'rollback'
                      ? 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border border-rose-500/40 font-semibold'
                      : 'text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-200'
                  }`}
                >
                  <Undo2 className="w-3.5 h-3.5" />
                  <span>{t.modeRollback}</span>
                </button>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setViewEngine(viewEngine === 'monaco' ? 'plain' : 'monaco')}
                  className="px-2.5 py-1 rounded-lg text-xs font-mono transition flex items-center space-x-1.5 border border-slate-200 dark:border-white/[0.08] text-slate-700 dark:text-zinc-300 hover:bg-slate-200/50 dark:hover:bg-white/[0.04] cursor-pointer"
                  title="Переключить между Monaco Editor и мгновенным текстовым режимом"
                >
                  <Zap className={`w-3.5 h-3.5 ${viewEngine === 'plain' ? 'text-amber-500' : 'text-zinc-400'}`} />
                  <span>{viewEngine === 'plain' ? 'Быстрый вид' : 'Monaco'}</span>
                </button>

                {activeDeviceDiff && (
                  <div className="text-xs text-zinc-400 font-mono truncate">
                    {activeDeviceDiff.hostname}
                  </div>
                )}
              </div>
            </div>

            <div className="flex-1 w-full h-[360px] sm:h-[520px] 2xl:h-[680px] rounded-xl overflow-hidden border border-slate-200 dark:border-white/[0.04]">
              {activeDeviceDiff ? (
                activeViewMode === 'diff' ? (
                  viewEngine === 'plain' ? (
                    <PlainDiffFallback
                      original={activeDeviceDiff.running_config || '# Running config empty'}
                      modified={
                        activeDeviceDiff.intended_config ||
                        activeDeviceDiff.running_config ||
                        '# Intended config empty'
                      }
                      isMobile={isMobile}
                      theme={theme}
                    />
                  ) : (
                    <DiffEditor
                      height="100%"
                      theme={theme === 'light' ? 'vs' : 'vs-dark'}
                      original={activeDeviceDiff.running_config || '# Running config empty'}
                      modified={
                        activeDeviceDiff.intended_config ||
                        activeDeviceDiff.running_config ||
                        '# Intended config empty'
                      }
                      language="shell"
                      keepCurrentOriginalModel={true}
                      keepCurrentModifiedModel={true}
                      loading={
                        <PlainDiffFallback
                          original={activeDeviceDiff.running_config || '# Running config empty'}
                          modified={
                            activeDeviceDiff.intended_config ||
                            activeDeviceDiff.running_config ||
                            '# Intended config empty'
                          }
                          isMobile={isMobile}
                          theme={theme}
                        />
                      }
                      options={diffEditorOptions}
                    />
                  )
                ) : activeViewMode === 'remediation' ? (
                  viewEngine === 'plain' ? (
                    <PlainCodeFallback
                      code={activeDeviceDiff.remediation_patch?.trim() || '! No remediation commands needed (Already in sync)'}
                      label="Патч наката (Remediation)"
                      theme={theme}
                    />
                  ) : (
                    <Editor
                      height="100%"
                      theme={theme === 'light' ? 'vs' : 'vs-dark'}
                      value={
                        activeDeviceDiff.remediation_patch?.trim() ||
                        '! No remediation commands needed (Already in sync)'
                      }
                      language="shell"
                      keepCurrentModel={true}
                      loading={
                        <PlainCodeFallback
                          code={activeDeviceDiff.remediation_patch?.trim() || '! No remediation commands needed (Already in sync)'}
                          label="Патч наката (Remediation)"
                          theme={theme}
                        />
                      }
                      options={singleEditorOptions}
                    />
                  )
                ) : (
                  viewEngine === 'plain' ? (
                    <PlainCodeFallback
                      code={activeDeviceDiff.rollback_patch?.trim() || '! No rollback commands needed'}
                      label="Патч отката (Rollback)"
                      theme={theme}
                    />
                  ) : (
                    <Editor
                      height="100%"
                      theme={theme === 'light' ? 'vs' : 'vs-dark'}
                      value={
                        activeDeviceDiff.rollback_patch?.trim() ||
                        '! No rollback commands needed'
                      }
                      language="shell"
                      keepCurrentModel={true}
                      loading={
                        <PlainCodeFallback
                          code={activeDeviceDiff.rollback_patch?.trim() || '! No rollback commands needed'}
                          label="Патч отката (Rollback)"
                          theme={theme}
                        />
                      }
                      options={singleEditorOptions}
                    />
                  )
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
        <div className="min-h-[360px] sm:min-h-[520px] 2xl:min-h-[680px] flex flex-col items-center justify-center p-12 rounded-2xl bg-[#0c0e14] border border-white/[0.08] text-center text-zinc-500 space-y-3 font-mono">
          <Code2 className="w-8 h-8 mx-auto opacity-30 text-cyan-400" />
          <p className="text-sm">
            {loading ? 'Загрузка диффа...' : 'Нет доступных диффов. Запустите Холостой прогон (Dry Run).'}
          </p>
        </div>
      )}
    </div>
  );
};

export const DiffViewer = React.memo(DiffViewerComponent);
