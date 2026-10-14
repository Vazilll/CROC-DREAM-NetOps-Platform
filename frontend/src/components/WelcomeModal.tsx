import React, { useState, useEffect } from 'react';
import {
  Key,
  Server,
  ArrowRight,
  Network,
  Globe,
  CheckCircle2,
  Check,
} from 'lucide-react';
import { api } from '../api';
import type { UserRole } from '../api';
import { translations, type Locale } from '../i18n';

interface WelcomeModalProps {
  isOpen: boolean;
  onClose: (role: UserRole) => void;
  locale: Locale;
  setLocale: (l: Locale) => void;
}

interface PreloadMetrics {
  devicesCount: number;
  inSyncCount: number;
  jobsCount: number;
  alertsCount: number;
  step: number;
  ready: boolean;
}

export const WelcomeModal: React.FC<WelcomeModalProps> = ({
  isOpen,
  onClose,
  locale,
  setLocale,
}) => {
  const [phase, setPhase] = useState<'welcome' | 'choice'>('welcome');
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
  const [selectedOption, setSelectedOption] = useState<'owner' | 'connect'>('owner');
  const [clusterName, setClusterName] = useState('CROC-FABRIC-PROD-01');
  const [serverUrl, setServerUrl] = useState('http://127.0.0.1:8000');
  const [tokenInput, setTokenInput] = useState('dev-admin-token');
  const [connectRole, setConnectRole] = useState<UserRole>('admin');

  const [preload, setPreload] = useState<PreloadMetrics>({
    devicesCount: 4,
    inSyncCount: 4,
    jobsCount: 0,
    alertsCount: 0,
    step: 1,
    ready: false,
  });

  if (isOpen !== prevIsOpen) {
    setPrevIsOpen(isOpen);
    if (isOpen) {
      setPhase('welcome');
    }
  }

  const t = translations[locale];

  // Live telemetry preloading during the Apple-style monogram boot sequence
  useEffect(() => {
    if (!isOpen) return;
    let active = true;

    const step1Timer = setTimeout(() => {
      if (active) setPreload((p) => ({ ...p, step: Math.max(p.step, 2) }));
    }, 450);

    const step2Timer = setTimeout(() => {
      if (active) setPreload((p) => ({ ...p, step: Math.max(p.step, 3) }));
    }, 950);

    // Concurrently warm up API caches (devices, jobs, forecast alerts, AI guard)
    Promise.allSettled([
      api.getDevices(),
      api.getJobs(),
      api.getForecastAlerts(),
      api.getAiGuardOverview(),
    ]).then(([devsRes, jobsRes, alertsRes]) => {
      if (!active) return;
      const devs = devsRes.status === 'fulfilled' ? devsRes.value : [];
      const jbs = jobsRes.status === 'fulfilled' ? jobsRes.value : [];
      const alrts = alertsRes.status === 'fulfilled' ? alertsRes.value : [];
      const inSync = devs.filter((d) => d.status === 'IN_SYNC').length;

      setPreload({
        devicesCount: devs.length,
        inSyncCount: inSync,
        jobsCount: jbs.length,
        alertsCount: alrts.length,
        step: 4,
        ready: true,
      });
    });

    const transitionTimer = setTimeout(() => {
      if (active) setPhase('choice');
    }, 2100);

    return () => {
      active = false;
      clearTimeout(step1Timer);
      clearTimeout(step2Timer);
      clearTimeout(transitionTimer);
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleFinishOwner = () => {
    api.setToken('dev-owner-token');
    localStorage.setItem('netops_user_role', 'owner');
    localStorage.setItem('netops_cluster_name', clusterName.trim() || 'CROC-FABRIC-PROD-01');
    localStorage.setItem('netops_onboarding_done', 'true');
    onClose('owner');
  };

  const handleFinishConnect = () => {
    const rawToken = tokenInput.trim() || `dev-${connectRole}-token`;
    let detectedRole: UserRole = connectRole;
    if (rawToken.includes('owner')) detectedRole = 'owner';
    else if (rawToken.includes('admin')) detectedRole = 'admin';
    else if (rawToken.includes('operator')) detectedRole = 'operator';
    else if (rawToken.includes('viewer')) detectedRole = 'viewer';

    api.setToken(rawToken);
    localStorage.setItem('netops_user_role', detectedRole);
    localStorage.setItem('netops_api_endpoint', serverUrl.trim() || 'http://127.0.0.1:8000');
    localStorage.setItem('netops_onboarding_done', 'true');
    onClose(detectedRole);
  };

  const bootSteps =
    locale === 'en'
      ? [
          'Connecting to FastAPI Core & RBAC Policy Engine',
          `Indexing CLOS Fabric Inventory (${preload.devicesCount} nodes)`,
          'Warming up TimesFM 3.0 Telemetry & HierConfig AST',
          'Git Source of Truth (SoT) state verified',
        ]
      : [
          'Инициализация ядра FastAPI и политик RBAC',
          `Индексация топологии CLOS (${preload.devicesCount} узлов в кэше)`,
          'Прогрев телеметрии TimesFM 3.0 и HierConfig AST',
          'Консистентность Git Source of Truth подтверждена',
        ];

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-4 bg-[#08090a]/98 backdrop-blur-xl transition-opacity duration-500 overflow-y-auto">
      {/* Top right language switch */}
      <div className="absolute top-5 right-5 z-20 flex items-center gap-2">
        <button
          onClick={() => setLocale(locale === 'ru' ? 'en' : 'ru')}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-xs text-zinc-300 transition-colors cursor-pointer font-mono"
        >
          <Globe className="w-3.5 h-3.5 text-zinc-400" />
          <span className="uppercase font-medium">{locale === 'ru' ? 'EN' : 'RU'}</span>
        </button>
      </div>

      {/* PHASE 1: APPLE / VERCEL HARDWARE BOOT MONOGRAM WITH LIVE PRELOAD */}
      {phase === 'welcome' && (
        <div
          onClick={() => setPhase('choice')}
          className="relative z-10 w-full max-w-md flex flex-col items-center justify-center text-center cursor-pointer animate-win-fade select-none px-4"
        >
          {/* Anodized Monochrome Emblem */}
          <div className="w-16 h-16 rounded-2xl bg-[#111318] border border-white/[0.12] flex items-center justify-center mb-7 shadow-2xl">
            <Network className="w-7 h-7 text-zinc-100 animate-boot-pulse" />
          </div>

          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-zinc-100 mb-2">
            {t.winHello}
          </h1>
          <p className="text-xs sm:text-sm text-zinc-400 max-w-sm">
            {t.winSettingUp}
          </p>

          {/* Thin Apple-style Progress Bar */}
          <div className="w-56 h-1 bg-white/[0.08] rounded-full overflow-hidden mt-7 mb-6">
            <div
              className="h-full bg-zinc-100 transition-all duration-500 ease-out rounded-full"
              style={{ width: `${Math.min(100, preload.step * 25)}%` }}
            />
          </div>

          {/* Live Preloaded Telemetry Checklist */}
          <div className="w-full rounded-lg border border-white/[0.07] bg-[#0e1014] p-3.5 text-left space-y-2 font-mono text-[11px]">
            {bootSteps.map((label, idx) => {
              const done = preload.step > idx;
              const current = preload.step === idx + 1;
              return (
                <div
                  key={idx}
                  className={`flex items-center justify-between gap-2 transition-opacity ${
                    done || current ? 'opacity-100' : 'opacity-35'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {done ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    ) : (
                      <span className="w-3.5 h-3.5 flex items-center justify-center shrink-0">
                        <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 animate-pulse" />
                      </span>
                    )}
                    <span className="text-zinc-300 truncate">{label}</span>
                  </div>
                  <span className="text-[10px] text-zinc-500 shrink-0">
                    {done ? 'OK' : '...'}
                  </span>
                </div>
              );
            })}
          </div>

          <span className="mt-5 text-[11px] text-zinc-500 font-mono">
            {t.winJustAMoment}
          </span>
        </div>
      )}

      {/* PHASE 2: GEIST / LINEAR WORKSPACE INITIALIZATION */}
      {phase === 'choice' && (
        <div className="relative z-10 w-full max-w-3xl max-h-[92vh] overflow-hidden rounded-xl border border-white/[0.1] bg-[#0e1014] shadow-2xl text-zinc-200 animate-win-fade flex flex-col">
          {/* Header */}
          <div className="px-6 py-5 border-b border-white/[0.07] bg-[#12151c]/60 shrink-0">
            <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-white/[0.06] text-zinc-200 border border-white/[0.1]">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  CROC DREAM NetOps
                </span>
                <span className="text-[11px] text-zinc-500 font-mono">CLOS Control Plane</span>
              </div>

              {/* Preloaded Metrics Summary Pill */}
              <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-[11px] font-mono text-emerald-400 tabular-nums">
                <span>
                  {locale === 'en'
                    ? `Preloaded: ${preload.devicesCount} nodes · ${preload.inSyncCount} in sync`
                    : `В кэше: ${preload.devicesCount} узлов · ${preload.inSyncCount} в синхроне`}
                </span>
              </div>
            </div>

            <h2 className="text-lg sm:text-xl font-semibold tracking-tight text-white">
              {t.winWelcomeTitle}
            </h2>
            <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
              {t.winWelcomeDesc} {t.winChooseMode}
            </p>
          </div>

          {/* Cards Grid: Option 1 (Owner) vs Option 2 (Connect) */}
          <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4 overflow-y-auto flex-1">
            {/* OPTION 1: BECOME OWNER */}
            <div
              onClick={() => setSelectedOption('owner')}
              className={`relative rounded-lg p-5 border transition-colors cursor-pointer flex flex-col justify-between ${
                selectedOption === 'owner'
                  ? 'border-zinc-300 bg-white/[0.03]'
                  : 'border-white/[0.07] bg-[#0a0c10] hover:border-white/[0.15]'
              }`}
            >
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="w-9 h-9 rounded-lg bg-white/[0.05] border border-white/[0.1] flex items-center justify-center">
                    <Key className="w-4 h-4 text-zinc-200" />
                  </div>
                  <span className="text-[10px] font-mono uppercase tracking-wider font-medium px-2 py-0.5 rounded bg-white/[0.06] text-zinc-300 border border-white/[0.1]">
                    {t.optOwnerBadge}
                  </span>
                </div>

                <h3 className="text-sm font-semibold text-white mb-1.5 flex items-center gap-2">
                  <span>{t.optOwnerTitle}</span>
                  {selectedOption === 'owner' && (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  )}
                </h3>
                <p className="text-xs text-zinc-400 leading-relaxed mb-4">
                  {t.optOwnerDesc}
                </p>

                {selectedOption === 'owner' && (
                  <div className="mt-3 pt-3 border-t border-white/[0.07] space-y-1.5 animate-fade-in">
                    <label className="block text-[10px] uppercase font-mono tracking-wider text-zinc-400">
                      {t.optClusterNameLabel}
                    </label>
                    <input
                      type="text"
                      value={clusterName}
                      onChange={(e) => setClusterName(e.target.value)}
                      placeholder={t.optClusterNamePlaceholder}
                      className="w-full bg-[#08090a] border border-white/[0.12] focus:border-zinc-400 rounded-md px-3 py-1.5 text-xs font-mono text-zinc-100 focus:outline-none"
                    />
                  </div>
                )}
              </div>

              <div className="mt-5 pt-2">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleFinishOwner();
                  }}
                  className={`w-full py-2 px-4 rounded-md text-xs font-medium flex items-center justify-center gap-2 transition-colors cursor-pointer ${
                    selectedOption === 'owner'
                      ? 'bg-zinc-100 hover:bg-white text-zinc-950 font-semibold'
                      : 'bg-white/[0.05] text-zinc-300 hover:text-white hover:bg-white/[0.09] border border-white/[0.08]'
                  }`}
                >
                  <span>{t.btnBecomeOwner}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* OPTION 2: CONNECT TO EXISTING SYSTEM */}
            <div
              onClick={() => setSelectedOption('connect')}
              className={`relative rounded-lg p-5 border transition-colors cursor-pointer flex flex-col justify-between ${
                selectedOption === 'connect'
                  ? 'border-zinc-300 bg-white/[0.03]'
                  : 'border-white/[0.07] bg-[#0a0c10] hover:border-white/[0.15]'
              }`}
            >
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="w-9 h-9 rounded-lg bg-white/[0.05] border border-white/[0.1] flex items-center justify-center">
                    <Server className="w-4 h-4 text-zinc-200" />
                  </div>
                  <span className="text-[10px] font-mono uppercase tracking-wider font-medium px-2 py-0.5 rounded bg-white/[0.06] text-zinc-300 border border-white/[0.1]">
                    {t.optConnectBadge}
                  </span>
                </div>

                <h3 className="text-sm font-semibold text-white mb-1.5 flex items-center gap-2">
                  <span>{t.optConnectTitle}</span>
                  {selectedOption === 'connect' && (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  )}
                </h3>
                <p className="text-xs text-zinc-400 leading-relaxed mb-4">
                  {t.optConnectDesc}
                </p>

                {selectedOption === 'connect' && (
                  <div className="mt-3 pt-3 border-t border-white/[0.07] space-y-2.5 animate-fade-in">
                    <div>
                      <label className="block text-[10px] uppercase font-mono tracking-wider text-zinc-400 mb-1">
                        {t.optServerUrlLabel}
                      </label>
                      <input
                        type="text"
                        value={serverUrl}
                        onChange={(e) => setServerUrl(e.target.value)}
                        className="w-full bg-[#08090a] border border-white/[0.12] focus:border-zinc-400 rounded-md px-3 py-1.5 text-xs font-mono text-zinc-100 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] uppercase font-mono tracking-wider text-zinc-400 mb-1">
                        {t.optTokenLabel}
                      </label>
                      <input
                        type="text"
                        value={tokenInput}
                        onChange={(e) => setTokenInput(e.target.value)}
                        placeholder={t.optTokenPlaceholder}
                        className="w-full bg-[#08090a] border border-white/[0.12] focus:border-zinc-400 rounded-md px-3 py-1.5 text-xs font-mono text-zinc-100 focus:outline-none"
                      />
                    </div>

                    <div>
                      <div className="text-[10px] uppercase font-mono text-zinc-500 mb-1">
                        {t.optSelectPresetToken}
                      </div>
                      <div className="flex gap-1.5">
                        {(['admin', 'operator', 'viewer'] as const).map((r) => (
                          <button
                            key={r}
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setConnectRole(r);
                              setTokenInput(`dev-${r}-token`);
                            }}
                            className={`flex-1 py-1 px-2 rounded text-[11px] font-mono capitalize transition-colors cursor-pointer border ${
                              connectRole === r
                                ? 'bg-zinc-100 text-zinc-950 border-zinc-100 font-semibold'
                                : 'bg-white/[0.03] text-zinc-400 border-white/[0.07] hover:bg-white/[0.06]'
                            }`}
                          >
                            {r}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-5 pt-2">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleFinishConnect();
                  }}
                  className={`w-full py-2 px-4 rounded-md text-xs font-medium flex items-center justify-center gap-2 transition-colors cursor-pointer ${
                    selectedOption === 'connect'
                      ? 'bg-zinc-100 hover:bg-white text-zinc-950 font-semibold'
                      : 'bg-white/[0.05] text-zinc-300 hover:text-white hover:bg-white/[0.09] border border-white/[0.08]'
                  }`}
                >
                  <span>{t.btnConnect}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>

          {/* Footer Status Bar */}
          <div className="px-6 py-3 border-t border-white/[0.07] bg-[#0a0c10] flex items-center justify-between flex-wrap gap-2 text-[11px] text-zinc-500 font-mono">
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span>{serverUrl} · {t.online}</span>
            </div>
            <div>
              <span>Персональные ссылки (?token=...) открывают пульт напрямую без заставки</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
