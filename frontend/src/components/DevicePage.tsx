import React, { useEffect, useState } from 'react';
import { ArrowLeft, Play, ShieldCheck, Sparkles, AlertTriangle } from 'lucide-react';
import { api } from '../api';
import type { DeviceDetail, Forecast } from '../api';
import { ForecastChart } from './ForecastChart';
import { PLATFORM_NAMES, Panel, ROLE_NAMES, StatusBadge } from './ui';

interface Props {
  deviceId: number;
  onBack: () => void;
  onRunDryRun: (ids: number[]) => void;
  onScanDrift: (ids?: number[]) => void;
  onAskCopilot: (question: string) => void;
}

const TABS = ['Обзор', 'Интерфейсы', 'BGP', 'ACL', 'Прогноз'] as const;
type Tab = (typeof TABS)[number];

const METRICS = [
  { id: 'uplink_util_pct', label: 'Загрузка аплинка' },
  { id: 'cpu_pct', label: 'Загрузка CPU' },
];

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex justify-between py-1.5 text-[13px] border-b border-white/[0.04] last:border-0">
    <span className="text-zinc-400">{label}</span>
    <span className="text-zinc-100">{children}</span>
  </div>
);

const Th: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <th className="px-3 py-2 text-left text-[11px] uppercase tracking-wide font-medium text-zinc-500">{children}</th>
);

const ForecastTab: React.FC<{ deviceId: number }> = ({ deviceId }) => {
  const [metric, setMetric] = useState(METRICS[0].id);
  const [data, setData] = useState<Forecast | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setData(null);
    setError('');
    api.getForecast(deviceId, metric).then(setData).catch((e) => setError(e.message));
  }, [deviceId, metric]);

  return (
    <Panel
      title="Прогноз на 6 часов"
      accent="bg-indigo-600"
      right={
        <span className="flex gap-1">
          {METRICS.map((m) => (
            <button
              key={m.id}
              onClick={() => setMetric(m.id)}
              className={`px-2 py-0.5 rounded text-[11px] cursor-pointer ${metric === m.id ? 'bg-white/20' : 'hover:bg-white/10'}`}
            >
              {m.label}
            </button>
          ))}
        </span>
      }
    >
      {error && <div className="text-rose-400 text-sm">{error}</div>}
      {!data && !error && <div className="text-zinc-500 text-sm py-10 text-center">Считаем прогноз…</div>}
      {data && (
        <div className="space-y-3">
          {data.breach_in_minutes !== null ? (
            <div className="flex items-center gap-2 text-sm text-amber-300 bg-amber-500/10 rounded-md px-3 py-2">
              <AlertTriangle className="w-4 h-4" />
              «{data.label}» достигнет порога {data.threshold}% примерно через {data.breach_in_minutes} мин
            </div>
          ) : (
            <div className="text-sm text-emerald-400 bg-emerald-500/10 rounded-md px-3 py-2">
              В ближайшие 6 часов порог {data.threshold}% не будет достигнут
            </div>
          )}
          <ForecastChart data={data} />
          <div className="flex justify-between text-[11px] text-zinc-500">
            <span>Модель: {data.provider}. Полоса — квантили 10–90 %.</span>
            {data.simulated && <span className="text-amber-500/80">Телеметрия симулирована</span>}
          </div>
        </div>
      )}
    </Panel>
  );
};

