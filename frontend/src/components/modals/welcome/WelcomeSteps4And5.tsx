import React from 'react';
import { ArrowRight, CheckCircle2, RefreshCw } from 'lucide-react';
import type { DiscoveredSwitchItem, LlmCascadeConfig, ServerDiscoveryResponse } from '../../../api';
import {
  LLM_PRESETS,
  inputClass,
  primaryBtnClass,
  secondaryBtnClass,
  type WizardStep,
} from './WelcomeStepStyles';

interface WelcomeAiStepProps {
  isEn: boolean;
  llmCascade: LlmCascadeConfig[];
  setLlmCascade: React.Dispatch<React.SetStateAction<LlmCascadeConfig[]>>;
  aiSavedMsg: string;
  savingAi: boolean;
  onSaveAiCluster: () => void;
  setWizardStep: (step: WizardStep) => void;
}

export const WelcomeAiStep: React.FC<WelcomeAiStepProps> = ({
  isEn,
  llmCascade,
  setLlmCascade,
  aiSavedMsg,
  savingAi,
  onSaveAiCluster,
  setWizardStep,
}) => (
  <div className="space-y-3">
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-main)]/60 p-3 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-mono font-semibold">LLM Cascade ({llmCascade.length})</span>
        <button
          type="button"
          onClick={() =>
            setLlmCascade((prev) => [
              ...prev,
              { name: '', base_url: '', model: '', api_key: '', timeout_seconds: 2.5 },
            ])
          }
          className="px-2 py-0.5 rounded border border-emerald-500/40 bg-emerald-500/10 text-[10px] font-mono text-emerald-500 cursor-pointer"
        >
          + Provider
        </button>
      </div>

      <div className="flex items-center gap-1 flex-wrap">
        {LLM_PRESETS.map((preset) => (
          <button
            key={preset.name}
            type="button"
            onClick={() =>
              setLlmCascade((prev) => {
                const row: LlmCascadeConfig = { ...preset, api_key: '' };
                const isEmptyFirst =
                  prev.length === 1 && !prev[0].name.trim() && !(prev[0].api_key || '').trim();
                return isEmptyFirst ? [row] : [...prev, row];
              })
            }
            className="px-2 py-0.5 rounded border border-[var(--border-subtle)] bg-[var(--bg-card)] text-[10px] font-mono text-[var(--text-secondary)] hover:text-emerald-500 cursor-pointer"
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div className="space-y-1.5 max-h-48 overflow-y-auto">
        {llmCascade.map((item, idx) => (
          <div
            key={idx}
            className="rounded border border-[var(--border-subtle)] bg-[var(--bg-card)] p-1.5 flex items-center gap-1.5"
          >
            <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-500 text-[10px] font-mono font-bold">
              #{idx + 1}
            </span>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 flex-1">
              <input
                type="text"
                value={item.name}
                onChange={(e) =>
                  setLlmCascade((prev) =>
                    prev.map((p, i) => (i === idx ? { ...p, name: e.target.value } : p))
                  )
                }
                placeholder="Name"
                className={inputClass}
              />
              <input
                type="text"
                value={item.model}
                onChange={(e) =>
                  setLlmCascade((prev) =>
                    prev.map((p, i) => (i === idx ? { ...p, model: e.target.value } : p))
                  )
                }
                placeholder="Model"
                className={inputClass}
              />
              <input
                type="text"
                value={item.base_url}
                onChange={(e) =>
                  setLlmCascade((prev) =>
                    prev.map((p, i) => (i === idx ? { ...p, base_url: e.target.value } : p))
                  )
                }
                placeholder="Base URL"
                className={inputClass}
              />
              <input
                type="password"
                value={item.api_key || ''}
                onChange={(e) =>
                  setLlmCascade((prev) =>
                    prev.map((p, i) => (i === idx ? { ...p, api_key: e.target.value } : p))
                  )
                }
                placeholder="API Key"
                className={inputClass}
              />
            </div>
            <button
              type="button"
              onClick={() => setLlmCascade((prev) => prev.filter((_, i) => i !== idx))}
              className="px-1.5 py-1 text-xs font-mono text-rose-500 cursor-pointer"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>

    {aiSavedMsg && (
      <div className="text-xs font-mono text-rose-500 bg-rose-500/10 border border-rose-500/20 rounded px-3 py-1.5">
        {aiSavedMsg}
      </div>
    )}

    <div className="flex items-center justify-between pt-1">
      <button type="button" onClick={() => setWizardStep(3)} className={secondaryBtnClass}>
        ← {isEn ? 'Back' : 'Назад'}
      </button>
      <button type="button" onClick={onSaveAiCluster} disabled={savingAi} className={primaryBtnClass}>
        <span>{isEn ? 'Next' : 'Далее'}</span>
        <ArrowRight className="w-3.5 h-3.5" />
      </button>
    </div>
  </div>
);

interface WelcomeServerStepProps {
  isEn: boolean;
  serverHost: string;
  setServerHost: (v: string) => void;
  serverPort: number;
  setServerPort: (v: number) => void;
  serverUser: string;
  setServerUser: (v: string) => void;
  serverPassword: string;
  setServerPassword: (v: string) => void;
  discoveringServer: boolean;
  discoveryResult: ServerDiscoveryResponse | null;
  onDiscoverServer: () => void;
  onDiscoverOffline: () => void;
  onFinishWizard: () => void;
  setWizardStep: (step: WizardStep) => void;
}

export const WelcomeServerStep: React.FC<WelcomeServerStepProps> = ({
  isEn,
  serverHost,
  setServerHost,
  serverPort,
  setServerPort,
  serverUser,
  setServerUser,
  serverPassword,
  setServerPassword,
  discoveringServer,
  discoveryResult,
  onDiscoverServer,
  onDiscoverOffline,
  onFinishWizard,
  setWizardStep,
}) => (
  <div className="space-y-3.5">
    <div className="grid grid-cols-3 gap-2.5">
      <div className="col-span-2">
        <label className="block text-[11px] font-mono text-[var(--text-secondary)] mb-1">
          {isEn ? 'Host' : 'Хост'}
        </label>
        <input
          type="text"
          value={serverHost}
          onChange={(e) => setServerHost(e.target.value)}
          placeholder="5.228.243.54"
          className={inputClass}
        />
      </div>
      <div>
        <label className="block text-[11px] font-mono text-[var(--text-secondary)] mb-1">
          {isEn ? 'SSH Port' : 'SSH Порт'}
        </label>
        <input
          type="number"
          value={serverPort}
          onChange={(e) => setServerPort(Number(e.target.value) || 221)}
          placeholder="221"
          className={inputClass}
        />
      </div>
    </div>

    <div>
      <label className="block text-[11px] font-mono text-[var(--text-secondary)] mb-1">
        {isEn ? 'SSH User' : 'Пользователь SSH'}
      </label>
      <input
        type="text"
        value={serverUser}
        onChange={(e) => setServerUser(e.target.value)}
        className={inputClass}
      />
    </div>

    <div>
      <label className="block text-[11px] font-mono text-[var(--text-secondary)] mb-1">
        {isEn ? 'SSH Password' : 'Пароль SSH'}
      </label>
      <div className="flex flex-wrap sm:flex-nowrap gap-2">
        <input
          type="password"
          value={serverPassword}
          onChange={(e) => setServerPassword(e.target.value)}
          placeholder="SSH password"
          className={inputClass}
        />
        <button
          type="button"
          onClick={onDiscoverServer}
          disabled={discoveringServer}
          className="px-3.5 py-1.5 rounded-md bg-emerald-500 hover:bg-emerald-400 text-zinc-950 text-xs font-semibold flex items-center gap-1.5 cursor-pointer shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${discoveringServer ? 'animate-spin' : ''}`} />
          <span>{discoveringServer ? '...' : isEn ? 'Connect SSH' : 'Подключить'}</span>
        </button>
        <button
          type="button"
          onClick={onDiscoverOffline}
          disabled={discoveringServer}
          className={secondaryBtnClass}
        >
          <span>{isEn ? 'Offline (Git SoT)' : 'Офлайн-стенд (Git SoT)'}</span>
        </button>
      </div>
    </div>

    {discoveryResult?.discovered_switches && (
      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2.5 space-y-2">
        <div className="text-xs font-semibold text-emerald-500 flex items-center gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5" />
          <span>
            {isEn ? 'Nodes:' : 'Узлов:'} {discoveryResult.synced_total}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {discoveryResult.discovered_switches.map((sw: DiscoveredSwitchItem) => (
            <div
              key={sw.hostname}
              className="rounded border border-[var(--border-subtle)] bg-[var(--bg-main)] px-2.5 py-1.5 flex items-center justify-between text-[11px] font-mono"
            >
              <span className="truncate font-semibold">{sw.hostname}</span>
              <span className={sw.reachable ? 'text-emerald-500' : 'text-rose-500'}>
                {sw.reachable ? 'SSH OK' : 'OFFLINE'}
              </span>
            </div>
          ))}
        </div>
      </div>
    )}

    {discoveryResult?.status === 'error' && discoveryResult.message && (
      <div className="text-xs font-mono text-rose-500 bg-rose-500/10 border border-rose-500/20 rounded px-3 py-1.5">
        {discoveryResult.message}
      </div>
    )}

    <div className="flex items-center justify-between pt-1">
      <button type="button" onClick={() => setWizardStep(4)} className={secondaryBtnClass}>
        ← {isEn ? 'Back' : 'Назад'}
      </button>
      <button type="button" onClick={onFinishWizard} className={primaryBtnClass}>
        <span>{isEn ? 'Launch Console' : 'Открыть пульт'}</span>
        <ArrowRight className="w-3.5 h-3.5" />
      </button>
    </div>
  </div>
);
