import React, { useEffect, useRef, useState } from 'react';
import {
  Send,
  Sparkles,
  X,
  Play,
  Wrench,
  GitCompare,
  ShieldCheck,
  ExternalLink,
} from 'lucide-react';
import { api, type CopilotAction, type CopilotReplyWithAction } from '../api';
export type { CopilotAction, CopilotReplyWithAction };
import { translations, type Locale } from '../i18n';

interface Message {
  role: 'user' | 'ai';
  text: string;
  provider?: string;
  action?: CopilotAction | null;
}

export interface CopilotPanelProps {
  open: boolean;
  onClose: () => void;
  deviceId: number | null;
  locale?: Locale;
  request: { text: string; n: number } | null;
  activeScreen?: string | null;
  onRunDryRun?: (deviceIds: number[]) => void;
  onOpenDiff?: (deviceId?: number) => void;
  onScanDrift?: (deviceIds?: number[]) => void;
  onOpenDevice?: (deviceId: number) => void;
  onRemediate?: (deviceId: number) => void;
  onOpenTab?: (tab: string) => void;
}

export const CopilotPanel: React.FC<CopilotPanelProps> = ({
  open,
  onClose,
  deviceId,
  locale = 'ru',
  request,
  activeScreen = 'dashboard',
  onRunDryRun,
  onOpenDiff,
  onScanDrift,
  onOpenDevice,
  onRemediate,
  onOpenTab,
}) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const lastRequest = useRef(0);

  const send = React.useCallback(async (text: string) => {
    if (!text.trim() || busy) return;
    setMessages((m) => [...m, { role: 'user', text }]);
    setInput('');
    setBusy(true);

    try {
      const reply = await api.askCopilot(text, deviceId, activeScreen);
      setMessages((m) => [
        ...m,
        {
          role: 'ai',
          text: reply.answer,
          provider: reply.provider,
          action: reply.action,
        },
      ]);
    } catch (e) {
      setMessages((m) => [
        ...m,
        { role: 'ai', text: `Ошибка взаимодействия с Copilot: ${(e as Error).message}` },
      ]);
    } finally {
      setBusy(false);
    }
  }, [busy, deviceId, activeScreen]);

  const handleExecuteAction = (action: CopilotAction) => {
    switch (action.type) {
      case 'dry_run': {
        const ids =
          action.device_ids && action.device_ids.length > 0
            ? action.device_ids
            : action.device_id
            ? [action.device_id]
            : deviceId
            ? [deviceId]
            : [];
        if (onRunDryRun) {
          onRunDryRun(ids);
        }
        break;
      }
      case 'remediate': {
        if (action.device_id && onRemediate) {
          onRemediate(action.device_id);
        } else if (onScanDrift) {
          const targetIds = action.device_ids && action.device_ids.length > 0 ? action.device_ids : undefined;
          onScanDrift(targetIds);
        }
        break;
      }
      case 'open_diff': {
        if (onOpenDiff) {
          onOpenDiff(action.device_id ?? undefined);
        } else if (onOpenTab) {
          onOpenTab('diff');
        }
        break;
      }
      case 'open_device': {
        if (action.device_id && onOpenDevice) {
          onOpenDevice(action.device_id);
        } else if (onOpenTab) {
          onOpenTab('devices');
        }
        break;
      }
      case 'scan_drift': {
        if (onScanDrift) {
          const targetIds = action.device_ids && action.device_ids.length > 0 ? action.device_ids : undefined;
          onScanDrift(targetIds);
        } else if (onOpenTab) {
          onOpenTab('drift');
        }
        break;
      }
    }
  };

  useEffect(() => {
    if (request && request.n !== lastRequest.current) {
      lastRequest.current = request.n;
      void send(request.text);
    }
  }, [request, send]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, busy]);


  const t = translations[locale];
  const suggestions = [
    t.copilotSuggestion1,
    t.copilotSuggestion2,
    t.copilotSuggestion3,
  ];

  if (!open) return null;

  return (
    <aside className="fixed right-0 top-14 bottom-0 w-[400px] max-w-full z-40 bg-white dark:bg-[#0a0b0f] border-l border-slate-200 dark:border-white/[0.08] flex flex-col shadow-2xl backdrop-blur-md">
      {/* Header */}
      <div className="flex items-center justify-between px-4 h-12 border-b border-slate-200 dark:border-white/[0.06] bg-slate-50 dark:bg-[#10121a]/80">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-indigo-500 dark:text-cyan-400" />
          <span className="text-sm font-semibold text-slate-900 dark:text-white tracking-tight">{t.copilotTitle}</span>
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-200/70 dark:bg-white/[0.05] text-slate-700 dark:text-zinc-400 border border-slate-300 dark:border-white/[0.06]">
            {activeScreen || 'dashboard'}
          </span>
        </div>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-slate-700 dark:text-zinc-400 dark:hover:text-white transition-colors p-1 rounded hover:bg-slate-100 dark:hover:bg-white/[0.05] cursor-pointer"
          title={locale === 'en' ? 'Close (Esc)' : 'Закрыть (Esc)'}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Messages Scroll Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3.5 text-xs bg-slate-100/60 dark:bg-transparent">
        {messages.length === 0 && (
          <div className="space-y-3">
            {locale === 'en' ? (
              <p className="text-slate-600 dark:text-zinc-400 leading-relaxed">
                Contextual AI assistant for the CLOS fabric. Analyzes current screen (
                <span className="text-indigo-600 dark:text-cyan-300 font-mono font-semibold">{activeScreen}</span>), Git SoT state,
                drift, and TimesFM ML forecasts.
              </p>
            ) : (
              <p className="text-slate-600 dark:text-zinc-400 leading-relaxed">
                Контекстный AI-ассистент фабрики CLOS. Анализирует текущий экран (
                <span className="text-indigo-600 dark:text-cyan-300 font-mono font-semibold">{activeScreen}</span>), состояние Git SoT,
                дрейф и ML-прогнозы TimesFM.
              </p>
            )}
            <div className="space-y-1.5">
              <span className="text-[11px] font-semibold text-slate-400 dark:text-zinc-500 uppercase tracking-wider">
                {locale === 'en' ? 'Quick Prompts' : 'Быстрые вопросы'}
              </span>
              {suggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => void send(s)}
                  className="block w-full text-left px-3 py-2 rounded-xl border border-slate-200 dark:border-white/[0.06] bg-white dark:bg-white/[0.02] text-slate-700 dark:text-zinc-300 hover:bg-indigo-50 dark:hover:bg-white/[0.05] hover:text-indigo-600 dark:hover:text-white hover:border-indigo-200 dark:hover:border-white/[0.12] transition-colors cursor-pointer text-xs shadow-2xs"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'text-right' : 'text-left'}>
            <div
              className={`inline-block max-w-[90%] text-left whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 leading-relaxed shadow-xs ${
                m.role === 'user'
                  ? 'bg-indigo-600 text-white rounded-tr-xs shadow-indigo-500/10'
                  : 'bg-white dark:bg-[#121520] text-slate-800 dark:text-zinc-200 border border-slate-200/80 dark:border-white/[0.07] rounded-tl-xs'
              }`}
            >
              <div>{m.text}</div>

              {/* 1-Click Action Resolution Button */}
              {m.action && (
                <div className="mt-2.5 pt-2 border-t border-white/[0.08] flex items-center justify-start">
                  <button
                    onClick={() => handleExecuteAction(m.action!)}
                    className={`px-3 py-1.5 rounded text-xs font-mono font-medium flex items-center gap-1.5 transition-all shadow-sm cursor-pointer ${
                      m.action.type === 'dry_run'
                        ? 'bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 shadow-emerald-500/10'
                        : m.action.type === 'remediate'
                        ? 'bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 shadow-amber-500/10'
                        : m.action.type === 'open_diff'
                        ? 'bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border border-cyan-500/30 shadow-cyan-500/10'
                        : m.action.type === 'scan_drift'
                        ? 'bg-violet-500/15 hover:bg-violet-500/25 text-violet-300 border border-violet-500/30 shadow-violet-500/10'
                        : 'bg-white/[0.08] hover:bg-white/[0.14] text-zinc-200 border border-white/[0.1]'
                    }`}
                    title={`Выполнить: ${m.action.label}`}
                  >
                    {m.action.type === 'dry_run' && <Play className="w-3.5 h-3.5 fill-current" />}
                    {m.action.type === 'remediate' && <Wrench className="w-3.5 h-3.5" />}
                    {m.action.type === 'open_diff' && <GitCompare className="w-3.5 h-3.5" />}
                    {m.action.type === 'scan_drift' && <ShieldCheck className="w-3.5 h-3.5" />}
                    {m.action.type === 'open_device' && <ExternalLink className="w-3.5 h-3.5" />}
                    <span>{m.action.label}</span>
                  </button>
                </div>
              )}
            </div>

            {m.provider && (
              <div className="text-[10px] text-zinc-500 font-mono mt-1 px-1">
                {m.provider}
              </div>
            )}
          </div>
        ))}

        {busy && (
          <div className="text-zinc-400 text-xs flex items-center gap-2 p-2 bg-white/[0.02] rounded border border-white/[0.04]">
            <Sparkles className="w-3.5 h-3.5 text-cyan-400 animate-spin" />
            <span className="animate-pulse">
              {locale === 'en' ? 'Copilot is formulating an answer…' : 'Copilot формулирует ответ…'}
            </span>
          </div>
        )}
        <div ref={bottom} />
      </div>

      {/* Input Field */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
        className="p-3 border-t border-slate-200 dark:border-white/[0.06] bg-slate-50 dark:bg-[#0c0e14] flex gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            deviceId
              ? locale === 'en'
                ? 'Ask about selected node…'
                : 'Вопрос про выбранное устройство…'
              : t.copilotPlaceholder
          }
          className="flex-1 bg-white dark:bg-zinc-900 border border-slate-300 dark:border-white/[0.08] rounded-xl px-3.5 py-2 text-xs text-slate-900 dark:text-zinc-200 placeholder:text-slate-400 dark:placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500 dark:focus:border-cyan-500/60 transition-colors"
        />
        <button
          disabled={busy || !input.trim()}
          className="px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium disabled:opacity-40 cursor-pointer transition-colors flex items-center justify-center shadow-xs"
          title={locale === 'en' ? 'Send prompt' : 'Отправить запрос'}
        >
          <Send className="w-3.5 h-3.5" />
        </button>
      </form>
    </aside>
  );
};
