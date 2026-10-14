import React, { useState, useEffect } from 'react';
import {
  Key,
  Server,
  ArrowRight,
  Network,
  Globe,
  CheckCircle2,
  Check,
  GitBranch,
  Send,
  ShieldCheck,
  RefreshCw,
  Cpu,
  ExternalLink,
  Smartphone,
  Terminal,
  Sun,
  Moon,
} from 'lucide-react';
import {
  api,
  getErrorMessage,
  type UserRole,
  type ServerDiscoveryResponse,
  type DiscoveredSwitchItem,
} from '../../api';
import type { AppTheme } from '../layout/Header';
import { translations, type Locale } from '../../i18n';

interface WelcomeModalProps {
  isOpen: boolean;
  onClose: (role: UserRole) => void;
  locale: Locale;
  setLocale: (l: Locale) => void;
  theme: AppTheme;
  setTheme: (t: AppTheme) => void;
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

interface WizardCopy {
  clusterSetupTitle: string;
  skipBtn: string;
  backBtn: string;
  nextBtn: string;
  copyBtn: string;
  copiedBtn: string;
  steps: Record<WizardStep, string>;
  step1: {
    clusterNameLabel: string;
    networkContourLabel: string;
    localOnlyTitle: string;
    localOnlyDesc: string;
    publicTunnelTitle: string;
    publicTunnelDesc: string;
    wsTitle: string;
    wsEnabledDesc: string;
    wsDisabledDesc: string;
    wsOn: string;
    wsOff: string;
    recoveryKeyBanner: string;
    transferAccessBtn: string;
    recoverHeader: string;
    recoverStep1Title: string;
    requestCodeBtn: string;
    botLinkBtn: string;
    codePlaceholder: string;
    recoverStep2Title: string;
    bindThisPcBtn: string;
    errAlreadyBound: string;
    msgCodeSentFallback: string;
    errCodeSend: string;
    msgRecoveredSuccess: string;
    errInvalidRecovery: string;
  };
  step2: {
    repoLabel: string;
    branchLabel: string;
    webhookUrlLabel: string;
    githubTokenLabel: string;
    webhookSecretLabel: string;
    localModeNotice: string;
    enableWebhookBtn: string;
    msgWebhookCreated: string;
    msgRepoSaved: string;
    errGithubSave: string;
  };
  step3: {
    tgBotTitle: string;
    tgLinkedStatus: string;
    tgUnlinkedHint: string;
    connectTgBtn: string;
    botTokenLabel: string;
    botTokenPlaceholder: string;
    aiKeyLabel: string;
    aiAlreadyConfigured: string;
    msgTelegramSaved: string;
    errTelegramSave: string;
  };
  step4: {
    sshLiveTitle: string;
    sshLiveSub: string;
    offlineDemoTitle: string;
    offlineDemoSub: string;
    hostLabel: string;
    portLabel: string;
    userLabel: string;
    passwordPlaceholder: string;
    discoveringBtn: string;
    discoverBtn: string;
    discoveredNodesCount: string;
    errServerUnreachable: string;
    openConsoleBtn: string;
  };
}

const WIZARD_COPY: Record<Locale, WizardCopy> = {
  ru: {
    clusterSetupTitle: 'Настройка кластера',
    skipBtn: 'Пропустить →',
    backBtn: '← Назад',
    nextBtn: 'Далее',
    copyBtn: 'Копировать',
    copiedBtn: 'ОК',
    steps: {
      1: '1. Владелец',
      2: '2. GitHub',
      3: '3. Telegram и ИИ',
      4: '4. Сервер',
    },
    step1: {
      clusterNameLabel: 'Имя кластера',
      networkContourLabel: 'Сетевой контур',
      localOnlyTitle: '🔒 Только локально',
      localOnlyDesc: '127.0.0.1:5173 (закрыт снаружи)',
      publicTunnelTitle: '🌐 Внешний туннель',
      publicTunnelDesc: '(публичный)',
      wsTitle: 'WebSocket-поток реального времени',
      wsEnabledDesc: 'Включён · одноразовый Ticket (TTL 30с)',
      wsDisabledDesc: 'Выключен · обычный HTTP-опрос',
      wsOn: 'ВКЛ',
      wsOff: 'ВЫКЛ',
      recoveryKeyBanner: 'Резервный ключ Владельца (сохраните):',
      transferAccessBtn: 'Перенести права со старого ПК',
      recoverHeader: 'Перенос прав Владельца на этот ПК',
      recoverStep1Title: '1. Код из Telegram',
      requestCodeBtn: 'Запросить код',
      botLinkBtn: 'Бот',
      codePlaceholder: '6-значный код',
      recoverStep2Title: '2. Резервный ключ',
      bindThisPcBtn: 'Привязать этот ПК →',
      errAlreadyBound:
        'Этот кластер уже привязан к другому ПК. Введите Резервный Ключ или получите код в Telegram.',
      msgCodeSentFallback: 'Код отправлен в @Croc_Dream_bot',
      errCodeSend: 'Ошибка отправки кода в Telegram',
      msgRecoveredSuccess: 'Права Владельца успешно перенесены на этот ПК!',
      errInvalidRecovery: 'Неверный резервный ключ или Telegram-код',
    },
    step2: {
      repoLabel: 'GitHub-репозиторий (SoT)',
      branchLabel: 'Ветка',
      webhookUrlLabel: 'Webhook URL',
      githubTokenLabel: 'GitHub Token (опционально)',
      webhookSecretLabel: 'Webhook Secret (опционально)',
      localModeNotice: 'Локальный режим: синхронизация через исходящий git pull',
      enableWebhookBtn: 'Включить Webhook →',
      msgWebhookCreated: 'Репозиторий привязан, Webhook автоматически создан в GitHub!',
      msgRepoSaved: 'Репозиторий GitHub SoT сохранён и синхронизирован!',
      errGithubSave: 'Ошибка сохранения настроек GitHub',
    },
    step3: {
      tgBotTitle: 'Telegram-бот',
      tgLinkedStatus: 'Привязан',
      tgUnlinkedHint: 'Нажмите кнопку и запустите бота (/start)',
      connectTgBtn: 'Подключить TG',
      botTokenLabel: 'Токен бота (опционально)',
      botTokenPlaceholder: 'По умолчанию @Croc_Dream_bot',
      aiKeyLabel: 'Ключ ИИ (Groq / OpenAI)',
      aiAlreadyConfigured: 'Уже подключён',
      msgTelegramSaved: 'Контур Telegram и ИИ сохранён в общем томе Docker!',
      errTelegramSave: 'Ошибка сохранения настроек Telegram',
    },
    step4: {
      sshLiveTitle: 'SSH-сервер (Live)',
      sshLiveSub: 'Подключение к узлам Containerlab / КРОК',
      offlineDemoTitle: 'Демо-стенд (Offline)',
      offlineDemoSub: 'Локальная эмуляция CLOS-фабрики',
      hostLabel: 'Хост',
      portLabel: 'Порт',
      userLabel: 'Логин',
      passwordPlaceholder: 'Пароль SSH (или пусто для SSH-ключа)',
      discoveringBtn: 'Поиск...',
      discoverBtn: 'Найти узлы',
      discoveredNodesCount: 'Найдено узлов:',
      errServerUnreachable: 'Не удалось связаться с сервером',
      openConsoleBtn: 'Открыть пульт',
    },
  },
  en: {
    clusterSetupTitle: 'Cluster Setup',
    skipBtn: 'Skip →',
    backBtn: '← Back',
    nextBtn: 'Next',
    copyBtn: 'Copy',
    copiedBtn: 'OK',
    steps: {
      1: '1. Owner',
      2: '2. GitHub',
      3: '3. Telegram & AI',
      4: '4. Server',
    },
    step1: {
      clusterNameLabel: 'Cluster Name',
      networkContourLabel: 'Network Exposure Contour',
      localOnlyTitle: '🔒 Local Only',
      localOnlyDesc: '127.0.0.1:5173 (isolated)',
      publicTunnelTitle: '🌐 Public Tunnel',
      publicTunnelDesc: '(external)',
      wsTitle: 'Real-Time WebSocket Stream',
      wsEnabledDesc: 'Enabled · ephemeral one-time Ticket (TTL 30s)',
      wsDisabledDesc: 'Disabled · standard HTTP polling',
      wsOn: 'ON',
      wsOff: 'OFF',
      recoveryKeyBanner: 'Owner Recovery Key (save securely):',
      transferAccessBtn: 'Transfer Owner rights from another PC',
      recoverHeader: 'Transfer Owner Authority to This PC',
      recoverStep1Title: '1. Telegram Code',
      requestCodeBtn: 'Request Code',
      botLinkBtn: 'Bot',
      codePlaceholder: '6-digit code',
      recoverStep2Title: '2. Recovery Key',
      bindThisPcBtn: 'Bind This PC →',
      errAlreadyBound:
        'This cluster is already bound to another PC. Enter your Recovery Key or request a Telegram code.',
      msgCodeSentFallback: 'Recovery code sent via @Croc_Dream_bot',
      errCodeSend: 'Failed to send code via Telegram',
      msgRecoveredSuccess: 'Owner rights successfully transferred to this PC!',
      errInvalidRecovery: 'Invalid recovery key or Telegram verification code',
    },
    step2: {
      repoLabel: 'GitHub Repository (SoT)',
      branchLabel: 'Branch',
      webhookUrlLabel: 'Webhook URL',
      githubTokenLabel: 'GitHub Token (optional)',
      webhookSecretLabel: 'Webhook Secret (optional)',
      localModeNotice: 'Local mode: synchronization via outbound git pull',
      enableWebhookBtn: 'Enable Webhook →',
      msgWebhookCreated: 'Repository linked & Webhook automatically created on GitHub!',
      msgRepoSaved: 'GitHub SoT repository saved and synchronized!',
      errGithubSave: 'Failed to save GitHub settings',
    },
    step3: {
      tgBotTitle: 'Telegram Bot',
      tgLinkedStatus: 'Linked',
      tgUnlinkedHint: 'Click connect and start the bot (/start)',
      connectTgBtn: 'Connect TG',
      botTokenLabel: 'Bot Token (optional)',
      botTokenPlaceholder: 'Default @Croc_Dream_bot',
      aiKeyLabel: 'AI API Key (Groq / OpenAI)',
      aiAlreadyConfigured: 'Already configured',
      msgTelegramSaved: 'Telegram & AI settings persisted to shared Docker volume!',
      errTelegramSave: 'Failed to save Telegram settings',
    },
    step4: {
      sshLiveTitle: 'SSH Server (Live)',
      sshLiveSub: 'Connect to live Containerlab / CROC switches',
      offlineDemoTitle: 'Demo Lab (Offline)',
      offlineDemoSub: 'Local deterministic CLOS fabric simulation',
      hostLabel: 'Host',
      portLabel: 'Port',
      userLabel: 'User',
      passwordPlaceholder: 'SSH password (or leave empty for SSH key)',
      discoveringBtn: 'Probing...',
      discoverBtn: 'Discover Nodes',
      discoveredNodesCount: 'Discovered nodes:',
      errServerUnreachable: 'Failed to reach remote server',
      openConsoleBtn: 'Launch Console',
    },
  },
};

export const WelcomeModal: React.FC<WelcomeModalProps> = ({
  isOpen,
  onClose,
  locale,
  setLocale,
  theme,
  setTheme,
}) => {
  const [phase, setPhase] = useState<'welcome' | 'wizard'>('welcome');
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
  const [wizardStep, setWizardStep] = useState<WizardStep>(1);

  // Step 1: Owner Identity, Network Contour & WebSocket Mode
  const [clusterName, setClusterName] = useState('CROC-FABRIC-PROD-01');
  const [exposureMode, setExposureMode] = useState<'local_only' | 'public_tunnel'>('local_only');
  const [websocketEnabled, setWebsocketEnabled] = useState(false);
  const [ownerToken, setOwnerToken] = useState('');
  const [, setBoundClientId] = useState('');
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
  const [webhookSecret, setWebhookSecret] = useState('');
  const [webhookUrl, setWebhookUrl] = useState(
    typeof window !== 'undefined'
      ? `${window.location.origin}/api/v1/git/webhook`
      : 'http://127.0.0.1:5173/api/v1/git/webhook'
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
  const [discoveryResult, setDiscoveryResult] = useState<ServerDiscoveryResponse | null>(null);

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
  const w = WIZARD_COPY[locale];

  const refreshBootstrapStatus = async () => {
    try {
      const st = await api.getBootstrapStatus();
      if (st.cluster_name) setClusterName(st.cluster_name);
      if (st.exposure?.mode === 'public_tunnel' || st.exposure?.mode === 'local_only') {
        setExposureMode(st.exposure.mode);
      }
      if (typeof st.exposure?.websocket_enabled === 'boolean') {
        setWebsocketEnabled(st.exposure.websocket_enabled);
      }
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
        if (st.exposure?.mode === 'public_tunnel' || st.exposure?.mode === 'local_only') {
          setExposureMode(st.exposure.mode);
        }
        if (typeof st.exposure?.websocket_enabled === 'boolean') {
          setWebsocketEnabled(st.exposure.websocket_enabled);
        }
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
      await api.configureBootstrapLayers({
        cluster_name: clusterName.trim() || 'CROC-FABRIC-PROD-01',
        exposure_mode: exposureMode,
        websocket_enabled: websocketEnabled,
      });
      if (exposureMode === 'local_only') {
        localStorage.setItem('netops_share_base_url', 'http://127.0.0.1:5173');
      } else {
        localStorage.setItem('netops_share_base_url', `http://${serverHost}:5173`);
      }
      setOwnerToken(res.token);
      setBoundClientId(res.bound_client_id);
      api.setToken(res.token);
      localStorage.setItem('netops_user_role', 'owner');
      localStorage.setItem('netops_cluster_name', res.cluster_name);
      setRecoverMode(false);
      setWizardStep(2);
    } catch (err: unknown) {
      setRecoverMode(true);
      setRecoveryStatusMsg(getErrorMessage(err, w.step1.errAlreadyBound));
    } finally {
      setClaimingOwner(false);
    }
  };

  const handleRequestTelegramRecoveryCode = async () => {
    setClaimingOwner(true);
    try {
      const res = await api.recoverOwnerAccess({ action: 'request_telegram_code' });
      setRecoveryStatusMsg(res.message || w.step1.msgCodeSentFallback);
    } catch (err: unknown) {
      setRecoveryStatusMsg(getErrorMessage(err, w.step1.errCodeSend));
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
      if (res.token) {
        setOwnerToken(res.token);
        api.setToken(res.token);
      }
      if (res.bound_client_id) {
        setBoundClientId(res.bound_client_id);
      }
      localStorage.setItem('netops_user_role', 'owner');
      setRecoverMode(false);
      setRecoveryStatusMsg(w.step1.msgRecoveredSuccess);
      setWizardStep(2);
    } catch (err: unknown) {
      setRecoveryStatusMsg(getErrorMessage(err, w.step1.errInvalidRecovery));
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
        exposure_mode: exposureMode,
        websocket_enabled: websocketEnabled,
        github_repo_url: githubRepoUrl.trim(),
        github_pat: githubPat.trim() || undefined,
        github_webhook_secret: webhookSecret.trim() || undefined,
        webhook_public_url: webhookUrl.trim(),
      });
      if (res.git?.branch) setGithubBranch(res.git.branch);
      if (res.git?.commit_short) setGithubCommit(res.git.commit_short);
      setGithubSavedMsg(
        res.webhook_status === 'created_on_github'
          ? w.step2.msgWebhookCreated
          : w.step2.msgRepoSaved
      );
      setTimeout(() => setWizardStep(3), 500);
    } catch (err: unknown) {
      setGithubSavedMsg(getErrorMessage(err, w.step2.errGithubSave));
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
      setTelegramSavedMsg(w.step3.msgTelegramSaved);
      setTimeout(() => setWizardStep(4), 500);
    } catch (err: unknown) {
      setTelegramSavedMsg(getErrorMessage(err, w.step3.errTelegramSave));
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
    } catch (err: unknown) {
      setDiscoveryResult({
        status: 'error',
        message: getErrorMessage(err, w.step4.errServerUnreachable),
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

  const stepsMeta: { id: WizardStep; title: string; icon: React.ReactNode }[] = [
    { id: 1, title: w.steps[1], icon: <Key className="w-3.5 h-3.5 shrink-0" /> },
    { id: 2, title: w.steps[2], icon: <GitBranch className="w-3.5 h-3.5 shrink-0" /> },
    { id: 3, title: w.steps[3], icon: <Send className="w-3.5 h-3.5 shrink-0" /> },
    { id: 4, title: w.steps[4], icon: <Server className="w-3.5 h-3.5 shrink-0" /> },
  ];

  const inputClass =
    'w-full bg-[var(--bg-main)] border border-[var(--border-subtle)] focus:border-[var(--border-hover)] rounded-md px-3 py-1.5 text-xs font-mono text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none transition-colors';

  const primaryBtnClass =
    'px-4 py-2 rounded-md bg-[var(--text-primary)] hover:opacity-90 text-[var(--bg-main)] text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-opacity disabled:opacity-50';

  const secondaryBtnClass =
    'px-3 py-1.5 rounded-md border border-[var(--border-subtle)] hover:border-[var(--border-hover)] bg-[var(--bg-elevated)] text-xs font-mono text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer transition-colors';

  const utilityPillClass =
    'h-7 flex items-center gap-1.5 px-2.5 rounded-md border border-[var(--border-subtle)] hover:border-[var(--border-hover)] bg-[var(--bg-card)] hover:bg-[var(--bg-elevated)] text-[11px] font-mono text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-4 bg-[var(--bg-main)]/95 backdrop-blur-xl transition-colors duration-300 overflow-y-auto">
      {/* Global Top-Right Controls during Boot Splash */}
      {phase === 'welcome' && (
        <div className="absolute top-5 right-5 z-20 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className={utilityPillClass}
            title={t.toggleTheme}
          >
            {theme === 'dark' ? (
              <>
                <Sun className="w-3.5 h-3.5 text-amber-400" />
                <span>{t.themeLight}</span>
              </>
            ) : (
              <>
                <Moon className="w-3.5 h-3.5 text-sky-500" />
                <span>{t.themeDark}</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => setLocale(locale === 'ru' ? 'en' : 'ru')}
            className={utilityPillClass}
            title={t.langSwitch}
          >
            <Globe className="w-3.5 h-3.5 text-[var(--text-muted)]" />
            <span className="uppercase font-semibold">{locale === 'ru' ? 'RU → EN' : 'EN → RU'}</span>
          </button>
        </div>
      )}

      {/* PHASE 1: BOOT */}
      {phase === 'welcome' && (
        <div
          onClick={() => setPhase('wizard')}
          className="relative z-10 w-full max-w-md flex flex-col items-center justify-center text-center cursor-pointer animate-win-fade select-none px-4"
        >
          <div className="w-14 h-14 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-subtle)] flex items-center justify-center mb-5 shadow-xl">
            <Network className="w-6 h-6 text-[var(--text-primary)] animate-boot-pulse" />
          </div>

          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-[var(--text-primary)] mb-1.5">
            {t.winHello}
          </h1>
          <p className="text-xs text-[var(--text-secondary)]">{t.winSettingUp}</p>

          <div className="w-48 h-1 bg-[var(--border-subtle)] rounded-full overflow-hidden mt-5 mb-5">
            <div
              className="h-full bg-[var(--text-primary)] transition-all duration-500 ease-out rounded-full"
              style={{ width: `${Math.min(100, preload.step * 25)}%` }}
            />
          </div>

          <div className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3 text-left space-y-1.5 font-mono text-[11px]">
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
                      <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                    ) : (
                      <span className="w-3.5 h-3.5 flex items-center justify-center shrink-0">
                        <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-muted)] animate-pulse" />
                      </span>
                    )}
                    <span className="text-[var(--text-secondary)] truncate">{label}</span>
                  </div>
                  <span className="text-[10px] text-[var(--text-muted)] shrink-0">
                    {done ? 'OK' : '...'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* PHASE 2: COMPACT 4-STEP WIZARD (Gravity UI / GCP Tokenized Dialog) */}
      {phase === 'wizard' && (
        <div className="relative z-10 w-full max-w-xl rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] shadow-2xl text-[var(--text-primary)] animate-win-fade flex flex-col overflow-hidden">
          {/* Header with Integrated Theme & Language Switchers */}
          <div className="px-5 py-3.5 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)]/60">
            <div className="flex items-center justify-between gap-2 mb-3">
              <span className="inline-flex items-center gap-2 text-xs font-mono font-semibold text-[var(--text-primary)]">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                <span>{w.clusterSetupTitle}</span>
              </span>

              <div className="flex items-center gap-1.5">
                {/* Theme Switcher */}
                <button
                  type="button"
                  onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                  className={utilityPillClass}
                  title={t.toggleTheme}
                >
                  {theme === 'dark' ? (
                    <>
                      <Sun className="w-3.5 h-3.5 text-amber-400" />
                      <span className="hidden sm:inline">{t.themeLight}</span>
                    </>
                  ) : (
                    <>
                      <Moon className="w-3.5 h-3.5 text-sky-600" />
                      <span className="hidden sm:inline">{t.themeDark}</span>
                    </>
                  )}
                </button>

                {/* Language Switcher */}
                <button
                  type="button"
                  onClick={() => setLocale(locale === 'ru' ? 'en' : 'ru')}
                  className={utilityPillClass}
                  title={t.langSwitch}
                >
                  <Globe className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                  <span className="uppercase font-semibold">
                    {locale === 'ru' ? 'RU' : 'EN'}
                  </span>
                </button>

                {/* Skip Button */}
                <button
                  type="button"
                  onClick={handleFinishWizard}
                  className="h-7 px-2.5 rounded-md text-[11px] font-mono text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] transition-colors cursor-pointer"
                >
                  {w.skipBtn}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-4 gap-1.5">
              {stepsMeta.map((s) => {
                const active = wizardStep === s.id;
                const completed = wizardStep > s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setWizardStep(s.id)}
                    className={`px-2.5 py-2 rounded-lg border text-xs font-medium transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                      active
                        ? 'border-[var(--text-primary)] bg-[var(--bg-card)] text-[var(--text-primary)] shadow-xs'
                        : completed
                          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                          : 'border-[var(--border-subtle)] bg-[var(--bg-main)]/60 text-[var(--text-secondary)] hover:border-[var(--border-hover)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {completed ? <Check className="w-3.5 h-3.5 shrink-0" /> : s.icon}
                    <span className="truncate">{s.title}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Step Body */}
          <div className="p-5 space-y-4">
            {/* ==================== STEP 1: OWNER & CONTOUR ==================== */}
            {wizardStep === 1 && (
              <div className="space-y-3.5 animate-fade-in">
                {!recoverMode ? (
                  <div className="space-y-3.5">
                    <div>
                      <label className="block text-[11px] font-mono text-[var(--text-secondary)] mb-1">
                        {w.step1.clusterNameLabel}
                      </label>
                      <input
                        type="text"
                        value={clusterName}
                        onChange={(e) => setClusterName(e.target.value)}
                        placeholder="CROC-FABRIC-PROD-01"
                        className={inputClass}
                      />
                    </div>

                    {/* Network Exposure Mode */}
                    <div>
                      <label className="block text-[11px] font-mono text-[var(--text-secondary)] mb-1">
                        {w.step1.networkContourLabel}
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setExposureMode('local_only');
                            setWebhookUrl('http://127.0.0.1:5173/api/v1/git/webhook');
                          }}
                          className={`p-2.5 rounded-lg border text-left cursor-pointer transition-all ${
                            exposureMode === 'local_only'
                              ? 'border-emerald-500/60 bg-emerald-500/10 text-[var(--text-primary)]'
                              : 'border-[var(--border-subtle)] bg-[var(--bg-main)] text-[var(--text-secondary)] hover:border-[var(--border-hover)]'
                          }`}
                        >
                          <div className="text-xs font-semibold">{w.step1.localOnlyTitle}</div>
                          <div className="text-[10px] font-mono text-[var(--text-muted)] mt-0.5">
                            {w.step1.localOnlyDesc}
                          </div>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setExposureMode('public_tunnel');
                            setWebhookUrl(`http://${serverHost}:5173/api/v1/git/webhook`);
                          }}
                          className={`p-2.5 rounded-lg border text-left cursor-pointer transition-all ${
                            exposureMode === 'public_tunnel'
                              ? 'border-sky-500/60 bg-sky-500/10 text-[var(--text-primary)]'
                              : 'border-[var(--border-subtle)] bg-[var(--bg-main)] text-[var(--text-secondary)] hover:border-[var(--border-hover)]'
                          }`}
                        >
                          <div className="text-xs font-semibold">{w.step1.publicTunnelTitle}</div>
                          <div className="text-[10px] font-mono text-[var(--text-muted)] mt-0.5">
                            {serverHost}:5173 {w.step1.publicTunnelDesc}
                          </div>
                        </button>
                      </div>
                    </div>

                    {/* WebSocket Toggle */}
                    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-main)] px-3 py-2.5 flex items-center justify-between gap-3">
                      <div>
                        <div className="text-xs font-semibold text-[var(--text-primary)]">
                          {w.step1.wsTitle}
                        </div>
                        <div className="text-[10px] font-mono text-[var(--text-muted)]">
                          {websocketEnabled ? w.step1.wsEnabledDesc : w.step1.wsDisabledDesc}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setWebsocketEnabled((v) => !v)}
                        className={`px-3 py-1.5 rounded text-xs font-mono font-semibold cursor-pointer transition-colors ${
                          websocketEnabled
                            ? 'bg-emerald-500 text-zinc-950'
                            : 'bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-secondary)]'
                        }`}
                      >
                        {websocketEnabled ? w.step1.wsOn : w.step1.wsOff}
                      </button>
                    </div>

                    {ownerToken && (
                      <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 space-y-1.5">
                        <div className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                          <ShieldCheck className="w-4 h-4" />
                          <span>{w.step1.recoveryKeyBanner}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <code className="flex-1 bg-[var(--bg-main)] border border-[var(--border-subtle)] rounded px-2.5 py-1 text-xs font-mono text-emerald-600 dark:text-emerald-400 select-all">
                            {ownerToken}
                          </code>
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(ownerToken);
                              setCopiedKey(true);
                              setTimeout(() => setCopiedKey(false), 2000);
                            }}
                            className={secondaryBtnClass}
                          >
                            {copiedKey ? w.copiedBtn : w.copyBtn}
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="flex items-center justify-between pt-1">
                      <button
                        type="button"
                        onClick={() => setRecoverMode(true)}
                        className="text-[11px] font-mono text-[var(--text-secondary)] hover:text-[var(--text-primary)] underline cursor-pointer"
                      >
                        {w.step1.transferAccessBtn}
                      </button>

                      <button
                        type="button"
                        onClick={handleClaimOwner}
                        disabled={claimingOwner}
                        className={primaryBtnClass}
                      >
                        <span>{claimingOwner ? '...' : w.nextBtn}</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ) : (
                  /* COMPACT RECOVERY */
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                        <Smartphone className="w-4 h-4" />
                        <span>{w.step1.recoverHeader}</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => setRecoverMode(false)}
                        className="text-xs font-mono text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
                      >
                        {w.backBtn}
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-main)] p-2.5 space-y-2">
                        <div className="text-xs font-medium text-[var(--text-primary)]">
                          {w.step1.recoverStep1Title}
                        </div>
                        <div className="flex gap-1.5">
                          <button
                            type="button"
                            onClick={handleRequestTelegramRecoveryCode}
                            className="px-2.5 py-1 rounded border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[11px] font-mono text-[var(--text-primary)] cursor-pointer"
                          >
                            {w.step1.requestCodeBtn}
                          </button>
                          <a
                            href={telegramRecoverLink}
                            target="_blank"
                            rel="noreferrer"
                            className="px-2.5 py-1 rounded bg-emerald-500/15 text-[11px] font-mono text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1"
                          >
                            <span>{w.step1.botLinkBtn}</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>
                        <input
                          type="text"
                          value={telegramCodeInput}
                          onChange={(e) => setTelegramCodeInput(e.target.value)}
                          placeholder={w.step1.codePlaceholder}
                          className={inputClass}
                        />
                      </div>

                      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-main)] p-2.5 space-y-2">
                        <div className="text-xs font-medium text-[var(--text-primary)]">
                          {w.step1.recoverStep2Title}
                        </div>
                        <input
                          type="text"
                          value={recoveryKeyInput}
                          onChange={(e) => setRecoveryKeyInput(e.target.value)}
                          placeholder="crk_owner_..."
                          className={inputClass}
                        />
                      </div>
                    </div>

                    {recoveryStatusMsg && (
                      <div className="text-xs font-mono text-amber-600 dark:text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded px-2.5 py-1.5">
                        {recoveryStatusMsg}
                      </div>
                    )}

                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={handleVerifyOwnerRecovery}
                        disabled={claimingOwner}
                        className={primaryBtnClass}
                      >
                        {w.step1.bindThisPcBtn}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ==================== STEP 2: GITHUB ==================== */}
            {wizardStep === 2 && (
              <div className="space-y-3.5 animate-fade-in">
                <div className="grid grid-cols-3 gap-2.5">
                  <div className="col-span-2">
                    <label className="block text-[11px] font-mono text-[var(--text-secondary)] mb-1">
                      {w.step2.repoLabel}
                    </label>
                    <input
                      type="text"
                      value={githubRepoUrl}
                      onChange={(e) => setGithubRepoUrl(e.target.value)}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-mono text-[var(--text-secondary)] mb-1">
                      {w.step2.branchLabel}
                    </label>
                    <div className="bg-[var(--bg-main)] border border-emerald-500/30 rounded-md px-2.5 py-1.5 text-xs font-mono text-emerald-600 dark:text-emerald-400 flex items-center justify-between">
                      <span>{githubBranch}</span>
                      <span className="text-[var(--text-muted)]">@{githubCommit}</span>
                    </div>
                  </div>
                </div>

                {exposureMode === 'public_tunnel' ? (
                  <>
                    <div>
                      <label className="block text-[11px] font-mono text-[var(--text-secondary)] mb-1">
                        {w.step2.webhookUrlLabel}
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={webhookUrl}
                          onChange={(e) => setWebhookUrl(e.target.value)}
                          className={inputClass}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText(webhookUrl);
                            setCopiedWebhook(true);
                            setTimeout(() => setCopiedWebhook(false), 2000);
                          }}
                          className={`${secondaryBtnClass} shrink-0`}
                        >
                          {copiedWebhook ? w.copiedBtn : w.copyBtn}
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2.5">
                      <div>
                        <label className="block text-[11px] font-mono text-[var(--text-secondary)] mb-1">
                          {w.step2.githubTokenLabel}
                        </label>
                        <input
                          type="password"
                          value={githubPat}
                          onChange={(e) => setGithubPat(e.target.value)}
                          placeholder="ghp_..."
                          className={inputClass}
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-mono text-[var(--text-secondary)] mb-1">
                          {w.step2.webhookSecretLabel}
                        </label>
                        <input
                          type="password"
                          value={webhookSecret}
                          onChange={(e) => setWebhookSecret(e.target.value)}
                          placeholder="HMAC-SHA256"
                          className={inputClass}
                        />
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="rounded-md border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs text-[var(--text-primary)] flex items-center justify-between gap-2">
                    <span>{w.step2.localModeNotice}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setExposureMode('public_tunnel');
                        setWebhookUrl(`http://${serverHost}:5173/api/v1/git/webhook`);
                      }}
                      className="text-[11px] font-mono text-sky-600 dark:text-sky-400 hover:underline cursor-pointer shrink-0"
                    >
                      {w.step2.enableWebhookBtn}
                    </button>
                  </div>
                )}

                {githubSavedMsg && (
                  <div className="text-xs font-mono text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded px-3 py-1.5">
                    {githubSavedMsg}
                  </div>
                )}

                <div className="flex items-center justify-between pt-1">
                  <button
                    type="button"
                    onClick={() => setWizardStep(1)}
                    className={secondaryBtnClass}
                  >
                    {w.backBtn}
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveGithub}
                    disabled={savingGithub}
                    className={primaryBtnClass}
                  >
                    <span>{savingGithub ? '...' : w.nextBtn}</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}

            {/* ==================== STEP 3: TELEGRAM & AI ==================== */}
            {wizardStep === 3 && (
              <div className="space-y-3.5 animate-fade-in">
                <div className="rounded-md border border-emerald-500/25 bg-emerald-500/10 p-3 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold text-[var(--text-primary)]">
                      {w.step3.tgBotTitle} {telegramBotUsername}
                    </div>
                    <div className="text-[11px] text-[var(--text-secondary)]">
                      {telegramLinked
                        ? `${w.step3.tgLinkedStatus} ${telegramLinkedUser ? `@${telegramLinkedUser}` : ''}`
                        : w.step3.tgUnlinkedHint}
                    </div>
                  </div>
                  <a
                    href={telegramDeepLink}
                    target="_blank"
                    rel="noreferrer"
                    className="px-3.5 py-1.5 rounded-md bg-emerald-500 hover:bg-emerald-400 text-zinc-950 text-xs font-semibold inline-flex items-center gap-1.5 shrink-0"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>{w.step3.connectTgBtn}</span>
                  </a>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[11px] font-mono text-[var(--text-secondary)] mb-1">
                      {w.step3.botTokenLabel}
                    </label>
                    <input
                      type="password"
                      value={telegramBotToken}
                      onChange={(e) => setTelegramBotToken(e.target.value)}
                      placeholder={w.step3.botTokenPlaceholder}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-mono text-[var(--text-secondary)] mb-1">
                      {w.step3.aiKeyLabel}
                    </label>
                    <input
                      type="password"
                      value={groqApiKey}
                      onChange={(e) => setGroqApiKey(e.target.value)}
                      placeholder={aiConfigured ? w.step3.aiAlreadyConfigured : 'gsk_...'}
                      className={inputClass}
                    />
                  </div>
                </div>

                {telegramSavedMsg && (
                  <div className="text-xs font-mono text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded px-3 py-1.5">
                    {telegramSavedMsg}
                  </div>
                )}

                <div className="flex items-center justify-between pt-1">
                  <button
                    type="button"
                    onClick={() => setWizardStep(2)}
                    className={secondaryBtnClass}
                  >
                    {w.backBtn}
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveTelegramAndAi}
                    disabled={savingTelegram}
                    className={primaryBtnClass}
                  >
                    <span>{savingTelegram ? '...' : w.nextBtn}</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}

            {/* ==================== STEP 4: SERVER ==================== */}
            {wizardStep === 4 && (
              <div className="space-y-3.5 animate-fade-in">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setServerMode('ssh')}
                    className={`p-2.5 rounded-lg border text-left cursor-pointer transition-all ${
                      serverMode === 'ssh'
                        ? 'border-emerald-500/60 bg-emerald-500/10 text-[var(--text-primary)]'
                        : 'border-[var(--border-subtle)] bg-[var(--bg-main)] text-[var(--text-secondary)] hover:border-[var(--border-hover)]'
                    }`}
                  >
                    <div className="text-xs font-semibold flex items-center gap-1.5">
                      <Terminal className="w-3.5 h-3.5 text-emerald-500" />
                      <span>{w.step4.sshLiveTitle}</span>
                    </div>
                    <div className="text-[10px] font-mono text-[var(--text-muted)] mt-0.5">
                      {w.step4.sshLiveSub}
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setServerMode('offline')}
                    className={`p-2.5 rounded-lg border text-left cursor-pointer transition-all ${
                      serverMode === 'offline'
                        ? 'border-sky-500/60 bg-sky-500/10 text-[var(--text-primary)]'
                        : 'border-[var(--border-subtle)] bg-[var(--bg-main)] text-[var(--text-secondary)] hover:border-[var(--border-hover)]'
                    }`}
                  >
                    <div className="text-xs font-semibold flex items-center gap-1.5">
                      <Cpu className="w-3.5 h-3.5 text-sky-500" />
                      <span>{w.step4.offlineDemoTitle}</span>
                    </div>
                    <div className="text-[10px] font-mono text-[var(--text-muted)] mt-0.5">
                      {w.step4.offlineDemoSub}
                    </div>
                  </button>
                </div>

                {serverMode === 'ssh' && (
                  <div className="grid grid-cols-4 gap-2">
                    <div className="col-span-2">
                      <label className="block text-[10px] font-mono text-[var(--text-secondary)] mb-1">
                        {w.step4.hostLabel}
                      </label>
                      <input
                        type="text"
                        value={serverHost}
                        onChange={(e) => setServerHost(e.target.value)}
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-mono text-[var(--text-secondary)] mb-1">
                        {w.step4.portLabel}
                      </label>
                      <input
                        type="number"
                        value={serverPort}
                        onChange={(e) => setServerPort(Number(e.target.value))}
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-mono text-[var(--text-secondary)] mb-1">
                        {w.step4.userLabel}
                      </label>
                      <input
                        type="text"
                        value={serverUser}
                        onChange={(e) => setServerUser(e.target.value)}
                        className={inputClass}
                      />
                    </div>
                    <div className="col-span-4 flex gap-2">
                      <input
                        type="password"
                        value={serverPassword}
                        onChange={(e) => setServerPassword(e.target.value)}
                        placeholder={w.step4.passwordPlaceholder}
                        className={inputClass}
                      />
                      <button
                        type="button"
                        onClick={handleDiscoverServer}
                        disabled={discoveringServer}
                        className="px-3.5 py-1.5 rounded-md bg-emerald-500 hover:bg-emerald-400 text-zinc-950 text-xs font-semibold flex items-center gap-1.5 cursor-pointer shrink-0 transition-colors"
                      >
                        <RefreshCw
                          className={`w-3.5 h-3.5 ${discoveringServer ? 'animate-spin' : ''}`}
                        />
                        <span>
                          {discoveringServer ? w.step4.discoveringBtn : w.step4.discoverBtn}
                        </span>
                      </button>
                    </div>
                  </div>
                )}

                {discoveryResult?.discovered_switches && (
                  <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2.5 space-y-2">
                    <div className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>
                        {w.step4.discoveredNodesCount} {discoveryResult.synced_total}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      {discoveryResult.discovered_switches.map((sw: DiscoveredSwitchItem) => (
                        <div
                          key={sw.hostname}
                          className="rounded border border-[var(--border-subtle)] bg-[var(--bg-main)] px-2.5 py-1.5 flex items-center justify-between text-[11px] font-mono"
                        >
                          <span className="text-[var(--text-primary)] truncate">{sw.hostname}</span>
                          <span
                            className={
                              sw.reachable
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-amber-600 dark:text-amber-400'
                            }
                          >
                            {sw.reachable ? 'OK' : 'SYNC'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {discoveryResult?.status === 'error' && discoveryResult.message && (
                  <div className="text-xs font-mono text-rose-600 dark:text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded px-3 py-1.5">
                    {discoveryResult.message}
                  </div>
                )}

                <div className="flex items-center justify-between pt-1">
                  <button
                    type="button"
                    onClick={() => setWizardStep(3)}
                    className={secondaryBtnClass}
                  >
                    {w.backBtn}
                  </button>
                  <button
                    type="button"
                    onClick={handleFinishWizard}
                    className={primaryBtnClass}
                  >
                    <span>{w.step4.openConsoleBtn}</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
