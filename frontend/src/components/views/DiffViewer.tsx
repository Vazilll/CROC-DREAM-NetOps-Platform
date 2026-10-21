import React, { useState, useEffect, useMemo } from 'react';
import { DiffEditor, Editor } from '@monaco-editor/react';
import { Terminal, Play, Server, Code2, Undo2, FileCheck, Zap, GitBranch } from 'lucide-react';
import { api, getErrorMessage } from '../../api';
import type { JobDiff, DeviceDiff, JobSummary, RiskExplanation } from '../../api';
import { translations, type Locale } from '../../i18n';
import type { AppTheme } from '../layout/Header';
import { IntentEditor } from './IntentEditor';
import { PlainDiffFallback, PlainCodeFallback, DiffAiRiskCard, DiffDirectToolbar, extractCliPatchFromDiff } from './DiffViewerFallbacks';

interface DiffViewerProps {
  jobs: JobSummary[];
  selectedJobId: string | null;
  targetDeviceId?: number | null;
  userRole?: import('../../api').UserRole;
  locale?: Locale;
  theme?: AppTheme;
  onSelectJob: (jobId: string) => void;
  onDeploy: (jobId: string) => void;
}

const DiffViewerComponent: React.FC<DiffViewerProps> = ({
  jobs,
  selectedJobId,
  targetDeviceId = null,
  userRole = 'viewer',
  locale = 'ru',
  theme = 'dark',
  onSelectJob,
  onDeploy,
}) => {
  const canOperate = userRole !== 'viewer';
  const isAdmin = userRole === 'admin' || userRole === 'owner';
  const t = translations[locale];
  const [diffData, setDiffData] = useState<JobDiff | null>(null);
  const [selectedDeviceIndex, setSelectedDeviceIndex] = useState(0);
  const [activeViewMode, setActiveViewMode] = useState<'diff' | 'remediation' | 'rollback' | 'intent'>('diff');
  const [viewEngine, setViewEngine] = useState<'monaco' | 'plain'>('monaco');
  const [loading, setLoading] = useState(false);
  const [prevJobKey, setPrevJobKey] = useState<string>('');
  const [committingGit, setCommittingGit] = useState(false);
  const [gitCommitNote, setGitCommitNote] = useState('');
  const [gitCommitError, setGitCommitError] = useState(false);

  const [editedConfigs, setEditedConfigs] = useState<Record<string, string>>({});
  const [editedPatches, setEditedPatches] = useState<Record<string, string>>({});
  const [applyingPatch, setApplyingPatch] = useState(false);
  const [applyStatus, setApplyStatus] = useState<{ ok: boolean; text: string } | null>(null);

  const [aiAnalysis, setAiAnalysis] = useState<RiskExplanation | null>(null);
  const [analyzingAi, setAnalyzingAi] = useState(false);
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);

  const diffJobs = useMemo(
    () => jobs.filter((j) => j.type === 'DRY_RUN' || j.type === 'DEPLOY' || j.type === 'DRIFT_SCAN' || j.type === 'DRIFT_REMEDIATE'),
    [jobs]
  );

  const selectedDiffJob = useMemo(() => (selectedJobId ? diffJobs.find((j) => j.id === selectedJobId) : undefined), [selectedJobId, diffJobs]);
  const currentJobKey = `${selectedJobId ?? ''}:${selectedDiffJob?.status ?? ''}`;

  if (currentJobKey !== prevJobKey) {
    setPrevJobKey(currentJobKey);
    setAiAnalysis(null);
    setGitCommitNote('');
    setGitCommitError(false);
    setApplyStatus(null);
    setDiffData(null);
    setLoading(Boolean(selectedDiffJob));
  }

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (!selectedDiffJob) {
      const readyJob = diffJobs.find((j) => j.status === 'SUCCESS' || j.status === 'FAILED') || diffJobs[0];
      if (readyJob) onSelectJob(readyJob.id);
      return;
    }
    if (selectedDiffJob.status === 'RUNNING' || selectedDiffJob.status === 'PENDING') return;

    let active = true;
    api
      .getJobDiff(selectedDiffJob.id)
      .then((data) => {
        if (!active) return;
        setDiffData(data);
        const matchIdx = targetDeviceId !== null ? data.devices.findIndex((d) => d.device_id === targetDeviceId) : -1;
        setSelectedDeviceIndex(matchIdx >= 0 ? matchIdx : 0);
        setLoading(false);
      })
      .catch((err) => {
        if (!active) return;
        console.warn('Job diff pending or unavailable', err);
        setDiffData(null);
        setLoading(false);
      });
    return () => { active = false; };
  }, [selectedDiffJob, diffJobs, onSelectJob, targetDeviceId]);

  const diffEditorOptions = useMemo(
    () => ({ readOnly: !canOperate, originalEditable: false, renderSideBySide: !isMobile, minimap: { enabled: false }, fontSize: isMobile ? 11 : 12, scrollBeyondLastLine: false }),
    [canOperate, isMobile]
  );

  const singleEditorOptions = useMemo(
    () => ({ readOnly: !canOperate, minimap: { enabled: false }, fontSize: 12, scrollBeyondLastLine: false }),
    [canOperate]
  );

  const activeDeviceDiff: DeviceDiff | undefined = diffData?.devices[selectedDeviceIndex];
  const hostKey = activeDeviceDiff?.hostname || '';
  const defaultModifiedConfig =
    activeDeviceDiff?.intended_config || activeDeviceDiff?.running_config || '# Intended config empty';
  const currentModifiedConfig = hostKey && editedConfigs[hostKey] !== undefined ? editedConfigs[hostKey] : defaultModifiedConfig;
  const defaultRemediationPatch =
    activeDeviceDiff?.remediation_patch?.trim() || '! Введите CLI-команды для применения на устройстве';
  const currentRemediationPatch = hostKey && editedPatches[hostKey] !== undefined ? editedPatches[hostKey] : defaultRemediationPatch;
  const hasCustomEdit = Boolean(
    hostKey && (editedConfigs[hostKey] !== undefined || editedPatches[hostKey] !== undefined)
  );

  const updateEditedConfig = (val: string) => {
    if (!hostKey || !activeDeviceDiff) return;
    setEditedConfigs((prev) => ({ ...prev, [hostKey]: val }));
    const extracted = extractCliPatchFromDiff(activeDeviceDiff.running_config || '', val, activeDeviceDiff.remediation_patch || '');
    if (extracted) setEditedPatches((prev) => ({ ...prev, [hostKey]: extracted }));
  };

  const updateEditedPatch = (val: string) => {
    if (hostKey) setEditedPatches((prev) => ({ ...prev, [hostKey]: val }));
  };

  const resetEditsForDevice = () => {
    if (!hostKey) return;
    setEditedConfigs((prev) => { const n = { ...prev }; delete n[hostKey]; return n; });
    setEditedPatches((prev) => { const n = { ...prev }; delete n[hostKey]; return n; });
    setApplyStatus(null);
  };

  const handleApplyDirect = async () => {
    if (!activeDeviceDiff) return;
    const rawPatch =
      editedPatches[hostKey] ??
      (editedConfigs[hostKey]
        ? extractCliPatchFromDiff(activeDeviceDiff.running_config || '', editedConfigs[hostKey], activeDeviceDiff.remediation_patch || '')
        : activeDeviceDiff.remediation_patch || '');
    const cleanLines = rawPatch.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('!') && !l.startsWith('#'));
    if (cleanLines.length === 0) {
      setApplyStatus({ ok: false, text: 'Измените строки конфига справа или введите CLI-команды во вкладке «Патч наката».' });
      return;
    }
    setApplyingPatch(true);
    setApplyStatus(null);
    try {
      const res = await api.applyEmergencyPatch(activeDeviceDiff.hostname, cleanLines.join('\n'), 'Прямая правка конфигурации из Diff & Config');
      setApplyStatus({ ok: true, text: `Применено на ${activeDeviceDiff.hostname} (${res.applied_lines.length} команд). Скан синхронизации запущен.` });
      if (activeDeviceDiff.device_id) {
        const scan = await api.scanDrift([activeDeviceDiff.device_id]);
        onSelectJob(scan.job_id);
      }
      window.dispatchEvent(new Event('netops-topology-mutated'));
    } catch (err) {
      setApplyStatus({ ok: false, text: `Ошибка применения: ${getErrorMessage(err)}` });
    } finally {
      setApplyingPatch(false);
    }
  };

  const handleAnalyzeWithAI = async () => {
    if (!activeDeviceDiff || !selectedJobId) return;
    setAnalyzingAi(true);
    try {
      setAiAnalysis(await api.explainDiff(selectedJobId.toString(), activeDeviceDiff.hostname));
    } catch (err) {
      setAiAnalysis({
        risk_level: 'MEDIUM',
        summary: getErrorMessage(err, 'Ошибка оценки рисков'),
        key_points: ['Не удалось получить ответ от анализатора'],
        recommendations: ['Проверьте патч наката перед деплоем'],
        is_safe: false,
        provider: 'Fallback Guard',
      });
    } finally {
      setAnalyzingAi(false);
    }
  };

  const handleCommitDiffToGit = async () => {
    if (!selectedJobId) return;
    setCommittingGit(true);
    setGitCommitNote('');
    setGitCommitError(false);
    try {
      const res = await api.commitDiffToGit(selectedJobId);
      setGitCommitError(!res.pushed);
      setGitCommitNote(res.pushed ? `Pushed: ${res.branch}@${res.commit_short}` : `Локально ${res.commit_short} (Push: ${res.push_output || 'ошибка'})`);
      window.dispatchEvent(new Event('netops-git-updated'));
      window.dispatchEvent(new Event('netops-topology-mutated'));
    } catch (err: unknown) {
      setGitCommitError(true);
      setGitCommitNote(getErrorMessage(err, 'Ошибка Git push'));
    } finally {
      setCommittingGit(false);
    }
  };

  const canDeployAny = Boolean(hasCustomEdit || diffData?.devices.some((d) => Boolean(d.remediation_patch?.trim())));

  return (
    <div className="w-full max-w-[2560px] mx-auto space-y-4 2xl:space-y-6">
      <div className="p-3 sm:p-4 rounded-2xl bg-[#0c0e14] border border-white/[0.08] flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center space-x-3 min-w-0">
          <div className="p-2 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-subtle)] shrink-0">
            <Terminal className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <h2 className="text-sm font-bold font-mono text-[var(--text-primary)]">Monaco Diff & Config Studio</h2>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">
              hier_config AST · Live Edit
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto md:justify-end">
          <label className="text-xs font-mono text-[var(--text-muted)] shrink-0">Задача:</label>
          <select
            value={selectedJobId || ''}
            onChange={(e) => onSelectJob(e.target.value)}
            disabled={diffJobs.length === 0}
            className="w-full sm:w-auto sm:min-w-[200px] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-xl px-3 py-1.5 text-xs text-[var(--text-primary)] focus:outline-none focus:border-cyan-500 font-mono cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed shadow-sm"
          >
            {diffJobs.length === 0 ? (
              <option value="">Нет задач (нужен Dry-run)</option>
            ) : (
              diffJobs.map((j) => (
                <option key={j.id} value={j.id} className="bg-[var(--bg-elevated)] text-[var(--text-primary)]">
                  {j.type} [{j.status}] - {new Date(j.created_at).toLocaleTimeString()}
                </option>
              ))
            )}
          </select>

          {canOperate && selectedJobId && (
            <button
              onClick={handleCommitDiffToGit}
              disabled={committingGit}
              data-testid="commit-diff-git-btn"
              className={`px-3 py-1.5 rounded-xl text-xs font-mono font-semibold flex items-center space-x-1.5 transition cursor-pointer disabled:opacity-50 border ${
                gitCommitError
                  ? 'bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border-rose-500/35'
                  : gitCommitNote
                    ? 'bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border-emerald-500/35'
                    : 'bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border-cyan-500/30'
              }`}
              title="Сделать git commit снапшота Diff и отправить в Git"
            >
              <GitBranch className="w-3.5 h-3.5 shrink-0" />
              <span>{committingGit ? 'Git Commit…' : gitCommitNote || 'Коммит в Git'}</span>
            </button>
          )}

          {canOperate && selectedJobId && (
            <button
              onClick={() => (hasCustomEdit ? handleApplyDirect() : onDeploy(selectedJobId))}
              disabled={!canDeployAny || applyingPatch}
              title={!canDeployAny ? 'Все устройства в синхроне (In Sync)' : 'Запустить деплой эталона или правок'}
              className="px-3.5 py-1.5 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-950 rounded-xl text-xs font-semibold flex items-center space-x-1.5 transition shadow-lg shadow-emerald-500/20 cursor-pointer"
            >
              <Play className="w-3 h-3 fill-current shrink-0" />
              <span>Деплой</span>
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
                const hasDiff = Boolean(dev.remediation_patch?.trim() || editedPatches[dev.hostname] || editedConfigs[dev.hostname]);
                return (
                  <button
                    key={dev.hostname}
                    onClick={() => {
                      setSelectedDeviceIndex(idx);
                      setAiAnalysis(null);
                      setApplyStatus(null);
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

            <DiffAiRiskCard
              analyzingAi={analyzingAi}
              aiAnalysis={aiAnalysis}
              onAnalyzeWithAI={handleAnalyzeWithAI}
            />
          </div>

          <div className="lg:col-span-9 p-3 sm:p-4 rounded-2xl bg-[#0c0e14] border border-white/[0.08] overflow-hidden flex flex-col min-h-[360px] sm:min-h-[520px] 2xl:min-h-[680px] min-w-0">
            <div className="px-3 py-2 bg-[var(--bg-main)]/80 rounded-xl border border-[var(--border-subtle)] flex flex-wrap items-center justify-between gap-2 mb-3">
              <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                {(
                  [
                    { id: 'diff', label: t.modeDiff, Icon: Code2, activeCls: 'bg-cyan-500/10 text-cyan-300 border border-cyan-500/40 font-semibold' },
                    { id: 'remediation', label: t.modeRemediation, Icon: FileCheck, activeCls: 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/40 font-semibold' },
                    { id: 'rollback', label: t.modeRollback, Icon: Undo2, activeCls: 'bg-rose-500/10 text-rose-300 border border-rose-500/40 font-semibold' },
                    { id: 'intent', label: 'Intent (YAML)', Icon: GitBranch, activeCls: 'bg-amber-500/10 text-amber-300 border border-amber-500/40 font-semibold' },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveViewMode(tab.id)}
                    className={`px-2.5 sm:px-3 py-1 rounded-lg text-xs font-mono transition flex items-center space-x-1.5 cursor-pointer ${
                      activeViewMode === tab.id ? tab.activeCls : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    <tab.Icon className="w-3.5 h-3.5" />
                    <span>{tab.label}</span>
                  </button>
                ))}
              </div>

              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setViewEngine(viewEngine === 'monaco' ? 'plain' : 'monaco')}
                  className="px-2.5 py-1 rounded-lg text-xs font-mono transition flex items-center space-x-1.5 border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] cursor-pointer"
                  title="Переключить между Monaco Editor и мгновенным текстовым режимом"
                >
                  <Zap className={`w-3.5 h-3.5 ${viewEngine === 'plain' ? 'text-amber-500' : 'text-zinc-400'}`} />
                  <span>{viewEngine === 'plain' ? 'Быстрый вид' : 'Monaco'}</span>
                </button>
                {activeDeviceDiff && <div className="text-xs text-zinc-400 font-mono truncate">{activeDeviceDiff.hostname}</div>}
              </div>
            </div>

            {activeDeviceDiff && activeViewMode !== 'intent' && (
              <DiffDirectToolbar
                hostname={activeDeviceDiff.hostname}
                canOperate={canOperate}
                isAdmin={isAdmin}
                hasCustomEdit={hasCustomEdit}
                applyingPatch={applyingPatch}
                applyStatus={applyStatus}
                onApplyDirect={handleApplyDirect}
                onResetEdits={resetEditsForDevice}
              />
            )}

            <div className="flex-1 w-full h-[360px] sm:h-[520px] 2xl:h-[680px] rounded-xl overflow-hidden border border-[var(--border-subtle)]">
              {!activeDeviceDiff ? (
                <div className="p-16 text-center text-zinc-500 font-mono">Выберите устройство для просмотра различий.</div>
              ) : activeViewMode === 'intent' ? (
                activeDeviceDiff.device_id ? (
                  <IntentEditor deviceId={activeDeviceDiff.device_id} canEdit={isAdmin} theme={theme} />
                ) : (
                  <div className="p-8 text-center text-zinc-500 font-mono">Устройство не привязано к БД.</div>
                )
              ) : activeViewMode === 'diff' ? (
                viewEngine === 'plain' ? (
                  <PlainDiffFallback
                    original={activeDeviceDiff.running_config || '# Running config empty'}
                    modified={currentModifiedConfig}
                    isMobile={isMobile}
                    theme={theme}
                    canEdit={canOperate}
                    onEditModified={updateEditedConfig}
                  />
                ) : (
                  <DiffEditor
                    key={`diff-${hostKey}-${selectedJobId}`}
                    height="100%"
                    theme={theme === 'light' ? 'vs' : 'vs-dark'}
                    original={activeDeviceDiff.running_config || '# Running config empty'}
                    modified={currentModifiedConfig}
                    language="shell"
                    keepCurrentOriginalModel={true}
                    keepCurrentModifiedModel={true}
                    onMount={(editor) => {
                      const mod = editor.getModifiedEditor();
                      mod.onDidChangeModelContent(() => updateEditedConfig(mod.getValue()));
                    }}
                    loading={
                      <PlainDiffFallback
                        original={activeDeviceDiff.running_config || '# Running config empty'}
                        modified={currentModifiedConfig}
                        isMobile={isMobile}
                        theme={theme}
                        canEdit={canOperate}
                        onEditModified={updateEditedConfig}
                      />
                    }
                    options={diffEditorOptions}
                  />
                )
              ) : (
                (() => {
                  const isRem = activeViewMode === 'remediation';
                  const codeVal = isRem
                    ? currentRemediationPatch
                    : activeDeviceDiff.rollback_patch?.trim() || '! No rollback commands needed';
                  const label = isRem ? 'Патч наката (Remediation — редактируемый)' : 'Патч отката (Rollback)';
                  return viewEngine === 'plain' ? (
                    <PlainCodeFallback
                      code={codeVal}
                      label={label}
                      theme={theme}
                      canEdit={isRem && canOperate}
                      onEdit={isRem ? updateEditedPatch : undefined}
                    />
                  ) : (
                    <Editor
                      key={`${activeViewMode}-${hostKey}-${selectedJobId}`}
                      height="100%"
                      theme={theme === 'light' ? 'vs' : 'vs-dark'}
                      value={codeVal}
                      onChange={isRem ? (val) => updateEditedPatch(val ?? '') : undefined}
                      language="shell"
                      keepCurrentModel={true}
                      loading={
                        <PlainCodeFallback
                          code={codeVal}
                          label={label}
                          theme={theme}
                          canEdit={isRem && canOperate}
                          onEdit={isRem ? updateEditedPatch : undefined}
                        />
                      }
                      options={isRem ? singleEditorOptions : { ...singleEditorOptions, readOnly: true }}
                    />
                  );
                })()
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="min-h-[360px] sm:min-h-[520px] 2xl:min-h-[680px] flex flex-col items-center justify-center p-12 rounded-2xl bg-[#0c0e14] border border-white/[0.08] text-center text-zinc-500 space-y-3 font-mono">
          <Code2 className="w-8 h-8 mx-auto opacity-30 text-cyan-400" />
          <p className="text-sm">{loading ? 'Загрузка диффа...' : 'Нет доступных диффов. Запустите Холостой прогон (Dry Run).'}</p>
        </div>
      )}
    </div>
  );
};

export const DiffViewer = React.memo(DiffViewerComponent);
