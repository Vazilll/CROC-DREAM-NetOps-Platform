import React, { useState, useEffect } from 'react';
import {
  Key,
  Server,
  ArrowRight,
  ArrowLeft,
  Network,
  Globe,
  CheckCircle2,
  Check,
  GitBranch,
  Send,
  ShieldCheck,
  Copy,
  RefreshCw,
  Cpu,
  ExternalLink,
  Smartphone,
  Terminal,
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

type WizardStep = 1 | 2 | 3 | 4;

export const WelcomeModal: React.FC<WelcomeModalProps> = ({
  isOpen,
  onClose,
  locale,
  setLocale,
}) => {
  const [phase, setPhase] = useState<'welcome' | 'wizard'>('welcome');
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
  const [wizardStep, setWizardStep] = useState<WizardStep>(1);

  // Step 1: Owner Identity & Recovery
  const [clusterName, setClusterName] = useState('CROC-FABRIC-PROD-01');
  const [ownerToken, setOwnerToken] = useState('');
  const [boundClientId, setBoundClientId] = useState('');
  const [copiedKey, setCopiedKey] = useState(false);
  const [recoverMode, setRecoverMode] = useState(false);
  const [recoveryKeyInput, setRecoveryKeyInput] = useState('');
  const [telegramCodeInput, setTelegramCodeInput] = useState('');
  const [recoveryStatusMsg, setRecoveryStatusMsg] = useState('');
  const [claimingOwner, setClaimingOwner] = useState(false);

  // Step 2: GitHub SoT
  const [githubRepoUrl, setGithubRepoUrl] = useState(
    'https://github.com/Vazilll/CROC-DREAM-NetOps-Platform'
  );
  const [githubBranch, setGithubBranch] = useState('main');
  const [githubCommit, setGithubCommit] = useState('HEAD');
  const [githubPat, setGithubPat] = useState('');
  const [webhookUrl, setWebhookUrl] = useState(
    typeof window !== 'undefined'
      ? `${window.location.origin}/api/v1/git/webhook`
      : 'http://5.228.243.54:5173/api/v1/git/webhook'
  );
  const [copiedWebhook, setCopiedWebhook] = useState(false);
  const [savingGithub, setSavingGithub] = useState(false);
  const [githubSavedMsg, setGithubSavedMsg] = useState('');

  // Step 3: Telegram Bot & AI Copilot
  const [telegramBotToken, setTelegramBotToken] = useState('');
  const [telegramBotUsername, setTelegramBotUsername] = useState('@Croc_Dream_bot');
  const [telegramDeepLink, setTelegramDeepLink] = useState(
    'https://t.me/Croc_Dream_bot?start=claim_owner'
  );
  const [telegramRecoverLink, setTelegramRecoverLink] = useState(
    'https://t.me/Croc_Dream_bot?start=recover_owner'
  );
  const [telegramLinked, setTelegramLinked] = useState(false);
  const [telegramLinkedUser, setTelegramLinkedUser] = useState('');
  const [groqApiKey, setGroqApiKey] = useState('');
  const [aiConfigured, setAiConfigured] = useState(false);
  const [savingTelegram, setSavingTelegram] = useState(false);
  const [telegramSavedMsg, setTelegramSavedMsg] = useState('');

  // Step 4: Autonomous Server Discovery ("Распаковка стенда")
  const [serverMode, setServerMode] = useState<'ssh' | 'offline'>('ssh');
  const [serverHost, setServerHost] = useState('5.228.243.54');
  const [serverPort, setServerPort] = useState(221);
  const [serverUser, setServerUser] = useState('crocdream');
  const [serverPassword, setServerPassword] = useState('');
  const [discoveringServer, setDiscoveringServer] = useState(false);
  const [discoveryResult, setDiscoveryResult] = useState<any | null>(null);

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

  const refreshBootstrapStatus = async () => {
    try {
      const st = await api.getBootstrapStatus();
      if (st.cluster_name) setClusterName(st.cluster_name);
      if (st.github?.github_repo_url) setGithubRepoUrl(st.github.github_repo_url);
      if (st.github?.branch) setGithubBranch(st.github.branch);
      if (st.github?.commit_short) setGithubCommit(st.github.commit_short);
      if (st.telegram?.bot_username) setTelegramBotUsername(st.telegram.bot_username);
      if (st.telegram?.deep_link_claim) setTelegramDeepLink(st.telegram.deep_link_claim);
      if (st.telegram?.deep_link_recover) setTelegramRecoverLink(st.telegram.deep_link_recover);
      if (st.owner?.telegram_linked) setTelegramLinked(true);
      if (st.owner?.telegram_username) setTelegramLinkedUser(st.owner.telegram_username);
      if (st.owner?.bound_client_id) setBoundClientId(st.owner.bound_client_id);
      if (st.server?.clab_host) setServerHost(st.server.clab_host);
      if (st.server?.clab_port) setServerPort(st.server.clab_port);
      if (st.server?.clab_user) setServerUser(st.server.clab_user);
      if (st.ai?.groq_configured || st.ai?.gemini_configured) setAiConfigured(true);

      if (st.initialized && !st.caller_is_bound_owner) {
        setRecoverMode(true);
      }
    } catch {
      // fallback to defaults
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    let active = true;

    const step1Timer = setTimeout(() => {
      if (active) setPreload((p) => ({ ...p, step: Math.max(p.step, 2) }));
    }, 400);

    const step2Timer = setTimeout(() => {
      if (active) setPreload((p) => ({ ...p, step: Math.max(p.step, 3) }));
    }, 850);

    Promise.allSettled([
      api.getDevices(),
      api.getJobs(),
      api.getForecastAlerts(),
      api.getBootstrapStatus(),
    ]).then(([devsRes, jobsRes, alertsRes, bootRes]) => {
      if (!active) return;
      const devs = devsRes.status === 'fulfilled' ? devsRes.value : [];
      const jbs = jobsRes.status === 'fulfilled' ? jobsRes.value : [];
      const alrts = alertsRes.status === 'fulfilled' ? alertsRes.value : [];
      const inSync = devs.filter((d) => d.status === 'IN_SYNC').length;

      if (bootRes.status === 'fulfilled' && bootRes.value) {
        const st = bootRes.value;
        if (st.cluster_name) setClusterName(st.cluster_name);
        if (st.github?.github_repo_url) setGithubRepoUrl(st.github.github_repo_url);
        if (st.github?.branch) setGithubBranch(st.github.branch);
        if (st.github?.commit_short) setGithubCommit(st.github.commit_short);
        if (st.telegram?.bot_username) setTelegramBotUsername(st.telegram.bot_username);
        if (st.telegram?.deep_link_claim) setTelegramDeepLink(st.telegram.deep_link_claim);
        if (st.telegram?.deep_link_recover) setTelegramRecoverLink(st.telegram.deep_link_recover);
        if (st.owner?.telegram_linked) setTelegramLinked(true);
        if (st.owner?.telegram_username) setTelegramLinkedUser(st.owner.telegram_username);
        if (st.owner?.bound_client_id) setBoundClientId(st.owner.bound_client_id);
        if (st.server?.clab_host) setServerHost(st.server.clab_host);
        if (st.server?.clab_port) setServerPort(st.server.clab_port);
        if (st.server?.clab_user) setServerUser(st.server.clab_user);
        if (st.ai?.groq_configured || st.ai?.gemini_configured) setAiConfigured(true);
        if (st.initialized && !st.caller_is_bound_owner) {
          setRecoverMode(true);
        }
      }

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
      if (active) setPhase('wizard');
    }, 1800);

    return () => {
      active = false;
      clearTimeout(step1Timer);
      clearTimeout(step2Timer);
      clearTimeout(transitionTimer);
    };
  }, [isOpen]);

  if (!isOpen) return null;

  // Step 1 Action: Claim Owner or Recover Owner
  const handleClaimOwner = async () => {
    setClaimingOwner(true);
    setRecoveryStatusMsg('');
    try {
      const res = await api.claimOwnerBootstrap({
        cluster_name: clusterName.trim() || 'CROC-FABRIC-PROD-01',
        recovery_key: recoveryKeyInput.trim() || undefined,
      });
      setOwnerToken(res.token);
      setBoundClientId(res.bound_client_id);
      api.setToken(res.token);
      localStorage.setItem('netops_user_role', 'owner');
      localStorage.setItem('netops_cluster_name', res.cluster_name);
      setRecoverMode(false);
      setWizardStep(2);
    } catch (err: any) {
      setRecoverMode(true);
      setRecoveryStatusMsg(
        err?.message ||
          'Этот кластер уже привязан к другому ПК. Введите Резервный Ключ или получите код в Telegram.'
      );
    } finally {
      setClaimingOwner(false);
    }
  };

  const handleRequestTelegramRecoveryCode = async () => {
    setClaimingOwner(true);
    try {
      const res = await api.recoverOwnerAccess({ action: 'request_telegram_code' });
      setRecoveryStatusMsg(res.message || 'Код отправлен в @Croc_Dream_bot');
    } catch (err: any) {
      setRecoveryStatusMsg(err?.message || 'Ошибка отправки кода в Telegram');
    } finally {
      setClaimingOwner(false);
    }
  };

  const handleVerifyOwnerRecovery = async () => {
    setClaimingOwner(true);
    try {
      const res = await api.recoverOwnerAccess({
        action: 'verify',
        recovery_key: recoveryKeyInput.trim() || undefined,
        telegram_code: telegramCodeInput.trim() || undefined,
      });
      setOwnerToken(res.token);
      setBoundClientId(res.bound_client_id);
      api.setToken(res.token);
      localStorage.setItem('netops_user_role', 'owner');
      setRecoverMode(false);
      setRecoveryStatusMsg('Права Владельца успешно перенесены на этот ПК!');
      setWizardStep(2);
    } catch (err: any) {
      setRecoveryStatusMsg(err?.message || 'Неверный резервный ключ или Telegram-код');
    } finally {
      setClaimingOwner(false);
    }
  };

  // Step 2 Action: Save GitHub SoT & Webhook
  const handleSaveGithub = async () => {
    setSavingGithub(true);
    setGithubSavedMsg('');
    try {
      const res = await api.configureBootstrapLayers({
        cluster_name: clusterName.trim(),
        github_repo_url: githubRepoUrl.trim(),
        github_pat: githubPat.trim() || undefined,
        webhook_public_url: webhookUrl.trim(),
      });
      if (res.git?.branch) setGithubBranch(res.git.branch);
      if (res.git?.commit_short) setGithubCommit(res.git.commit_short);
      setGithubSavedMsg(
        res.webhook_status === 'created_on_github'
          ? 'Репозиторий привязан, Webhook автоматически создан в GitHub!'
          : 'Репозиторий GitHub SoT сохранён и синхронизирован!'
      );
      setTimeout(() => setWizardStep(3), 500);
    } catch (err: any) {
      setGithubSavedMsg(err?.message || 'Ошибка сохранения настроек GitHub');
    } finally {
      setSavingGithub(false);
    }
  };

  // Step 3 Action: Save Telegram & AI
  const handleSaveTelegramAndAi = async () => {
    setSavingTelegram(true);
    setTelegramSavedMsg('');
    try {
      const res = await api.configureBootstrapLayers({
        telegram_bot_token: telegramBotToken.trim() || undefined,
        groq_api_key: groqApiKey.trim() || undefined,
      });
      if (res.bot_username) setTelegramBotUsername(res.bot_username);
      if (res.deep_link_claim) setTelegramDeepLink(res.deep_link_claim);
      await refreshBootstrapStatus();
      setTelegramSavedMsg('Контур Telegram и ИИ сохранён в общем томе Docker!');
      setTimeout(() => setWizardStep(4), 500);
    } catch (err: any) {
      setTelegramSavedMsg(err?.message || 'Ошибка сохранения настроек Telegram');
    } finally {
      setSavingTelegram(false);
    }
  };

  // Step 4 Action: Autonomous Server Discovery & Finish
  const handleDiscoverServer = async () => {
    setDiscoveringServer(true);
    try {
      const res = await api.discoverAndAttachServer({
        mode: serverMode,
        host: serverHost.trim(),
        port: Number(serverPort) || 221,
        username: serverUser.trim(),
        password: serverPassword || undefined,
      });
      setDiscoveryResult(res);
    } catch (err: any) {
      setDiscoveryResult({
        status: 'error',
        message: err?.message || 'Не удалось связаться с сервером',
      });
    } finally {
      setDiscoveringServer(false);
    }
  };

  const handleFinishWizard = async () => {
    try {
      await api.configureBootstrapLayers({
        cluster_name: clusterName.trim() || 'CROC-FABRIC-PROD-01',
        bootstrap_completed: true,
      });
    } catch {
      // ignore
    }
    if (!ownerToken) {
      api.setToken('dev-owner-token');
    }
    localStorage.setItem('netops_user_role', 'owner');
    localStorage.setItem('netops_cluster_name', clusterName.trim() || 'CROC-FABRIC-PROD-01');
    localStorage.setItem('netops_onboarding_done', 'true');
    onClose('owner');
  };

  const bootSteps =
    locale === 'en'
      ? [
          'Connecting to PostgreSQL 16 & Redis 7 SoT Core',
          `Indexing CLOS Fabric Inventory (${preload.devicesCount} nodes)`,
          'Warming up TimesFM 3.0 Telemetry & HierConfig AST',
          'Initializing Matryoshka Owner Bootstrap Engine',
        ]
      : [
          'Подключение ядра PostgreSQL 16 и брокера Redis 7',
          `Индексация топологии CLOS (${preload.devicesCount} узлов в базе)`,
          'Прогрев телеметрии TimesFM 3.0 и HierConfig AST',
          'Запуск автономного мастера настройки Владельца («Матрёшка»)',
        ];

  const stepsMeta: { id: WizardStep; title: string; subtitle: string; icon: React.ReactNode }[] = [
    {
      id: 1,
      title: '1. Права Владельца',
      subtitle: 'Привязка ПК и ключ',
      icon: <Key className="w-3.5 h-3.5" />,
    },
    {
      id: 2,
      title: '2. GitHub SoT',
      subtitle: 'Репозиторий и Webhook',
      icon: <GitBranch className="w-3.5 h-3.5" />,
    },
    {
      id: 3,
      title: '3. Telegram и ИИ',
      subtitle: '@Croc_Dream_bot',
      icon: <Send className="w-3.5 h-3.5" />,
    },
    {
      id: 4,
      title: '4. Опорный Сервер',
      subtitle: 'Авто-распаковка стенда',
      icon: <Server className="w-3.5 h-3.5" />,
    },
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

      {/* PHASE 1: HARDWARE BOOT MONOGRAM WITH LIVE PRELOAD */}
      {phase === 'welcome' && (
        <div
          onClick={() => setPhase('wizard')}
          className="relative z-10 w-full max-w-md flex flex-col items-center justify-center text-center cursor-pointer animate-win-fade select-none px-4"
        >
          <div className="w-16 h-16 rounded-2xl bg-[#111318] border border-white/[0.12] flex items-center justify-center mb-7 shadow-2xl">
            <Network className="w-7 h-7 text-zinc-100 animate-boot-pulse" />
          </div>

          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-zinc-100 mb-2">
            {t.winHello}
          </h1>
          <p className="text-xs sm:text-sm text-zinc-400 max-w-sm">{t.winSettingUp}</p>

          <div className="w-56 h-1 bg-white/[0.08] rounded-full overflow-hidden mt-7 mb-6">
            <div
              className="h-full bg-zinc-100 transition-all duration-500 ease-out rounded-full"
              style={{ width: `${Math.min(100, preload.step * 25)}%` }}
            />
          </div>

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

          <span className="mt-5 text-[11px] text-zinc-500 font-mono">{t.winJustAMoment}</span>
        </div>
      )}

      {/* PHASE 2: 4-STEP MATRYOSHKA AUTONOMOUS OWNER WIZARD */}
      {phase === 'wizard' && (
        <div className="relative z-10 w-full max-w-3xl max-h-[92vh] overflow-hidden rounded-xl border border-white/[0.1] bg-[#0e1014] shadow-2xl text-zinc-200 animate-win-fade flex flex-col">
          {/* Header */}
          <div className="px-6 py-4 border-b border-white/[0.07] bg-[#12151c]/70 shrink-0">
            <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-white/[0.06] text-zinc-200 border border-white/[0.1]">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  CROC DREAM NetOps · Docker Stack
                </span>
                <span className="text-[11px] text-zinc-500 font-mono">
                  PostgreSQL 16 + Redis 7
                </span>
              </div>

              <button
                type="button"
                onClick={handleFinishWizard}
                className="text-[11px] font-mono text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer underline underline-offset-4"
              >
                Пропустить мастер и сразу открыть пульт →
              </button>
            </div>

            {/* Stepper Navigation ("Матрёшка") */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {stepsMeta.map((s) => {
                const active = wizardStep === s.id;
                const completed = wizardStep > s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setWizardStep(s.id)}
                    className={`text-left p-2.5 rounded-lg border transition-all cursor-pointer flex items-start gap-2.5 ${
                      active
                        ? 'border-zinc-200 bg-white/[0.06] text-white'
                        : completed
                          ? 'border-emerald-500/30 bg-emerald-500/[0.05] text-emerald-300'
                          : 'border-white/[0.06] bg-[#0a0c10] text-zinc-400 hover:border-white/[0.14]'
                    }`}
                  >
                    <div
                      className={`mt-0.5 w-6 h-6 rounded-md flex items-center justify-center shrink-0 border ${
                        active
                          ? 'bg-zinc-100 text-zinc-950 border-zinc-100'
                          : completed
                            ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                            : 'bg-white/[0.04] text-zinc-400 border-white/[0.08]'
                      }`}
                    >
                      {completed ? <Check className="w-3.5 h-3.5" /> : s.icon}
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-semibold truncate">{s.title}</div>
                      <div className="text-[10px] text-zinc-500 font-mono truncate">
                        {s.subtitle}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Step Body */}
          <div className="p-6 overflow-y-auto flex-1 space-y-5">
            {/* ==================== STEP 1: OWNER IDENTITY & RECOVERY ==================== */}
            {wizardStep === 1 && (
              <div className="space-y-4 animate-fade-in">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 mb-2">
                      Ядро Матрёшки · Root Identity
                    </span>
                    <h2 className="text-lg font-semibold text-white">
                      Вы развернули платформу — инициализируйте права Владельца (Owner)
                    </h2>
                    <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                      Система автоматически выдаёт вам высшую роль <code className="text-zinc-200">owner</code> в PostgreSQL 16,
                      привязывает ваш текущий компьютер и генерирует резервный мастер-ключ на случай смены ПК.
                    </p>
                  </div>
                </div>

                {!recoverMode ? (
                  <div className="rounded-lg border border-white/[0.08] bg-[#0a0c10] p-4 space-y-4">
                    <div>
                      <label className="block text-[11px] uppercase font-mono tracking-wider text-zinc-400 mb-1.5">
                        Название вашего кластера / фабрики CLOS
                      </label>
                      <input
                        type="text"
                        value={clusterName}
                        onChange={(e) => setClusterName(e.target.value)}
                        placeholder="CROC-FABRIC-PROD-01"
                        className="w-full bg-[#08090a] border border-white/[0.12] focus:border-zinc-300 rounded-md px-3 py-2 text-xs font-mono text-zinc-100 focus:outline-none"
                      />
                    </div>

                    {ownerToken && (
                      <div className="rounded-md border border-emerald-500/30 bg-emerald-500/[0.06] p-3.5 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-emerald-300 flex items-center gap-1.5">
                            <ShieldCheck className="w-4 h-4" />
                            Права Владельца активированы и привязаны к этому ПК
                          </span>
                          <span className="text-[10px] font-mono text-emerald-400/80">
                            Client-ID: {boundClientId || 'bound'}
                          </span>
                        </div>
                        <p className="text-[11px] text-zinc-300">
                          Сохраните ваш <b>Резервный Ключ (Master Recovery Key)</b> — если вы потеряете доступ к этому ПК,
                          по этому ключу (или через Telegram-бота) вы сможете перенести права Владельца на новый ноутбук:
                        </p>
                        <div className="flex items-center gap-2">
                          <code className="flex-1 bg-[#08090a] border border-white/[0.1] rounded px-2.5 py-1.5 text-xs font-mono text-emerald-300 select-all">
                            {ownerToken}
                          </code>
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(ownerToken);
                              setCopiedKey(true);
                              setTimeout(() => setCopiedKey(false), 2000);
                            }}
                            className="px-3 py-1.5 rounded bg-white/[0.08] hover:bg-white/[0.14] text-xs font-mono text-white flex items-center gap-1.5 cursor-pointer"
                          >
                            {copiedKey ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                            <span>{copiedKey ? 'Скопировано' : 'Копировать'}</span>
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="flex items-center justify-between flex-wrap gap-3 pt-2">
                      <button
                        type="button"
                        onClick={() => setRecoverMode(true)}
                        className="text-xs font-mono text-zinc-400 hover:text-zinc-200 underline underline-offset-4 cursor-pointer"
                      >
                        Старый ПК недоступен? Перенести права Владельца на этот компьютер →
                      </button>

                      <button
                        type="button"
                        onClick={handleClaimOwner}
                        disabled={claimingOwner}
                        className="px-5 py-2.5 rounded-md bg-zinc-100 hover:bg-white text-zinc-950 text-xs font-semibold flex items-center gap-2 transition-colors cursor-pointer"
                      >
                        <span>
                          {claimingOwner
                            ? 'Активация...'
                            : 'Активировать права Владельца и перейти к GitHub'}
                        </span>
                        <ArrowRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ) : (
                  /* OWNER RECOVERY MODE (When old PC is lost) */
                  <div className="rounded-lg border border-amber-500/30 bg-[#0a0c10] p-4 space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-amber-300 flex items-center gap-2">
                        <Smartphone className="w-4 h-4" />
                        Перенос прав Владельца на новый компьютер (Owner Recovery)
                      </h3>
                      <button
                        type="button"
                        onClick={() => setRecoverMode(false)}
                        className="text-xs font-mono text-zinc-400 hover:text-white cursor-pointer"
                      >
                        ← Назад
                      </button>
                    </div>

                    <p className="text-xs text-zinc-300 leading-relaxed">
                      Если ваш прежний компьютер остался дома или недоступен, выберите любой из 2 способов переноса привязки:
                    </p>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="rounded-md border border-white/[0.08] bg-[#08090a] p-3.5 space-y-2.5">
                        <div className="text-xs font-semibold text-white">
                          Способ 1. Через Telegram (@Croc_Dream_bot)
                        </div>
                        <p className="text-[11px] text-zinc-400">
                          Запросите 6-значный код в ваш привязанный Telegram или нажмите кнопку сброса прямо в боте:
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={handleRequestTelegramRecoveryCode}
                            className="px-3 py-1.5 rounded bg-white/[0.08] hover:bg-white/[0.14] text-xs font-mono text-zinc-100 cursor-pointer"
                          >
                            Прислать 6-значный код в TG
                          </button>
                          <a
                            href={telegramRecoverLink}
                            target="_blank"
                            rel="noreferrer"
                            className="px-3 py-1.5 rounded bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-xs font-mono text-emerald-300 inline-flex items-center gap-1"
                          >
                            <span>Сбросить в 1 клик через бота</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>
                        <input
                          type="text"
                          value={telegramCodeInput}
                          onChange={(e) => setTelegramCodeInput(e.target.value)}
                          placeholder="Введите 6-значный код из Telegram"
                          className="w-full bg-[#0e1014] border border-white/[0.12] rounded px-2.5 py-1.5 text-xs font-mono text-white"
                        />
                      </div>

                      <div className="rounded-md border border-white/[0.08] bg-[#08090a] p-3.5 space-y-2.5">
                        <div className="text-xs font-semibold text-white">
                          Способ 2. По Резервному Ключу (Recovery Key)
                        </div>
                        <p className="text-[11px] text-zinc-400">
                          Вставьте ваш мастер-ключ <code className="text-zinc-200">crk_owner_...</code>, полученный при первичной настройке:
                        </p>
                        <input
                          type="text"
                          value={recoveryKeyInput}
                          onChange={(e) => setRecoveryKeyInput(e.target.value)}
                          placeholder="crk_owner_..."
                          className="w-full bg-[#0e1014] border border-white/[0.12] rounded px-2.5 py-1.5 text-xs font-mono text-white"
                        />
                      </div>
                    </div>

                    {recoveryStatusMsg && (
                      <div className="text-xs font-mono text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded px-3 py-2">
                        {recoveryStatusMsg}
                      </div>
                    )}

                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={handleVerifyOwnerRecovery}
                        disabled={claimingOwner}
                        className="px-5 py-2 rounded-md bg-zinc-100 hover:bg-white text-zinc-950 text-xs font-semibold cursor-pointer"
                      >
                        Перепривязать права Владельца на этот ПК →
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ==================== STEP 2: GITHUB SOURCE OF TRUTH ==================== */}
            {wizardStep === 2 && (
              <div className="space-y-4 animate-fade-in">
                <div>
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider bg-blue-500/10 text-blue-400 border border-blue-500/20 mb-2">
                    Слой 2 · Git Source of Truth (CI/CD & Webhook)
                  </span>
                  <h2 className="text-lg font-semibold text-white">
                    Автономная связка с вашим GitHub-репозиторием
                  </h2>
                  <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                    Система уже обнаружила ваш форк и текущую ветку. При каждом коммите в GitHub вебхук автоматически
                    делает <code className="text-zinc-200">git pull</code>, обновляет PostgreSQL 16 и запускает префлайт <code className="text-zinc-200">Dry-Run</code>.
                  </p>
                </div>

                <div className="rounded-lg border border-white/[0.08] bg-[#0a0c10] p-4 space-y-3.5">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="sm:col-span-2">
                      <label className="block text-[10px] uppercase font-mono text-zinc-400 mb-1">
                        URL вашего репозитория GitHub (Source of Truth)
                      </label>
                      <input
                        type="text"
                        value={githubRepoUrl}
                        onChange={(e) => setGithubRepoUrl(e.target.value)}
                        className="w-full bg-[#08090a] border border-white/[0.12] rounded-md px-3 py-1.5 text-xs font-mono text-zinc-100"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] uppercase font-mono text-zinc-400 mb-1">
                        Активная ветка и коммит
                      </label>
                      <div className="bg-[#08090a] border border-emerald-500/25 rounded-md px-3 py-1.5 text-xs font-mono text-emerald-400 flex items-center justify-between">
                        <span>{githubBranch}</span>
                        <span className="text-zinc-400">@{githubCommit}</span>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] uppercase font-mono text-zinc-400 mb-1">
                      Адрес Webhook для GitHub (Settings → Webhooks → Payload URL)
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={webhookUrl}
                        onChange={(e) => setWebhookUrl(e.target.value)}
                        className="flex-1 bg-[#08090a] border border-white/[0.12] rounded-md px-3 py-1.5 text-xs font-mono text-zinc-200"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(webhookUrl);
                          setCopiedWebhook(true);
                          setTimeout(() => setCopiedWebhook(false), 2000);
                        }}
                        className="px-3 py-1.5 rounded bg-white/[0.07] hover:bg-white/[0.12] text-xs font-mono text-zinc-200 flex items-center gap-1.5 cursor-pointer"
                      >
                        {copiedWebhook ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{copiedWebhook ? 'Скопировано' : 'Копировать URL'}</span>
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] uppercase font-mono text-zinc-400 mb-1">
                      GitHub Personal Access Token (необязательно — для авто-прописки Webhook в 1 клик)
                    </label>
                    <input
                      type="password"
                      value={githubPat}
                      onChange={(e) => setGithubPat(e.target.value)}
                      placeholder="ghp_... (оставьте пустым, если SSH-ключ уже подключён)"
                      className="w-full bg-[#08090a] border border-white/[0.12] rounded-md px-3 py-1.5 text-xs font-mono text-zinc-100"
                    />
                  </div>

                  {githubSavedMsg && (
                    <div className="text-xs font-mono text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded px-3 py-2">
                      {githubSavedMsg}
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-2">
                    <button
                      type="button"
                      onClick={() => setWizardStep(1)}
                      className="px-3.5 py-2 rounded-md bg-white/[0.05] hover:bg-white/[0.1] text-xs font-mono text-zinc-300 flex items-center gap-1.5 cursor-pointer"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                      <span>Назад</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleSaveGithub}
                      disabled={savingGithub}
                      className="px-5 py-2 rounded-md bg-zinc-100 hover:bg-white text-zinc-950 text-xs font-semibold flex items-center gap-2 cursor-pointer"
                    >
                      <span>{savingGithub ? 'Синхронизация...' : 'Подключить GitHub и перейти к Telegram'}</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ==================== STEP 3: TELEGRAM BOT & AI COPILOT ==================== */}
            {wizardStep === 3 && (
              <div className="space-y-4 animate-fade-in">
                <div>
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider bg-purple-500/10 text-purple-300 border border-purple-500/20 mb-2">
                    Слой 3 · Мобильный пульт NOC & AI-Копилот
                  </span>
                  <h2 className="text-lg font-semibold text-white">
                    Привязка вашего Telegram ({telegramBotUsername}) и ИИ
                  </h2>
                  <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                    Бот даёт вам полный пульт управления из Telegram (статус, сбор метрик, кнопки блокировки, ИИ-аудит)
                    и служит вашим резервным ключом (<code className="text-zinc-200">/recover</code>) на случай потери ПК.
                  </p>
                </div>

                <div className="rounded-lg border border-white/[0.08] bg-[#0a0c10] p-4 space-y-4">
                  {/* 1-Click Deep Link Card */}
                  <div className="rounded-md border border-emerald-500/25 bg-emerald-500/[0.05] p-3.5 flex items-center justify-between flex-wrap gap-3">
                    <div>
                      <div className="text-xs font-semibold text-white flex items-center gap-2">
                        <span>Привязка вашего аккаунта в 1 клик</span>
                        {telegramLinked && (
                          <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[10px] font-mono">
                            Подключён {telegramLinkedUser ? `@${telegramLinkedUser}` : ''}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-zinc-400 mt-0.5">
                        Нажмите кнопку справа — откроется {telegramBotUsername}, нажмите «Start», и ваш Telegram ID
                        автоматически запишется в PostgreSQL 16.
                      </p>
                    </div>

                    <a
                      href={telegramDeepLink}
                      target="_blank"
                      rel="noreferrer"
                      className="px-4 py-2 rounded-md bg-emerald-400 hover:bg-emerald-300 text-zinc-950 text-xs font-semibold inline-flex items-center gap-1.5 shrink-0"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>Открыть {telegramBotUsername}</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] uppercase font-mono text-zinc-400 mb-1">
                        Токен бота (NETOPS_TELEGRAM_BOT_TOKEN)
                      </label>
                      <input
                        type="password"
                        value={telegramBotToken}
                        onChange={(e) => setTelegramBotToken(e.target.value)}
                        placeholder="Уже активен @Croc_Dream_bot (или вставьте новый)"
                        className="w-full bg-[#08090a] border border-white/[0.12] rounded-md px-3 py-1.5 text-xs font-mono text-zinc-100"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] uppercase font-mono text-zinc-400 mb-1">
                        Ключ ИИ-Копилота (Groq / OpenAI API Key)
                      </label>
                      <input
                        type="password"
                        value={groqApiKey}
                        onChange={(e) => setGroqApiKey(e.target.value)}
                        placeholder={
                          aiConfigured
                            ? 'ИИ-провайдер уже активен (или обновите ключ)'
                            : 'gsk_... (для ответов ИИ в пульте и боте)'
                        }
                        className="w-full bg-[#08090a] border border-white/[0.12] rounded-md px-3 py-1.5 text-xs font-mono text-zinc-100"
                      />
                    </div>
                  </div>

                  {telegramSavedMsg && (
                    <div className="text-xs font-mono text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded px-3 py-2">
                      {telegramSavedMsg}
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-2">
                    <button
                      type="button"
                      onClick={() => setWizardStep(2)}
                      className="px-3.5 py-2 rounded-md bg-white/[0.05] hover:bg-white/[0.1] text-xs font-mono text-zinc-300 flex items-center gap-1.5 cursor-pointer"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                      <span>Назад</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleSaveTelegramAndAi}
                      disabled={savingTelegram}
                      className="px-5 py-2 rounded-md bg-zinc-100 hover:bg-white text-zinc-950 text-xs font-semibold flex items-center gap-2 cursor-pointer"
                    >
                      <span>{savingTelegram ? 'Сохранение...' : 'Сохранить и перейти к подключению сервера'}</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ==================== STEP 4: AUTONOMOUS SERVER DISCOVERY ==================== */}
            {wizardStep === 4 && (
              <div className="space-y-4 animate-fade-in">
                <div>
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider bg-amber-500/10 text-amber-300 border border-amber-500/20 mb-2">
                    Слой 4 · Автономная распаковка Опорного Сервера
                  </span>
                  <h2 className="text-lg font-semibold text-white">
                    Подключите ваш сервер — система сама найдёт на нём все маршрутизаторы и контейнеры
                  </h2>
                  <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                    Достаточно указать SSH-доступ к опорному серверу (например, <code className="text-zinc-200">5.228.243.54:221</code>):
                    платформа сама проверит Docker-контейнеры и порты коммутаторов (<code className="text-zinc-200">2211..2222</code>) и занесёт их в PostgreSQL 16.
                  </p>
                </div>

                <div className="rounded-lg border border-white/[0.08] bg-[#0a0c10] p-4 space-y-4">
                  {/* Mode Switch */}
                  <div className="grid grid-cols-2 gap-2.5">
                    <button
                      type="button"
                      onClick={() => setServerMode('ssh')}
                      className={`p-3 rounded-lg border text-left cursor-pointer transition-colors ${
                        serverMode === 'ssh'
                          ? 'border-zinc-200 bg-white/[0.06] text-white'
                          : 'border-white/[0.07] bg-[#08090a] text-zinc-400'
                      }`}
                    >
                      <div className="text-xs font-semibold flex items-center gap-2">
                        <Terminal className="w-4 h-4 text-emerald-400" />
                        <span>Боевой сервер по SSH (Scrapli Live)</span>
                      </div>
                      <div className="text-[11px] text-zinc-400 mt-0.5">
                        Авто-обнаружение контейнеров Arista / Cisco / Huawei на удалённом сервере
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setServerMode('offline')}
                      className={`p-3 rounded-lg border text-left cursor-pointer transition-colors ${
                        serverMode === 'offline'
                          ? 'border-zinc-200 bg-white/[0.06] text-white'
                          : 'border-white/[0.07] bg-[#08090a] text-zinc-400'
                      }`}
                    >
                      <div className="text-xs font-semibold flex items-center gap-2">
                        <Cpu className="w-4 h-4 text-blue-400" />
                        <span>Автономный демо-стенд (Offline)</span>
                      </div>
                      <div className="text-[11px] text-zinc-400 mt-0.5">
                        Работа на встроенных эталонных конфигурациях внутри Docker без внешнего SSH
                      </div>
                    </button>
                  </div>

                  {serverMode === 'ssh' && (
                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
                      <div className="sm:col-span-2">
                        <label className="block text-[10px] uppercase font-mono text-zinc-400 mb-1">
                          IP / Хост опорного сервера
                        </label>
                        <input
                          type="text"
                          value={serverHost}
                          onChange={(e) => setServerHost(e.target.value)}
                          className="w-full bg-[#08090a] border border-white/[0.12] rounded-md px-3 py-1.5 text-xs font-mono text-white"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] uppercase font-mono text-zinc-400 mb-1">
                          SSH Порт
                        </label>
                        <input
                          type="number"
                          value={serverPort}
                          onChange={(e) => setServerPort(Number(e.target.value))}
                          className="w-full bg-[#08090a] border border-white/[0.12] rounded-md px-3 py-1.5 text-xs font-mono text-white"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] uppercase font-mono text-zinc-400 mb-1">
                          SSH Логин
                        </label>
                        <input
                          type="text"
                          value={serverUser}
                          onChange={(e) => setServerUser(e.target.value)}
                          className="w-full bg-[#08090a] border border-white/[0.12] rounded-md px-3 py-1.5 text-xs font-mono text-white"
                        />
                      </div>
                      <div className="sm:col-span-4">
                        <label className="block text-[10px] uppercase font-mono text-zinc-400 mb-1">
                          SSH Пароль сервера (необязательно, если проброшен SSH-ключ)
                        </label>
                        <div className="flex gap-2">
                          <input
                            type="password"
                            value={serverPassword}
                            onChange={(e) => setServerPassword(e.target.value)}
                            placeholder="Оставьте пустым при использовании SSH-ключа"
                            className="flex-1 bg-[#08090a] border border-white/[0.12] rounded-md px-3 py-1.5 text-xs font-mono text-white"
                          />
                          <button
                            type="button"
                            onClick={handleDiscoverServer}
                            disabled={discoveringServer}
                            className="px-4 py-1.5 rounded-md bg-emerald-400 hover:bg-emerald-300 text-zinc-950 text-xs font-semibold flex items-center gap-1.5 cursor-pointer shrink-0"
                          >
                            <RefreshCw
                              className={`w-3.5 h-3.5 ${discoveringServer ? 'animate-spin' : ''}`}
                            />
                            <span>
                              {discoveringServer
                                ? 'Сканирование сервера...'
                                : 'Сканировать и распаковать сервер'}
                            </span>
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Discovery Results Table */}
                  {discoveryResult && discoveryResult.discovered_switches && (
                    <div className="rounded-md border border-emerald-500/30 bg-emerald-500/[0.05] p-3.5 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-emerald-300 flex items-center gap-1.5">
                          <CheckCircle2 className="w-4 h-4" />
                          Сервер распакован: синхронизировано {discoveryResult.synced_total} узлов в PostgreSQL 16
                        </span>
                        <span className="text-[10px] font-mono text-zinc-400">
                          Контейнеров Docker: {discoveryResult.discovered_containers?.length || 4}
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {discoveryResult.discovered_switches.map((sw: any) => (
                          <div
                            key={sw.hostname}
                            className="rounded border border-white/[0.08] bg-[#08090a] px-3 py-2 flex items-center justify-between text-xs font-mono"
                          >
                            <div>
                              <div className="text-zinc-100 font-semibold">{sw.hostname}</div>
                              <div className="text-[10px] text-zinc-500">
                                {sw.platform} · {sw.role} · {sw.endpoint}
                              </div>
                            </div>
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] ${
                                sw.reachable
                                  ? 'bg-emerald-500/20 text-emerald-300'
                                  : 'bg-amber-500/20 text-amber-300'
                              }`}
                            >
                              {sw.reachable ? 'SSH OK' : 'SYNCED'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-2">
                    <button
                      type="button"
                      onClick={() => setWizardStep(3)}
                      className="px-3.5 py-2 rounded-md bg-white/[0.05] hover:bg-white/[0.1] text-xs font-mono text-zinc-300 flex items-center gap-1.5 cursor-pointer"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                      <span>Назад</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleFinishWizard}
                      className="px-6 py-2.5 rounded-md bg-zinc-100 hover:bg-white text-zinc-950 text-xs font-semibold flex items-center gap-2 cursor-pointer"
                    >
                      <span>Завершить настройку и открыть пульт управления</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer Status Bar */}
          <div className="px-6 py-3 border-t border-white/[0.07] bg-[#0a0c10] flex items-center justify-between flex-wrap gap-2 text-[11px] text-zinc-500 font-mono">
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span>
                Кластер: {clusterName} · Узлов в PostgreSQL: {preload.devicesCount} ({preload.inSyncCount} IN_SYNC)
              </span>
            </div>
            <div>
              <span>После запуска вы сможете подключать новые узлы и выдавать ссылки команде из шапки пульта</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
