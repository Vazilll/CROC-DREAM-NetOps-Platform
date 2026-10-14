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
  Sun,
  Moon,
} from 'lucide-react';
import {
  api,
  getErrorMessage,
  type UserRole,
  type ServerDiscoveryResponse,
  type DiscoveredSwitchItem,
  type LlmCascadeConfig,
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

type WizardStep = 1 | 2 | 3 | 4 | 5;

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
      3: '3. Telegram',
      4: '4. ИИ',
      5: '5. Сервер',
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
      tgLinkedStatus: 'Владелец автоподгружен:',
      tgUnlinkedHint: 'Введите токен и зайдите в бота (/start) — вы автоматически подгрузитесь как Владелец',
      connectTgBtn: 'Подключить токен',
      botTokenLabel: 'Токен бота (@BotFather HTTP API)',
      botTokenPlaceholder: '8993240454:AAHnq-...',
      aiKeyLabel: 'Ключ ИИ (Groq / OpenAI)',
      aiAlreadyConfigured: 'Уже подключён',
      msgTelegramSaved: 'Токен бота подключён! Зайдите в бота (/start) для автоподгрузки Владельца.',
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
      discoverBtn: 'Подключить',
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
      3: '3. Telegram',
      4: '4. AI',
      5: '5. Server',
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
      tgLinkedStatus: 'Owner auto-loaded:',
      tgUnlinkedHint: 'Enter bot token and open the bot (/start) — you will be auto-loaded as Owner',
      connectTgBtn: 'Connect Token',
      botTokenLabel: 'Bot Token (@BotFather HTTP API)',
      botTokenPlaceholder: '8993240454:AAHnq-...',
      aiKeyLabel: 'AI API Key (Groq / OpenAI)',
      aiAlreadyConfigured: 'Already configured',
      msgTelegramSaved: 'Bot token saved! Open the bot (/start) to auto-load as Owner.',
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
      discoverBtn: 'Connect',
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

  // Step 1: Owner Identity & Network Contour (WebSocket & Auto-commit always ON)
  const [clusterName, setClusterName] = useState('CROC-FABRIC-PROD-01');
  const [exposureMode, setExposureMode] = useState<'local_only' | 'public_tunnel'>('local_only');
  const [ownerToken, setOwnerToken] = useState('');
  const [, setBoundClientId] = useState('');
  const [copiedKey, setCopiedKey] = useState(false);
  const [recoverMode, setRecoverMode] = useState(false);
  const [recoveryKeyInput, setRecoveryKeyInput] = useState('');
  const [telegramCodeInput, setTelegramCodeInput] = useState('');
  const [recoveryStatusMsg, setRecoveryStatusMsg] = useState('');
  const [claimingOwner, setClaimingOwner] = useState(false);

  // Step 2: GitHub SoT (SSH Repo + Target Branch; auto-commit and sync always ON)
  const [githubRepoUrl, setGithubRepoUrl] = useState('');
  const [githubBranch, setGithubBranch] = useState('');
  const [savingGithub, setSavingGithub] = useState(false);
  const [githubSavedMsg, setGithubSavedMsg] = useState('');

  // Step 3: Telegram Bot (Token -> Auto-load Owner when entering bot)
  const [telegramBotToken, setTelegramBotToken] = useState('');
  const [telegramChatId, setTelegramChatId] = useState('');
  const [telegramBotUsername, setTelegramBotUsername] = useState('');
  const [telegramBotConfigured, setTelegramBotConfigured] = useState(false);
  const [telegramRecoverLink, setTelegramRecoverLink] = useState(
    'https://t.me/Croc_Dream_bot?start=recover_owner'
  );
  const [telegramLinked, setTelegramLinked] = useState(false);
  const [telegramLinkedUser, setTelegramLinkedUser] = useState('');
  const [savingTelegram, setSavingTelegram] = useState(false);
  const [telegramSavedMsg, setTelegramSavedMsg] = useState('');

  // Step 4: AI Cluster Cascade
  const [groqApiKey] = useState('');
  const [geminiApiKey] = useState('');
  const [ollamaUrl, setOllamaUrl] = useState('');
  const [llmCascade, setLlmCascade] = useState<LlmCascadeConfig[]>([]);
  const [llmConfigRaw, setLlmConfigRaw] = useState('');
  const [showLlmPasteBox, setShowLlmPasteBox] = useState(true);
  const [, setAiConfigured] = useState(false);
  const [savingAi, setSavingAi] = useState(false);
  const [aiSavedMsg, setAiSavedMsg] = useState('');

  // Step 5: Server (Host & Password only on initial setup)
  const [serverHost, setServerHost] = useState('');
  const [serverPort, setServerPort] = useState(221);
  const [serverUser, setServerUser] = useState('crocdream');
  const [serverPassword, setServerPassword] = useState('');
  const [discoveringServer, setDiscoveringServer] = useState(false);
  const [discoveryResult, setDiscoveryResult] = useState<ServerDiscoveryResponse | null>(null);

  const [preload, setPreload] = useState<PreloadMetrics>({
    devicesCount: 0,
    inSyncCount: 0,
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
      if (st.github?.repo_connected) {
        if (st.github.github_repo_url) setGithubRepoUrl(st.github.github_repo_url);
        if (st.github.branch) setGithubBranch(st.github.branch);
      }
      if (st.telegram?.bot_token_set) {
        setTelegramBotConfigured(true);
        if (st.telegram.bot_username) setTelegramBotUsername(st.telegram.bot_username);
      }
      if (st.telegram?.deep_link_recover) setTelegramRecoverLink(st.telegram.deep_link_recover);
      setTelegramLinked(Boolean(st.owner?.telegram_linked));
      setTelegramLinkedUser(st.owner?.telegram_username || '');
      setTelegramChatId(st.owner?.telegram_chat_id || '');
      if (st.owner?.bound_client_id) setBoundClientId(st.owner.bound_client_id);
      if (st.owner?.recovery_key) setOwnerToken(st.owner.recovery_key);
      if (st.server?.clab_host) setServerHost(st.server.clab_host);
      if (st.server?.clab_port) setServerPort(st.server.clab_port);
      if (st.server?.clab_user) setServerUser(st.server.clab_user);
      if (st.ai?.groq_configured || st.ai?.gemini_configured) setAiConfigured(true);
      if (st.ai?.ollama_url) setOllamaUrl(st.ai.ollama_url);
      if (Array.isArray(st.ai?.cascade) && st.ai.cascade.length > 0) {
        setLlmCascade(st.ai.cascade);
      }

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
        if (st.github?.repo_connected) {
          if (st.github.github_repo_url) setGithubRepoUrl(st.github.github_repo_url);
          if (st.github.branch) setGithubBranch(st.github.branch);
        }
        if (st.telegram?.bot_token_set) {
          setTelegramBotConfigured(true);
          if (st.telegram.bot_username) setTelegramBotUsername(st.telegram.bot_username);
        }
        if (st.telegram?.deep_link_recover) setTelegramRecoverLink(st.telegram.deep_link_recover);
        setTelegramLinked(Boolean(st.owner?.telegram_linked));
        setTelegramLinkedUser(st.owner?.telegram_username || '');
        setTelegramChatId(st.owner?.telegram_chat_id || '');
        if (st.owner?.bound_client_id) setBoundClientId(st.owner.bound_client_id);
        if (st.owner?.recovery_key) setOwnerToken(st.owner.recovery_key);
        if (st.server?.clab_host) setServerHost(st.server.clab_host);
        if (st.server?.clab_port) setServerPort(st.server.clab_port);
        if (st.server?.clab_user) setServerUser(st.server.clab_user);
        if (st.ai?.groq_configured || st.ai?.gemini_configured) setAiConfigured(true);
        if (Array.isArray(st.ai?.cascade) && st.ai.cascade.length > 0) {
          setLlmCascade(st.ai.cascade);
        }
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

  // Poll bootstrap status while on Step 3 (Telegram) so entering the bot auto-loads Owner live
  useEffect(() => {
    if (!isOpen || wizardStep !== 3) return;
    const timer = setInterval(() => {
      void refreshBootstrapStatus();
    }, 2000);
    return () => clearInterval(timer);
  }, [isOpen, wizardStep]);

  // Auto-submit Telegram bot token when user pastes/types a valid BotFather token
  useEffect(() => {
    const cleanTok = telegramBotToken.trim();
    if (!isOpen || wizardStep !== 3 || !/^\d+:[A-Za-z0-9_-]{20,}$/.test(cleanTok)) return;
    const tId = setTimeout(async () => {
      try {
        const res = await api.configureBootstrapLayers({
          telegram_bot_token: cleanTok,
          auto_commit_on_diff: true,
          websocket_enabled: true,
        });
        setTelegramBotConfigured(true);
        if (res.bot_username) setTelegramBotUsername(res.bot_username);
        await refreshBootstrapStatus();
      } catch {
        // ignore background save errors
      }
    }, 450);
    return () => clearTimeout(tId);
  }, [telegramBotToken, isOpen, wizardStep]);

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
        websocket_enabled: true,
        auto_commit_on_diff: true,
      });
      if (exposureMode === 'local_only') {
        localStorage.setItem('netops_share_base_url', 'http://127.0.0.1:5173');
      } else {
        localStorage.setItem(
          'netops_share_base_url',
          serverHost ? `http://${serverHost}:5173` : window.location.origin
        );
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
      localStorage.setItem('netops_cluster_name', clusterName.trim() || 'CROC-FABRIC-PROD-01');
      localStorage.setItem('netops_onboarding_done', 'true');
      setRecoverMode(false);
      setRecoveryStatusMsg(w.step1.msgRecoveredSuccess);
      onClose('owner');
    } catch (err: unknown) {
      setRecoveryStatusMsg(getErrorMessage(err, w.step1.errInvalidRecovery));
    } finally {
      setClaimingOwner(false);
    }
  };

  // Step 2 Action: Connect SSH Git SoT (auto-commit and sync always enabled)
  const handleConnectGithubSsh = async (advanceOnSuccess = false) => {
    const targetUrl = githubRepoUrl.trim();
    if (!targetUrl) {
      if (advanceOnSuccess) {
        setWizardStep(3);
        return;
      }
      setGithubSavedMsg(
        locale === 'en'
          ? 'Enter a GitHub repository URL (SSH or HTTPS)'
          : 'Введите URL репозитория GitHub (SSH или HTTPS)'
      );
      return;
    }
    setSavingGithub(true);
    setGithubSavedMsg('');
    try {
      const res = await api.configureBootstrapLayers({
        cluster_name: clusterName.trim(),
        exposure_mode: exposureMode,
        websocket_enabled: true,
        github_repo_url: targetUrl,
        github_branch: githubBranch.trim() || 'main',
        auto_commit_on_diff: true,
      });
      const detectedBranch = res.git?.branch || githubBranch.trim() || 'main';
      const detectedCommit = res.git?.commit_short || 'HEAD';
      setGithubBranch(detectedBranch);
      setGithubSavedMsg(`SSH подключён: ${targetUrl} → ветка ${detectedBranch}@${detectedCommit}`);
      if (advanceOnSuccess) {
        setTimeout(() => setWizardStep(3), 400);
      }
    } catch (err: unknown) {
      setGithubSavedMsg(getErrorMessage(err, w.step2.errGithubSave));
    } finally {
      setSavingGithub(false);
    }
  };

  // Step 3 Action: Save Telegram Bot Token & Auto-load Owner
  const handleSaveTelegram = async (advanceOnSuccess = false) => {
    setSavingTelegram(true);
    setTelegramSavedMsg('');
    try {
      if (telegramBotToken.trim()) {
        const res = await api.configureBootstrapLayers({
          telegram_bot_token: telegramBotToken.trim(),
          auto_commit_on_diff: true,
          websocket_enabled: true,
        });
        setTelegramBotConfigured(true);
        if (res.bot_username) setTelegramBotUsername(res.bot_username);
        setTelegramSavedMsg(w.step3.msgTelegramSaved);
      }
      await refreshBootstrapStatus();
      if (advanceOnSuccess) {
        setWizardStep(4);
      }
    } catch (err: unknown) {
      setTelegramSavedMsg(getErrorMessage(err, w.step3.errTelegramSave));
    } finally {
      setSavingTelegram(false);
    }
  };

  const parseLlmConfigText = (rawText: string): LlmCascadeConfig[] => {
    const trimmed = rawText.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      return arr
        .filter((x) => x && typeof x === 'object' && (x.base_url || x.model || x.api_key))
        .map((x, idx) => ({
          name: String(x.name || x.provider || `LLM-${idx + 1}`),
          base_url: String(x.base_url || 'https://api.groq.com/openai/v1'),
          model: String(x.model || 'qwen/qwen3.8-27b'),
          api_key: String(x.api_key || x.token || ''),
          timeout_seconds: Number(x.timeout_seconds || 2.0),
        }));
    } catch {
      const kv: Record<string, string> = {};
      for (const line of trimmed.split(/\r?\n/)) {
        const clean = line.trim();
        if (!clean || clean.startsWith('#') || !clean.includes('=')) continue;
        const eqIdx = clean.indexOf('=');
        const k = clean.slice(0, eqIdx).trim().toUpperCase();
        const v = clean.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, '');
        kv[k] = v;
      }
      const out: LlmCascadeConfig[] = [];
      if (kv.NETOPS_GROQ_API_KEY || kv.GROQ_API_KEY) {
        out.push({
          name: 'Groq',
          base_url: kv.NETOPS_GROQ_BASE_URL || 'https://api.groq.com/openai/v1',
          model: kv.NETOPS_GROQ_MODEL || 'qwen/qwen3.8-27b',
          api_key: kv.NETOPS_GROQ_API_KEY || kv.GROQ_API_KEY,
          timeout_seconds: Number(kv.NETOPS_GROQ_TIMEOUT_SECONDS || 2.0),
        });
      }
      if (kv.NETOPS_GEMINI_API_KEY || kv.GEMINI_API_KEY) {
        out.push({
          name: 'Google-Gemini',
          base_url:
            kv.NETOPS_GEMINI_BASE_URL ||
            'https://generativelanguage.googleapis.com/v1beta/openai',
          model: kv.NETOPS_GEMINI_MODEL || 'gemini-2.5-flash',
          api_key: kv.NETOPS_GEMINI_API_KEY || kv.GEMINI_API_KEY,
          timeout_seconds: Number(kv.NETOPS_GEMINI_TIMEOUT_SECONDS || 2.0),
        });
      }
      if (kv.NETOPS_OLLAMA_URL || kv.OLLAMA_URL) {
        out.push({
          name: 'Local-Ollama',
          base_url: kv.NETOPS_OLLAMA_URL || kv.OLLAMA_URL,
          model: kv.NETOPS_OLLAMA_MODEL || 'qwen2.5:7b',
          api_key: 'ollama',
          timeout_seconds: Number(kv.NETOPS_OLLAMA_TIMEOUT_SECONDS || 4.0),
        });
      }
      return out;
    }
  };

  const handleApplyLlmConfig = () => {
    const parsed = parseLlmConfigText(llmConfigRaw);
    if (parsed.length === 0) {
      setAiSavedMsg('Не удалось распознать конфиг (вставьте JSON или ENV)');
      return;
    }
    setLlmCascade((prev) => [...prev, ...parsed]);
    setLlmConfigRaw('');
    setShowLlmPasteBox(false);
    setAiSavedMsg(`Добавлено в каскад нейросетей: ${parsed.map((p) => p.name).join(', ')}`);
  };

  // Step 4 Action: Save AI Cluster Cascade
  const handleSaveAiCluster = async () => {
    setSavingAi(true);
    setAiSavedMsg('');
    try {
      const extraFromPaste = parseLlmConfigText(llmConfigRaw);
      const finalCascade = [...llmCascade, ...extraFromPaste];
      if (extraFromPaste.length > 0) {
        setLlmCascade(finalCascade);
        setLlmConfigRaw('');
      }
      await api.configureBootstrapLayers({
        groq_api_key: groqApiKey.trim() || undefined,
        gemini_api_key: geminiApiKey.trim() || undefined,
        ollama_url: ollamaUrl.trim() || undefined,
        llm_cascade: finalCascade,
        auto_commit_on_diff: true,
        websocket_enabled: true,
      });
      await refreshBootstrapStatus();
      setWizardStep(5);
    } catch (err: unknown) {
      setAiSavedMsg(getErrorMessage(err, 'Ошибка сохранения кластера ИИ'));
    } finally {
      setSavingAi(false);
    }
  };

  // Step 5 Action: Server Connection (Host & Password only)
  const handleDiscoverServer = async () => {
    if (!serverHost.trim()) {
      setDiscoveryResult({
        status: 'error',
        message: 'Введите IP-адрес или хост сервера',
      });
      return;
    }
    setDiscoveringServer(true);
    try {
      const res = await api.discoverAndAttachServer({
        mode: 'ssh',
        host: serverHost.trim(),
        port: Number(serverPort) || 221,
        username: serverUser.trim() || 'crocdream',
        password: serverPassword || undefined,
        switch_password_cisco: 'admin',
        switch_password_arista: 'admin',
        switch_password_huawei: 'admin',
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
        auto_commit_on_diff: true,
        websocket_enabled: true,
      });
    } catch {
      // ignore
    }
    if (!ownerToken) {
      api.setToken('dev-owner-token');
    }
    if (exposureMode !== 'local_only' && serverHost.trim()) {
      localStorage.setItem('netops_share_base_url', `http://${serverHost.trim()}:5173`);
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
          'Warming up Telemetry & HierConfig AST',
          'Initializing Matryoshka Owner Bootstrap Engine',
        ]
      : [
          'Подключение ядра PostgreSQL 16 и брокера Redis 7',
          `Индексация топологии CLOS (${preload.devicesCount} узлов в базе)`,
          'Прогрев телеметрии и HierConfig AST',
          'Запуск автономного мастера настройки Владельца («Матрёшка»)',
        ];

  const stepsMeta: { id: WizardStep; title: string; icon: React.ReactNode }[] = [
    { id: 1, title: w.steps[1], icon: <Key className="w-3.5 h-3.5 shrink-0" /> },
    { id: 2, title: w.steps[2], icon: <GitBranch className="w-3.5 h-3.5 shrink-0" /> },
    { id: 3, title: w.steps[3], icon: <Send className="w-3.5 h-3.5 shrink-0" /> },
    { id: 4, title: w.steps[4], icon: <Cpu className="w-3.5 h-3.5 shrink-0" /> },
    { id: 5, title: w.steps[5], icon: <Server className="w-3.5 h-3.5 shrink-0" /> },
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

      {/* PHASE 2: COMPACT 5-STEP WIZARD */}
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

            <div className="grid grid-cols-5 gap-1.5">
              {stepsMeta.map((s) => {
                const active = wizardStep === s.id;
                const completed = wizardStep > s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setWizardStep(s.id)}
                    className={`px-2 py-2 rounded-lg border text-[11px] font-medium transition-all cursor-pointer flex items-center justify-center gap-1 ${
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
                          }}
                          className={`p-2.5 rounded-lg border text-left cursor-pointer transition-all ${
                            exposureMode === 'public_tunnel'
                              ? 'border-sky-500/60 bg-sky-500/10 text-[var(--text-primary)]'
                              : 'border-[var(--border-subtle)] bg-[var(--bg-main)] text-[var(--text-secondary)] hover:border-[var(--border-hover)]'
                          }`}
                        >
                          <div className="text-xs font-semibold">{w.step1.publicTunnelTitle}</div>
                          <div className="text-[10px] font-mono text-[var(--text-muted)] mt-0.5">
                            {serverHost || window.location.hostname}:5173 {w.step1.publicTunnelDesc}
                          </div>
                        </button>
                      </div>
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

            {/* ==================== STEP 2: GITHUB (SSH + TARGET BRANCH ONLY) ==================== */}
            {wizardStep === 2 && (
              <div className="space-y-3.5 animate-fade-in">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-[11px] font-mono text-[var(--text-secondary)]">
                      SSH-репозиторий GitHub (единый контур SoT)
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setGithubRepoUrl('git@github.com:Vazilll/CROC-DREAM-NetOps-Platform.git');
                        if (!githubBranch) setGithubBranch('main');
                      }}
                      className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer"
                    >
                      Вставить git@github.com:Vazilll/...
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={githubRepoUrl}
                      onChange={(e) => setGithubRepoUrl(e.target.value)}
                      placeholder="git@github.com:Vazilll/CROC-DREAM-NetOps-Platform.git"
                      className={inputClass}
                    />
                    <button
                      type="button"
                      onClick={() => void handleConnectGithubSsh(false)}
                      disabled={savingGithub}
                      className="px-3 py-1.5 rounded-md bg-emerald-500 hover:bg-emerald-400 text-zinc-950 text-xs font-semibold shrink-0 cursor-pointer transition-colors"
                    >
                      {savingGithub ? '...' : 'Подключить SSH'}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-mono text-[var(--text-secondary)] mb-1">
                    Целевая ветка (определяется при подключении)
                  </label>
                  <input
                    type="text"
                    value={githubBranch}
                    onChange={(e) => setGithubBranch(e.target.value)}
                    placeholder="Нажмите «Подключить SSH» (напр. main)"
                    className={inputClass}
                  />
                </div>

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
                    onClick={() => void handleConnectGithubSsh(true)}
                    disabled={savingGithub}
                    className={primaryBtnClass}
                  >
                    <span>{savingGithub ? '...' : w.nextBtn}</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}

            {/* ==================== STEP 3: TELEGRAM (TOKEN -> AUTO-LOAD OWNER) ==================== */}
            {wizardStep === 3 && (
              <div className="space-y-3.5 animate-fade-in">
                <div>
                  <label className="block text-[11px] font-mono text-[var(--text-secondary)] mb-1">
                    {w.step3.botTokenLabel}
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="password"
                      value={telegramBotToken}
                      onChange={(e) => setTelegramBotToken(e.target.value)}
                      placeholder={w.step3.botTokenPlaceholder}
                      className={inputClass}
                    />
                    <button
                      type="button"
                      onClick={() => void handleSaveTelegram(false)}
                      disabled={savingTelegram || !telegramBotToken.trim()}
                      className="px-3 py-1.5 rounded-md bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-zinc-950 text-xs font-semibold shrink-0 cursor-pointer transition-colors"
                    >
                      {savingTelegram ? '...' : w.step3.connectTgBtn}
                    </button>
                  </div>
                </div>

                {telegramLinked ? (
                  <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs font-mono text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      <span>
                        {w.step3.tgLinkedStatus}{' '}
                        <strong>
                          {telegramLinkedUser ? `@${telegramLinkedUser}` : 'owner'}
                        </strong>
                        {telegramChatId ? ` (ID: ${telegramChatId})` : ''}
                      </span>
                    </div>
                    <span className="px-2 py-0.5 rounded bg-emerald-500 text-zinc-950 text-[10px] font-mono font-bold">
                      OWNER
                    </span>
                  </div>
                ) : (
                  <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-main)] p-3 text-xs font-mono text-[var(--text-secondary)] flex items-center justify-between gap-2">
                    <span>
                      {telegramBotConfigured && telegramBotUsername
                        ? `Бот ${telegramBotUsername} подключён. Зайдите в бота (/start) — вы автоподгрузитесь как Владелец.`
                        : w.step3.tgUnlinkedHint}
                    </span>
                    <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse shrink-0" />
                  </div>
                )}

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
                    onClick={() => void handleSaveTelegram(true)}
                    disabled={savingTelegram}
                    className={primaryBtnClass}
                  >
                    <span>{savingTelegram ? '...' : w.nextBtn}</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}

            {/* ==================== STEP 4: AI CLUSTER ==================== */}
            {wizardStep === 4 && (
              <div className="space-y-3 animate-fade-in">
                <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-main)]/60 p-3 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-mono font-semibold text-[var(--text-primary)]">
                      Каскад конфигов нейросетей ({llmCascade.length} активн.)
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setShowLlmPasteBox((v) => !v)}
                        className="px-2 py-0.5 rounded border border-[var(--border-subtle)] hover:border-[var(--border-hover)] bg-[var(--bg-card)] text-[10px] font-mono text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
                      >
                        {showLlmPasteBox ? 'Скрыть импорт' : '+ Вставить конфиг'}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setLlmCascade((prev) => [
                            ...prev,
                            {
                              name: `LLM-${prev.length + 1}`,
                              base_url: 'https://api.groq.com/openai/v1',
                              model: 'qwen/qwen3.8-27b',
                              api_key: '',
                              timeout_seconds: 2.0,
                            },
                          ])
                        }
                        className="px-2 py-0.5 rounded border border-emerald-500/40 bg-emerald-500/10 text-[10px] font-mono text-emerald-600 dark:text-emerald-400 cursor-pointer"
                      >
                        + Поля вручную
                      </button>
                    </div>
                  </div>

                  {showLlmPasteBox && (
                    <div className="space-y-1.5">
                      <textarea
                        rows={4}
                        value={llmConfigRaw}
                        onChange={(e) => setLlmConfigRaw(e.target.value)}
                        placeholder={
                          '{\n  "name": "Groq",\n  "base_url": "https://api.groq.com/openai/v1",\n  "model": "qwen/qwen3.8-27b",\n  "api_key": "gsk_...",\n  "timeout_seconds": 2.0\n}'
                        }
                        className={`${inputClass} leading-relaxed resize-y`}
                      />
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-mono text-[var(--text-muted)]">
                          Поддерживается JSON-конфиг (объект/массив) или блок .env (NETOPS_GROQ_...)
                        </span>
                        <button
                          type="button"
                          onClick={handleApplyLlmConfig}
                          className="px-2.5 py-1 rounded bg-emerald-500 hover:bg-emerald-400 text-zinc-950 text-[11px] font-mono font-semibold cursor-pointer shrink-0"
                        >
                          Добавить в каскад
                        </button>
                      </div>
                    </div>
                  )}

                  {llmCascade.length > 0 && (
                    <div className="space-y-2 max-h-44 overflow-y-auto pr-1">
                      {llmCascade.map((item, idx) => (
                        <div
                          key={idx}
                          className="rounded border border-[var(--border-subtle)] bg-[var(--bg-card)] p-2 space-y-1.5"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[10px] font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                              Приоритет #{idx + 1} · {item.name} ({item.model})
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                setLlmCascade((prev) => prev.filter((_, i) => i !== idx))
                              }
                              className="text-[10px] font-mono text-rose-500 hover:underline cursor-pointer"
                            >
                              Удалить ×
                            </button>
                          </div>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                            <input
                              type="text"
                              value={item.name}
                              onChange={(e) =>
                                setLlmCascade((prev) =>
                                  prev.map((p, i) =>
                                    i === idx ? { ...p, name: e.target.value } : p
                                  )
                                )
                              }
                              placeholder="Имя (Groq)"
                              className={inputClass}
                            />
                            <input
                              type="text"
                              value={item.model}
                              onChange={(e) =>
                                setLlmCascade((prev) =>
                                  prev.map((p, i) =>
                                    i === idx ? { ...p, model: e.target.value } : p
                                  )
                                )
                              }
                              placeholder="Модель"
                              className={inputClass}
                            />
                            <input
                              type="text"
                              value={item.base_url}
                              onChange={(e) =>
                                setLlmCascade((prev) =>
                                  prev.map((p, i) =>
                                    i === idx ? { ...p, base_url: e.target.value } : p
                                  )
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
                                  prev.map((p, i) =>
                                    i === idx ? { ...p, api_key: e.target.value } : p
                                  )
                                )
                              }
                              placeholder="API Key (gsk_...)"
                              className={inputClass}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {aiSavedMsg && (
                  <div className="text-xs font-mono text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded px-3 py-1.5">
                    {aiSavedMsg}
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
                    onClick={handleSaveAiCluster}
                    disabled={savingAi}
                    className={primaryBtnClass}
                  >
                    <span>{savingAi ? '...' : w.nextBtn}</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}

            {/* ==================== STEP 5: SERVER (HOST & PASSWORD ONLY) ==================== */}
            {wizardStep === 5 && (
              <div className="space-y-3.5 animate-fade-in">
                <div>
                  <label className="block text-[11px] font-mono text-[var(--text-secondary)] mb-1">
                    {w.step4.hostLabel}
                  </label>
                  <input
                    type="text"
                    value={serverHost}
                    onChange={(e) => setServerHost(e.target.value)}
                    placeholder="IP или хост сервера (напр. 10.0.0.10)"
                    className={inputClass}
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-mono text-[var(--text-secondary)] mb-1">
                    Пароль
                  </label>
                  <div className="flex gap-2">
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

                {discoveryResult?.discovered_switches && (
                  <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2.5 space-y-2">
                    <div className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>
                          {w.step4.discoveredNodesCount} {discoveryResult.synced_total}
                        </span>
                      </span>
                      {discoveryResult.discovered_containers && (
                        <span className="text-[10px] font-mono text-[var(--text-secondary)]">
                          Docker: {discoveryResult.discovered_containers.length}
                        </span>
                      )}
                    </div>
                    {discoveryResult.discovered_switches.length > 0 ? (
                      <div className="grid grid-cols-2 gap-1.5">
                        {discoveryResult.discovered_switches.map((sw: DiscoveredSwitchItem) => (
                          <div
                            key={sw.hostname}
                            className="rounded border border-[var(--border-subtle)] bg-[var(--bg-main)] px-2.5 py-1.5 flex items-center justify-between text-[11px] font-mono"
                          >
                            <span className="text-[var(--text-primary)] font-semibold truncate">
                              {sw.hostname}
                            </span>
                            <span
                              className={
                                sw.reachable
                                  ? 'text-emerald-600 dark:text-emerald-400'
                                  : 'text-rose-500 dark:text-rose-400'
                              }
                            >
                              {sw.reachable ? 'SSH OK' : 'OFFLINE'}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-[11px] font-mono text-amber-600 dark:text-amber-400">
                        SSH-сервер доступен, но активных SSH-портов коммутаторов (Containerlab) не обнаружено.
                      </div>
                    )}
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
                    onClick={() => setWizardStep(4)}
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
