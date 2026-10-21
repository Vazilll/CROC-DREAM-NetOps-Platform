import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { Editor } from '@monaco-editor/react';
import { Save, RotateCcw, AlertTriangle, CheckCircle2, Plus, GitBranch, RefreshCw } from 'lucide-react';
import { api, getErrorMessage } from '../../api';
import type { IntentSaveResult } from '../../api';
import type { AppTheme } from '../layout/Header';

interface Props {
  deviceId: number;
  canEdit: boolean;
  theme?: AppTheme;
}

const SNIPPETS: { label: string; section: 'interfaces' | 'bgp' | 'acls'; block: string }[] = [
  {
    label: '+ L3 Интерфейс',
    section: 'interfaces',
    block: [
      '  - name: Ethernet3',
      '    description: Uplink / Peer Link',
      '    enabled: true',
      '    mode: l3',
      '    ipv4_address: 10.10.99.0/31',
      '    mtu: 9216',
    ].join('\n'),
  },
  {
    label: '+ L2 VLAN Порт',
    section: 'interfaces',
    block: [
      '  - name: Ethernet4',
      '    description: Server Access Port',
      '    enabled: true',
      '    mode: l2',
      '    access_vlan: 100',
      '    mtu: 1500',
    ].join('\n'),
  },
  {
    label: '+ Loopback',
    section: 'interfaces',
    block: [
      '  - name: Loopback1',
      '    description: VTEP / Service Loopback',
      '    enabled: true',
      '    mode: l3',
      '    ipv4_address: 10.255.255.101/32',
    ].join('\n'),
  },
  {
    label: '+ BGP Сосед',
    section: 'bgp',
    block: [
      '    - peer_ip: 10.10.99.1',
      '      remote_asn: 65199',
      '      description: Peer Router',
      '      announced_prefixes:',
      '        - 10.255.255.0/24',
    ].join('\n'),
  },
  {
    label: '+ ACL Фильтр',
    section: 'acls',
    block: [
      '  - name: PROTECT_CONTROL_PLANE',
      '    rules:',
      '      - sequence: 10',
      '        action: permit',
      '        protocol: tcp',
      '        source: 10.0.0.0/8',
      '        destination: any',
      '        dst_port: 179',
      '      - sequence: 20',
      '        action: permit',
      '        protocol: ip',
      '        source: any',
      '        destination: any',
    ].join('\n'),
  },
];

