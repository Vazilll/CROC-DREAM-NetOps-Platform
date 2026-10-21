import React, { useState } from 'react';
import { Check, Copy, Bot, Play, RotateCcw, Lock, Terminal, Send } from 'lucide-react';
import { api, getErrorMessage, type RiskExplanation } from '../../api';
import type { AppTheme } from '../layout/Header';

interface PlainDiffProps {
  original: string;
  modified: string;
  isMobile: boolean;
  theme: AppTheme;
  canEdit?: boolean;
  onEditModified?: (val: string) => void;
}

export const PlainDiffFallback: React.FC<PlainDiffProps> = ({
  original,
  modified,
  isMobile,
  canEdit = false,
  onEditModified,
}) => {
  const origLines = (original || '').split('\n');
  const modLines = (modified || '').split('\n');

  return (
    <div className="h-full w-full overflow-auto font-mono text-xs bg-[var(--bg-main)] text-[var(--text-primary)]">
      <div className={`grid ${isMobile ? 'grid-cols-1 divide-y' : 'grid-cols-2 divide-x'} divide-[var(--border-subtle)] h-full`}>
        <div>
          <div className="sticky top-0 px-3 py-1.5 font-bold text-[10px] uppercase tracking-wider border-b bg-[var(--bg-elevated)] text-[var(--text-secondary)] border-[var(--border-subtle)]">
            Текущая на устройстве (Running Config)
          </div>
          <div className="p-2 space-y-0.5">
            {origLines.map((line, idx) => {
              const isDiff = line !== modLines[idx];
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

        <div className="flex flex-col h-full">
          <div className="sticky top-0 px-3 py-1.5 font-bold text-[10px] uppercase tracking-wider border-b bg-[var(--bg-elevated)] text-[var(--text-secondary)] border-[var(--border-subtle)] flex items-center justify-between">
            <span>Целевая / Редактируемая (Intended Config)</span>
            {canEdit && <span className="text-[10px] text-cyan-400 normal-case">Доступно редактирование</span>}
          </div>
          {canEdit && onEditModified ? (
            <textarea
              value={modified}
              onChange={(e) => onEditModified(e.target.value)}
              spellCheck={false}
              className="flex-1 w-full min-h-[320px] p-3 font-mono text-xs bg-transparent text-emerald-300 focus:outline-none resize-none leading-relaxed"
            />
          ) : (
            <div className="p-2 space-y-0.5">
              {modLines.map((line, idx) => {
                const isDiff = line !== origLines[idx];
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
          )}
        </div>
      </div>
    </div>
  );
};

export const PlainCodeFallback: React.FC<{
  code: string;
  label: string;
  theme?: AppTheme;
  canEdit?: boolean;
  onEdit?: (val: string) => void;
}> = ({ code, label, canEdit = false, onEdit }) => {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const lines = (code || '').split('\n');

  return (
    <div className="relative h-full w-full flex flex-col font-mono text-xs bg-[var(--bg-main)] text-[var(--text-primary)]">
      <div className="flex items-center justify-between px-3 py-1.5 border-b bg-[var(--bg-elevated)] text-[var(--text-secondary)] border-[var(--border-subtle)]">
        <span className="text-[10px] uppercase font-bold tracking-wider">{label}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 border border-cyan-500/30 transition cursor-pointer"
        >
          {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
          <span>{copied ? 'Скопировано!' : 'Копировать'}</span>
        </button>
      </div>
      {canEdit && onEdit ? (
        <textarea
          value={code}
          onChange={(e) => onEdit(e.target.value)}
          spellCheck={false}
          className="flex-1 w-full p-3 font-mono text-xs bg-transparent text-emerald-300 focus:outline-none resize-none leading-relaxed"
        />
      ) : (
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
      )}
    </div>
  );
};

export function extractCliPatchFromDiff(runningConfig: string, modifiedConfig: string, basePatch: string): string {
  const runLines = (runningConfig || '').split('\n');
  const modLines = (modifiedConfig || '').split('\n');
  const runSet = new Set(runLines.map((l) => l.trim()).filter(Boolean));
  const out: string[] = [];
  let currentSection = '';
  let pushedSection = '';

  for (let i = 0; i < modLines.length; i++) {
    const raw = modLines[i];
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('!') || trimmed.startsWith('#')) continue;
    const isIndented = raw.startsWith(' ') || raw.startsWith('\t');
    if (!isIndented) {
      currentSection = trimmed;
    }
    const sameAtPos = (runLines[i] || '').trim() === trimmed;
    if (!sameAtPos && !runSet.has(trimmed)) {
      if (isIndented && currentSection && pushedSection !== currentSection) {
        out.push(currentSection);
        pushedSection = currentSection;
      }
      out.push(trimmed);
    }
  }
  if (out.length > 0) return out.join('\n');
  return basePatch.trim();
}

interface DiffDirectToolbarProps {
  hostname: string;
  canOperate: boolean;
  isAdmin: boolean;
  hasCustomEdit: boolean;
  applyingPatch: boolean;
  applyStatus: { ok: boolean; text: string } | null;
  onApplyDirect: () => void;
  onResetEdits: () => void;
}

export const DiffDirectToolbar: React.FC<DiffDirectToolbarProps> = ({
  hostname,
  canOperate,
  isAdmin,
  hasCustomEdit,
  applyingPatch,
  applyStatus,
  onApplyDirect,
  onResetEdits,
}) => {
  const [cliOpen, setCliOpen] = useState(false);
  const [cliCmd, setCliCmd] = useState('show ip bgp summary');
  const [cliOut, setCliOut] = useState('');
  const [runningCli, setRunningCli] = useState(false);
  const [frozen, setFrozen] = useState(false);
  const [busyAction, setBusyAction] = useState(false);

  if (!canOperate) return null;

  const handleExecCli = async () => {
    if (!cliCmd.trim() || !hostname) return;
    setRunningCli(true);
    try {
      const res = await api.executeEmergencyCommand(hostname, cliCmd);
      setCliOut(res.output || '(нет вывода)');
    } catch (err) {
      setCliOut(`[ОШИБКА]: ${getErrorMessage(err)}`);
    } finally {
      setRunningCli(false);
    }
  };

  const handleToggleFreeze = async () => {
    setBusyAction(true);
    try {
      const next = !frozen;
      const st = await api.setFreezeStatus(next, 'Переключение Freeze из Diff & Config');
      setFrozen(Boolean(st.frozen));
    } catch {
      // ignore
    } finally {
      setBusyAction(false);
    }
  };

  const handleSoftReset = async () => {
    setBusyAction(true);
    try {
      const res = await api.softResetFabric();
      setCliOut(`[SOFT RESET]: ${res.message}`);
      setCliOpen(true);
      window.dispatchEvent(new Event('netops-topology-mutated'));
    } catch (err) {
      setCliOut(`[ОШИБКА]: ${getErrorMessage(err)}`);
      setCliOpen(true);
    } finally {
      setBusyAction(false);
    }
  };

  return (
    <div className="mb-3 space-y-2">
      <div className="px-3 py-2 rounded-xl bg-cyan-500/[0.06] border border-cyan-500/20 flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
        <div className="flex flex-wrap items-center gap-2">
          <span className="px-2 py-0.5 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 text-[11px]">
            ✏️ Прямая правка конфига и патча активна
          </span>
          {hasCustomEdit && (
            <button
              onClick={onResetEdits}
              className="px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[11px] cursor-pointer"
            >
              Сбросить правки
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={onApplyDirect}
            disabled={applyingPatch}
            data-testid="apply-direct-config-btn"
            className="px-3 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-zinc-950 font-semibold text-[11px] flex items-center gap-1.5 cursor-pointer shadow-sm"
            title="Накатить отредактированный конфиг / патч прямо на устройство по SSH"
          >
            <Play className="w-3 h-3 fill-current" />
            <span>{applyingPatch ? 'Применение…' : `Применить на ${hostname}`}</span>
          </button>

          {isAdmin && (
            <>
              <button
                onClick={() => setCliOpen((v) => !v)}
                className="px-2.5 py-1 rounded-lg bg-zinc-800/90 hover:bg-zinc-700 text-cyan-300 border border-white/10 text-[11px] flex items-center gap-1 cursor-pointer"
              >
                <Terminal className="w-3 h-3" />
                <span>SSH CLI</span>
              </button>
              <button
                onClick={handleToggleFreeze}
                disabled={busyAction}
                className={`px-2.5 py-1 rounded-lg border text-[11px] flex items-center gap-1 cursor-pointer ${
                  frozen
                    ? 'bg-cyan-500/20 text-cyan-200 border-cyan-500/40'
                    : 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border-amber-500/30'
                }`}
              >
                <Lock className="w-3 h-3" />
                <span>{frozen ? 'Unfreeze' : 'Freeze'}</span>
              </button>
              <button
                onClick={handleSoftReset}
                disabled={busyAction}
                className="px-2.5 py-1 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[11px] flex items-center gap-1 cursor-pointer"
                title="Мягкий сброс всех узлов стенда к эталону Git SoT"
              >
                <RotateCcw className="w-3 h-3" />
                <span>К эталону SoT</span>
              </button>
            </>
          )}
        </div>
      </div>

      {applyStatus && (
        <div
          className={`px-3 py-2 rounded-xl text-xs font-mono border ${
            applyStatus.ok
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
          }`}
        >
          {applyStatus.text}
        </div>
      )}

      {cliOpen && isAdmin && (
        <div className="p-3 rounded-xl bg-[#090b10] border border-white/10 space-y-2 font-mono text-xs">
          <div className="flex items-center gap-2">
            <span className="text-cyan-400">[{hostname}] #</span>
            <input
              type="text"
              value={cliCmd}
              onChange={(e) => setCliCmd(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleExecCli()}
              className="flex-1 bg-zinc-900 border border-white/10 rounded px-2.5 py-1 text-xs text-white focus:outline-none focus:border-cyan-500"
              placeholder="Команда CLI (например: show ip bgp summary)..."
            />
            <button
              onClick={handleExecCli}
              disabled={runningCli}
              className="px-3 py-1 rounded bg-cyan-500 hover:bg-cyan-400 text-zinc-950 font-semibold flex items-center gap-1 cursor-pointer"
            >
              <Send className="w-3 h-3" />
              <span>{runningCli ? '...' : 'Выполнить'}</span>
            </button>
          </div>
          {cliOut && (
            <pre className="p-2.5 rounded bg-black/60 text-emerald-400 max-h-40 overflow-y-auto whitespace-pre-wrap text-[11px]">
              {cliOut}
            </pre>
          )}
        </div>
      )}
    </div>
  );
};

interface DiffAiRiskCardProps {
  analyzingAi: boolean;
  aiAnalysis: RiskExplanation | null;
  onAnalyzeWithAI: () => void;
}

export const DiffAiRiskCard: React.FC<DiffAiRiskCardProps> = ({
  analyzingAi,
  aiAnalysis,
  onAnalyzeWithAI,
}) => (
  <div className="p-4 rounded-2xl bg-[#0c0e14] border border-white/[0.08] space-y-3">
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center space-x-1.5 min-w-0">
        <Bot className="w-4 h-4 text-cyan-400 shrink-0" />
        <span className="text-xs font-bold font-mono text-white truncate">LLM Risk Assistant</span>
      </div>
      <button
        onClick={onAnalyzeWithAI}
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

        <p className="text-zinc-300 text-[11px] leading-relaxed">{aiAnalysis.summary}</p>

        <div className="space-y-1 pt-2 border-t border-white/[0.06]">
          <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 block">
            Факторы риска:
          </span>
          {aiAnalysis.key_points.map((pt, i) => (
            <div key={i} className="flex items-start space-x-1.5 text-[11px] text-zinc-400">
              <span className="text-cyan-400 mt-0.5">•</span>
              <span>{pt}</span>
            </div>
          ))}
        </div>
      </div>
    )}
  </div>
);
