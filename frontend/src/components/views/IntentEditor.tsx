import React, { useEffect, useState } from 'react';
import { Editor } from '@monaco-editor/react';
import { Save, RotateCcw, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { api, getErrorMessage } from '../../api';
import type { IntentSaveResult } from '../../api';
import type { AppTheme } from '../layout/Header';

interface Props {
  deviceId: number;
  canEdit: boolean;
  theme?: AppTheme;
}

/** Редактор intent-YAML устройства (Git SoT). Сохранение валидируется на бэкенде. */
export const IntentEditor: React.FC<Props> = ({ deviceId, canEdit, theme = 'dark' }) => {
  const [original, setOriginal] = useState('');
  const [text, setText] = useState('');
  const [editable, setEditable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<IntentSaveResult | null>(null);

  useEffect(() => {
    let active = true;
    api
      .getIntentSource(deviceId)
      .then((src) => {
        if (!active) return;
        setOriginal(src.yaml);
        setText(src.yaml);
        setEditable(src.editable);
        setError('');
        setResult(null);
        setLoading(false);
      })
      .catch((e) => {
        if (!active) return;
        setError(getErrorMessage(e));
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [deviceId]);

  const dirty = text !== original;
  const writable = canEdit && editable;

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await api.saveIntentSource(deviceId, text);
      setResult(res);
      if (res.saved) setOriginal(text);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-8 text-zinc-500 font-mono">Загрузка intent…</div>;

  return (
    <div className="flex flex-col h-full min-h-0 gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
        <span className="text-zinc-400">
          {writable
            ? 'Источник истины (intent/devices/*.yaml). После сохранения запустите Dry-run — intended-конфиг перегенерируется из шаблонов.'
            : editable
            ? 'Только просмотр: изменение intent доступно роли Admin/Owner.'
            : 'Для платформы нет шаблонов генерации — intent только для чтения.'}
        </span>
        {writable && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setText(original);
                setResult(null);
              }}
              disabled={!dirty || saving}
              className="px-2.5 py-1 rounded-lg border border-white/[0.1] text-zinc-300 disabled:opacity-40 flex items-center gap-1.5 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Сбросить
            </button>
            <button
              onClick={save}
              disabled={!dirty || saving}
              className="px-3 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 disabled:opacity-40 flex items-center gap-1.5 cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              {saving ? 'Сохранение…' : 'Сохранить в Git SoT'}
            </button>
          </div>
        )}
      </div>

      {error && <div className="text-xs text-rose-400 font-mono">{error}</div>}
      {result?.saved && (
        <div className="text-xs text-emerald-400 font-mono flex items-center gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5" />
          Сохранено. Дальше: Dry-run → Deploy (или «Коммит в Git»).
        </div>
      )}
      {result && !result.saved && (
        <div className="text-xs font-mono rounded-lg border border-amber-500/30 bg-amber-500/[0.06] p-2 space-y-1">
          <div className="flex items-center gap-1.5 text-amber-400">
            <AlertTriangle className="w-3.5 h-3.5" />
            Не сохранено — исправьте ошибки:
          </div>
          {result.issues.map((i, idx) => (
            <div key={idx} className="text-amber-200">
              {i.field ? `${i.field}: ` : ''}
              {i.message}
            </div>
          ))}
        </div>
      )}

      <div className="flex-1 min-h-[300px] rounded-xl overflow-hidden border border-white/[0.04]">
        <Editor
          height="100%"
          theme={theme === 'light' ? 'vs' : 'vs-dark'}
          language="yaml"
          value={text}
          onChange={(v) => setText(v ?? '')}
          options={{
            readOnly: !writable,
            minimap: { enabled: false },
            fontSize: 12,
            scrollBeyondLastLine: false,
            tabSize: 2,
          }}
        />
      </div>
    </div>
  );
};