/** Редактор intent-YAML устройства (Git SoT). Сохранение валидируется на бэкенде. */
export const IntentEditor: React.FC<Props> = ({ deviceId, canEdit, theme = 'dark' }) => {
  const [original, setOriginal] = useState('');
  const [text, setText] = useState('');
  const [editable, setEditable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<IntentSaveResult | null>(null);

  const loadSource = useCallback(async () => {
    try {
      const src = await api.getIntentSource(deviceId);
      setOriginal(src.yaml);
      setText(src.yaml);
      setEditable(src.editable);
      setError('');
      setResult(null);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [deviceId]);

  useEffect(() => {
    setLoading(true);
    void loadSource();
  }, [loadSource]);

  const dirty = text !== original;
  const writable = canEdit && editable;

  const liveHint = useMemo(() => {
    if (!text.trim()) return 'Пустой YAML (нужен hostname)';
    if (text.includes('\t')) return 'Табуляция (Tab) запрещена — используйте 2 пробела';
    if (!/^hostname:\s*\S+/m.test(text)) return 'Укажите корневое поле hostname: <fqdn>';
    return null;
  }, [text]);

  const insertSnippet = (snippet: (typeof SNIPPETS)[number]) => {
    setResult(null);
    setText((prev) => {
      const clean = prev.replace(/\s+$/, '');
      if (snippet.section === 'interfaces') {
        if (/^interfaces:\s*\[\s*\]/m.test(clean)) {
          return clean.replace(/^interfaces:\s*\[\s*\]/m, `interfaces:\n${snippet.block}`) + '\n';
        }
        if (/^interfaces:/m.test(clean)) {
          const lines = clean.split('\n');
          const idx = lines.findIndex((l) => /^interfaces:/.test(l));
          lines.splice(idx + 1, 0, snippet.block);
          return lines.join('\n') + '\n';
        }
        return `${clean}\n\ninterfaces:\n${snippet.block}\n`;
      }
      if (snippet.section === 'bgp') {
        if (/^\s+neighbors:/m.test(clean)) {
          const lines = clean.split('\n');
          const idx = lines.findIndex((l) => /^\s+neighbors:/.test(l));
          lines.splice(idx + 1, 0, snippet.block);
          return lines.join('\n') + '\n';
        }
        return `${clean}\n\nbgp:\n  asn: 65101\n  router_id: 10.255.0.1\n  neighbors:\n${snippet.block}\n`;
      }
      if (/^acls:\s*\[\s*\]/m.test(clean)) {
        return clean.replace(/^acls:\s*\[\s*\]/m, `acls:\n${snippet.block}`) + '\n';
      }
      if (/^acls:/m.test(clean)) {
        return `${clean}\n${snippet.block}\n`;
      }
      return `${clean}\n\nacls:\n${snippet.block}\n`;
    });
  };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await api.saveIntentSource(deviceId, text);
      setResult(res);
      if (res.saved) {
        setOriginal(text);
        api.emitGitRefresh();
      }
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const handleSyncGit = async () => {
    if (syncing) return;
    setSyncing(true);
    setError('');
    try {
      await api.syncGitSot();
      await loadSource();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setSyncing(false);
    }
  };

  if (loading) return <div className="p-8 text-zinc-500 font-mono">Загрузка intent…</div>;

  return (
    <div className="flex flex-col h-full min-h-0 gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
        <span className="text-zinc-400 inline-flex items-center gap-1.5">
          <GitBranch className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
          <span>
            {writable
              ? 'Git SoT · intent/devices/*.yaml'
              : editable
              ? 'Только чтение (требуется Admin / Owner)'
              : 'Только чтение (нет шаблона)'}
          </span>
        </span>
        {writable && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSyncGit}
              disabled={syncing || saving}
              className="px-2.5 py-1 rounded-lg border border-white/[0.1] hover:border-white/[0.2] text-zinc-300 disabled:opacity-40 flex items-center gap-1.5 cursor-pointer"
              title="Синхронизировать с Git SoT и перечитать YAML"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-cyan-400 ${syncing ? 'animate-spin' : ''}`} />
              <span>{syncing ? 'Sync…' : 'Git Sync'}</span>
            </button>
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
              disabled={!dirty || saving || Boolean(liveHint)}
              className="px-3 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 disabled:opacity-40 flex items-center gap-1.5 cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              {saving ? 'Сохранение…' : 'Сохранить в Git SoT'}
            </button>
          </div>
        )}
      </div>

      {writable && (
        <div className="flex flex-wrap items-center gap-1.5 py-1">
          <span className="text-[11px] font-mono text-zinc-500 mr-1">Шаблоны:</span>
          {SNIPPETS.map((s) => (
            <button
              key={s.label}
              type="button"
              onClick={() => insertSnippet(s)}
              className="px-2 py-0.5 rounded-md bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/25 text-[11px] font-mono text-cyan-300 flex items-center gap-1 transition cursor-pointer"
            >
              <Plus className="w-3 h-3" />
              <span>{s.label.replace(/^\+\s*/, '')}</span>
            </button>
          ))}
        </div>
      )}

      {liveHint && (
        <div className="text-xs text-amber-400 font-mono flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span>{liveHint}</span>
        </div>
      )}
      {error && <div className="text-xs text-rose-400 font-mono">{error}</div>}
      {result?.saved && (
        <div className="text-xs text-emerald-400 font-mono flex items-center gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5" />
          Сохранено в Git SoT · Запустите Dry-run
        </div>
      )}
      {result && !result.saved && (
        <div className="text-xs font-mono rounded-lg border border-amber-500/30 bg-amber-500/[0.06] p-2 space-y-1">
          <div className="flex items-center gap-1.5 text-amber-400">
            <AlertTriangle className="w-3.5 h-3.5" />
            Ошибки валидации:
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

