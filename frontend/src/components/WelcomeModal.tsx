import React, { useState, useEffect } from 'react';
import {
  Key,
  Server,
  ArrowRight,
  Sparkles,
  Globe,
  CheckCircle2,
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

export const WelcomeModal: React.FC<WelcomeModalProps> = ({
  isOpen,
  onClose,
  locale,
  setLocale,
}) => {
  // Phase 1 = Windows "Привет / Just a moment", Phase 2 = Selection of the 2 options
  const [phase, setPhase] = useState<'welcome' | 'choice'>('welcome');
  const [selectedOption, setSelectedOption] = useState<'owner' | 'connect'>('owner');
  const [clusterName, setClusterName] = useState('CROC-FABRIC-PROD-01');
  const [serverUrl, setServerUrl] = useState('http://127.0.0.1:8000');
  const [tokenInput, setTokenInput] = useState('dev-admin-token');
  const [connectRole, setConnectRole] = useState<UserRole>('admin');

  const t = translations[locale];

  // Auto transition from "Привет" to choices after 1.8 seconds
  useEffect(() => {
    if (isOpen) {
      setPhase('welcome');
      const timer = setTimeout(() => {
        setPhase('choice');
      }, 1900);
      return () => clearTimeout(timer);
    }
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

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-4 bg-[#050608]/95 backdrop-blur-2xl transition-all duration-700 overflow-y-auto">
      {/* Dynamic ambient radial light (Aeza / Windows 11 style) */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-[20%] left-1/2 -translate-x-1/2 w-[700px] h-[700px] bg-gradient-to-b from-indigo-600/15 via-purple-600/10 to-transparent rounded-full blur-3xl animate-win-glow" />
        <div className="absolute bottom-[-10%] left-1/3 w-[500px] h-[500px] bg-gradient-to-t from-cyan-600/10 to-transparent rounded-full blur-3xl" />
      </div>

      {/* Top right language switch */}
      <div className="absolute top-6 right-6 z-20 flex items-center gap-2">
        <button
          onClick={() => setLocale(locale === 'ru' ? 'en' : 'ru')}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.1] text-xs text-zinc-300 transition-colors cursor-pointer"
        >
          <Globe className="w-3.5 h-3.5 text-cyan-400" />
          <span className="font-mono uppercase font-semibold">{locale === 'ru' ? 'English' : 'Русский'}</span>
        </button>
      </div>

      {/* PHASE 1: WINDOWS SMOOTH WELCOME ("Привет" / "Welcome") */}
      {phase === 'welcome' && (
        <div
          onClick={() => setPhase('choice')}
          className="relative z-10 flex flex-col items-center justify-center text-center cursor-pointer animate-win-fade select-none px-4"
        >
          {/* Windows 11 style glowing circular loader */}
          <div className="relative mb-8 flex items-center justify-center">
            <div className="w-20 h-20 rounded-full border-2 border-cyan-400/20 border-t-cyan-400 border-r-indigo-500 animate-win-spin" />
            <div className="absolute inset-0 rounded-full bg-cyan-500/10 blur-md animate-pulse" />
            <Sparkles className="absolute w-7 h-7 text-cyan-300" />
          </div>

          <h1 className="text-4xl sm:text-5xl font-light tracking-tight text-white mb-3">
            {t.winHello}
          </h1>
          <p className="text-sm sm:text-base text-zinc-400 font-normal max-w-md animate-pulse">
            {t.winSettingUp}
          </p>

          <span className="mt-8 text-xs text-zinc-600 font-mono tracking-wider">
            {t.winJustAMoment}
          </span>
        </div>
      )}

      {/* PHASE 2: TWO OPTIONS ("Стать владельцем" / "Подключиться к готовой системе") */}
      {phase === 'choice' && (
        <div className="relative z-10 w-full max-w-4xl max-h-[92vh] overflow-hidden rounded-2xl border border-white/[0.1] bg-[#090b11]/95 shadow-2xl shadow-purple-950/20 text-zinc-200 animate-win-fade flex flex-col">
          {/* Header */}
          <div className="px-6 sm:px-8 pt-6 pb-4 border-b border-white/[0.06] bg-gradient-to-b from-white/[0.02] to-transparent shrink-0">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-mono font-medium bg-purple-500/15 text-purple-300 border border-purple-500/30">
                <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-ping" />
                CROC DREAM NetOps
              </span>
              <span className="text-xs text-zinc-500 font-mono">Zero-Knowledge Fabric</span>
            </div>

            <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-white mb-1">
              {t.winWelcomeTitle}
            </h2>
            <p className="text-xs sm:text-sm text-zinc-400 max-w-2xl leading-relaxed">
              {t.winWelcomeDesc} {t.winChooseMode}
            </p>
          </div>

          {/* Cards Grid: Option 1 (Owner) vs Option 2 (Connect) */}
          <div className="p-6 sm:p-8 grid grid-cols-1 md:grid-cols-2 gap-5 overflow-y-auto flex-1">
            {/* OPTION 1: BECOME OWNER */}
            <div
              onClick={() => setSelectedOption('owner')}
              className={`relative rounded-xl p-5 border transition-all duration-200 cursor-pointer flex flex-col justify-between ${
                selectedOption === 'owner'
                  ? 'border-purple-500/60 bg-gradient-to-b from-purple-500/[0.09] to-transparent shadow-lg shadow-purple-950/30'
                  : 'border-white/[0.08] bg-[#0c0e16] hover:border-white/20'
              }`}
            >
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="w-10 h-10 rounded-xl bg-purple-500/15 border border-purple-500/30 flex items-center justify-center">
                    <Key className="w-5 h-5 text-purple-400" />
                  </div>
                  <span className="text-[10px] font-mono uppercase tracking-wider font-semibold px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30">
                    {t.optOwnerBadge}
                  </span>
                </div>

                <h3 className="text-base font-bold text-white mb-1.5 flex items-center gap-2">
                  <span>{t.optOwnerTitle}</span>
                  {selectedOption === 'owner' && (
                    <CheckCircle2 className="w-4 h-4 text-purple-400" />
                  )}
                </h3>
                <p className="text-xs text-zinc-400 leading-relaxed mb-4">
                  {t.optOwnerDesc}
                </p>

                {selectedOption === 'owner' && (
                  <div className="mt-3 pt-3 border-t border-white/[0.08] space-y-2 animate-fade-in">
                    <label className="block text-[11px] uppercase font-mono tracking-wider text-zinc-400">
                      {t.optClusterNameLabel}
                    </label>
                    <input
                      type="text"
                      value={clusterName}
                      onChange={(e) => setClusterName(e.target.value)}
                      placeholder={t.optClusterNamePlaceholder}
                      className="w-full bg-[#05060a] border border-white/[0.12] focus:border-purple-500/60 rounded-lg px-3 py-2 text-xs font-mono text-zinc-100 focus:outline-none"
                    />
                  </div>
                )}
              </div>

              <div className="mt-5 pt-3">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleFinishOwner();
                  }}
                  className={`w-full py-2.5 px-4 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                    selectedOption === 'owner'
                      ? 'bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white shadow-lg shadow-purple-600/25'
                      : 'bg-white/[0.04] text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.08]'
                  }`}
                >
                  <span>{t.btnBecomeOwner}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* OPTION 2: CONNECT TO EXISTING SYSTEM */}
            <div
              onClick={() => setSelectedOption('connect')}
              className={`relative rounded-xl p-5 border transition-all duration-200 cursor-pointer flex flex-col justify-between ${
                selectedOption === 'connect'
                  ? 'border-cyan-500/60 bg-gradient-to-b from-cyan-500/[0.09] to-transparent shadow-lg shadow-cyan-950/30'
                  : 'border-white/[0.08] bg-[#0c0e16] hover:border-white/20'
              }`}
            >
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="w-10 h-10 rounded-xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center">
                    <Server className="w-5 h-5 text-cyan-400" />
                  </div>
                  <span className="text-[10px] font-mono uppercase tracking-wider font-semibold px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                    {t.optConnectBadge}
                  </span>
                </div>

                <h3 className="text-base font-bold text-white mb-1.5 flex items-center gap-2">
                  <span>{t.optConnectTitle}</span>
                  {selectedOption === 'connect' && (
                    <CheckCircle2 className="w-4 h-4 text-cyan-400" />
                  )}
                </h3>
                <p className="text-xs text-zinc-400 leading-relaxed mb-4">
                  {t.optConnectDesc}
                </p>

                {selectedOption === 'connect' && (
                  <div className="mt-3 pt-3 border-t border-white/[0.08] space-y-3 animate-fade-in">
                    <div>
                      <label className="block text-[11px] uppercase font-mono tracking-wider text-zinc-400 mb-1">
                        {t.optServerUrlLabel}
                      </label>
                      <input
                        type="text"
                        value={serverUrl}
                        onChange={(e) => setServerUrl(e.target.value)}
                        className="w-full bg-[#05060a] border border-white/[0.12] focus:border-cyan-500/60 rounded-lg px-3 py-2 text-xs font-mono text-zinc-100 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] uppercase font-mono tracking-wider text-zinc-400 mb-1">
                        {t.optTokenLabel}
                      </label>
                      <input
                        type="text"
                        value={tokenInput}
                        onChange={(e) => setTokenInput(e.target.value)}
                        placeholder={t.optTokenPlaceholder}
                        className="w-full bg-[#05060a] border border-white/[0.12] focus:border-cyan-500/60 rounded-lg px-3 py-2 text-xs font-mono text-zinc-100 focus:outline-none"
                      />
                    </div>

                    <div>
                      <div className="text-[10px] uppercase font-mono text-zinc-500 mb-1.5">
                        {t.optSelectPresetToken}
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setConnectRole('admin');
                            setTokenInput('dev-admin-token');
                          }}
                          className={`flex-1 py-1 px-2 rounded-md text-[11px] font-mono transition-all cursor-pointer ${
                            connectRole === 'admin'
                              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                              : 'bg-white/[0.03] text-zinc-400 border border-white/[0.06] hover:bg-white/[0.06]'
                          }`}
                        >
                          Admin
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setConnectRole('operator');
                            setTokenInput('dev-operator-token');
                          }}
                          className={`flex-1 py-1 px-2 rounded-md text-[11px] font-mono transition-all cursor-pointer ${
                            connectRole === 'operator'
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                              : 'bg-white/[0.03] text-zinc-400 border border-white/[0.06] hover:bg-white/[0.06]'
                          }`}
                        >
                          Operator
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setConnectRole('viewer');
                            setTokenInput('dev-viewer-token');
                          }}
                          className={`flex-1 py-1 px-2 rounded-md text-[11px] font-mono transition-all cursor-pointer ${
                            connectRole === 'viewer'
                              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                              : 'bg-white/[0.03] text-zinc-400 border border-white/[0.06] hover:bg-white/[0.06]'
                          }`}
                        >
                          Viewer
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-5 pt-3">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleFinishConnect();
                  }}
                  className={`w-full py-2.5 px-4 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                    selectedOption === 'connect'
                      ? 'bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white shadow-lg shadow-cyan-600/25'
                      : 'bg-white/[0.04] text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.08]'
                  }`}
                >
                  <span>{t.btnConnect}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          {/* Footer Status Bar */}
          <div className="px-6 sm:px-8 py-3.5 border-t border-white/[0.06] bg-[#05060a] flex items-center justify-between text-xs text-zinc-500 font-mono">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <span>{serverUrl} · {t.online}</span>
            </div>
            <div>
              <span>RBAC Zero-Trust Active</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