export const DevicePage: React.FC<Props> = ({ deviceId, onBack, onRunDryRun, onScanDrift, onAskCopilot }) => {
  const [device, setDevice] = useState<DeviceDetail | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('Обзор');

  useEffect(() => {
    setDevice(null);
    setError('');
    api.getDevice(deviceId).then(setDevice).catch((e) => setError(e.message));
  }, [deviceId]);

  if (error) return <div className="text-rose-400">{error}</div>;
  if (!device) return <div className="text-zinc-500">Загрузка…</div>;

  const intent = device.intent;
  const btn = 'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium cursor-pointer transition-colors';

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="flex items-center gap-1 text-xs text-zinc-400 hover:text-white cursor-pointer">
        <ArrowLeft className="w-3.5 h-3.5" /> Устройства
      </button>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold text-white">{device.hostname}</h1>
          <StatusBadge status={device.status} />
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => onRunDryRun([device.id])} className={`${btn} bg-cyan-500 text-zinc-950 hover:bg-cyan-400`}>
            <Play className="w-3.5 h-3.5" /> Dry-run
          </button>
          <button onClick={() => onScanDrift([device.id])} className={`${btn} border border-white/[0.1] text-zinc-200 hover:bg-white/[0.05]`}>
            <ShieldCheck className="w-3.5 h-3.5" /> Скан дрейфа
          </button>
          <button
            onClick={() => onAskCopilot(`Оцени состояние устройства ${device.hostname} и что проверить в первую очередь`)}
            className={`${btn} border border-indigo-400/40 text-indigo-300 hover:bg-indigo-500/10`}
          >
            <Sparkles className="w-3.5 h-3.5" /> Спросить Copilot
          </button>
        </div>
      </div>

      <div className="flex gap-1 border-b border-white/[0.06]">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-[13px] border-b-2 -mb-px cursor-pointer ${tab === t ? 'border-cyan-400 text-white' : 'border-transparent text-zinc-400 hover:text-zinc-200'}`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'Обзор' && (
        <div className="grid md:grid-cols-2 gap-4">
          <Panel title="Устройство" accent="bg-cyan-700">
            <Field label="Роль">{ROLE_NAMES[device.role] ?? device.role}</Field>
            <Field label="Платформа">{PLATFORM_NAMES[device.platform] ?? device.platform}</Field>
            <Field label="Management IP"><span className="font-mono">{device.management_ip}:{device.management_port}</span></Field>
            <Field label="Профиль доступа">{device.auth_profile}</Field>
            <Field label="Проверено">{device.last_checked_at ? new Date(device.last_checked_at).toLocaleString('ru-RU') : '—'}</Field>
          </Panel>
          <Panel title="Intent" accent="bg-teal-700">
            {device.intent_issues.length > 0 && (
              <div className="mb-2 text-xs text-amber-300">Проблем в intent: {device.intent_issues.length}</div>
            )}
            <Field label="Интерфейсов">{intent?.interfaces.length ?? 0}</Field>
            <Field label="BGP ASN">{intent?.bgp?.asn ?? '—'}</Field>
            <Field label="BGP соседей">{intent?.bgp?.neighbors.length ?? 0}</Field>
            <Field label="ACL">{intent?.acls.length ?? 0}</Field>
          </Panel>
        </div>
      )}

      {tab === 'Интерфейсы' && (
        <div className="rounded-lg border border-white/[0.08] bg-[#0c0e14] overflow-hidden">
          <table className="w-full text-[13px]">
            <thead className="bg-white/[0.03]">
              <tr><Th>Интерфейс</Th><Th>Описание</Th><Th>IPv4</Th><Th>MTU</Th><Th>Состояние</Th></tr>
            </thead>
            <tbody>
              {intent?.interfaces.map((i) => (
                <tr key={i.name} className="border-t border-white/[0.05]">
                  <td className="px-3 py-2 text-cyan-300">{i.name}</td>
                  <td className="px-3 py-2 text-zinc-400">{i.description ?? '—'}</td>
                  <td className="px-3 py-2 font-mono text-zinc-300">{i.ipv4_address ?? '—'}</td>
                  <td className="px-3 py-2 font-mono text-zinc-400">{i.mtu}</td>
                  <td className="px-3 py-2">{i.enabled ? <span className="text-emerald-400">up</span> : <span className="text-zinc-500">shutdown</span>}</td>
                </tr>
              ))}
              {!intent?.interfaces.length && <tr><td colSpan={5} className="px-3 py-8 text-center text-zinc-500">Нет данных intent</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'BGP' && (
        <Panel title={intent?.bgp ? `AS ${intent.bgp.asn} · router-id ${intent.bgp.router_id}` : 'BGP'} accent="bg-sky-700">
          {intent?.bgp ? (
            <table className="w-full text-[13px]">
              <thead><tr><Th>Сосед</Th><Th>Remote AS</Th><Th>Описание</Th><Th>Анонсы</Th></tr></thead>
              <tbody>
                {intent.bgp.neighbors.map((n) => (
                  <tr key={n.peer_ip} className="border-t border-white/[0.05]">
                    <td className="px-3 py-2 font-mono text-cyan-300">{n.peer_ip}</td>
                    <td className="px-3 py-2 font-mono text-zinc-300">{n.remote_asn}</td>
                    <td className="px-3 py-2 text-zinc-400">{n.description ?? '—'}</td>
                    <td className="px-3 py-2 font-mono text-zinc-400">{n.announced_prefixes?.join(', ') ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="text-sm text-zinc-500">BGP на устройстве не настроен</div>
          )}
        </Panel>
      )}

      {tab === 'ACL' && (
        <div className="space-y-4">
          {intent?.acls.map((acl) => (
            <Panel key={acl.name} title={acl.name} accent="bg-zinc-700">
              {acl.rules.map((r) => (
                <div key={r.sequence} className="flex gap-3 py-1 font-mono text-xs text-zinc-300">
                  <span className="text-zinc-500 w-8">{r.sequence}</span>
                  <span className={r.action === 'permit' ? 'text-emerald-400 w-14' : 'text-rose-400 w-14'}>{r.action}</span>
                  <span className="w-12">{r.protocol}</span>
                  <span>{r.source} → {r.destination}</span>
                </div>
              ))}
            </Panel>
          ))}
          {!intent?.acls.length && <div className="text-sm text-zinc-500">ACL не заданы</div>}
        </div>
      )}

      {tab === 'Прогноз' && <ForecastTab deviceId={device.id} />}
    </div>
  );
};
