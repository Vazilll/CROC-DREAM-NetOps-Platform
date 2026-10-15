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
      tgLinkedStatus: 'Владелец:',
      tgUnlinkedHint: 'Откройте бота (/start) для привязки Владельца',
      connectTgBtn: 'Подключить',
      botTokenLabel: 'Токен бота (@BotFather)',
      botTokenPlaceholder: '8993240454:AAHnq-...',
      aiKeyLabel: 'Ключ ИИ (Groq / OpenAI)',
      aiAlreadyConfigured: 'Подключён',
      msgTelegramSaved: 'Токен бота сохранён.',
      errTelegramSave: 'Ошибка сохранения настроек Telegram',
    },
    step4: {
      sshLiveTitle: 'SSH-сервер (Live)',
      sshLiveSub: 'Containerlab / КРОК',
      offlineDemoTitle: 'Демо-стенд (Offline)',
      offlineDemoSub: 'Локальная эмуляция CLOS-фабрики',
      hostLabel: 'Хост',
      portLabel: 'Порт',
      userLabel: 'Логин',
      passwordPlaceholder: 'Пароль SSH',
      discoveringBtn: 'Поиск...',
      discoverBtn: 'Подключить',
      discoveredNodesCount: 'Узлов:',
      errServerUnreachable: 'Сервер недоступен',
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
      tgLinkedStatus: 'Owner:',
      tgUnlinkedHint: 'Open the bot (/start) to link Owner',
      connectTgBtn: 'Connect',
      botTokenLabel: 'Bot Token (@BotFather)',
      botTokenPlaceholder: '8993240454:AAHnq-...',
      aiKeyLabel: 'AI API Key (Groq / OpenAI)',
      aiAlreadyConfigured: 'Configured',
      msgTelegramSaved: 'Bot token saved.',
      errTelegramSave: 'Failed to save Telegram settings',
    },
    step4: {
      sshLiveTitle: 'SSH Server (Live)',
      sshLiveSub: 'Containerlab / CROC switches',
      offlineDemoTitle: 'Demo Lab (Offline)',
      offlineDemoSub: 'Local CLOS fabric simulation',
      hostLabel: 'Host',
      portLabel: 'Port',
      userLabel: 'User',
      passwordPlaceholder: 'SSH password',
      discoveringBtn: 'Probing...',
      discoverBtn: 'Connect',
      discoveredNodesCount: 'Nodes:',
      errServerUnreachable: 'Failed to reach remote server',
      openConsoleBtn: 'Launch Console',
    },
  },
};

const KNOWN_LLM_URLS = new Set([
  '',
  'https://api.groq.com/openai/v1',
  'https://generativelanguage.googleapis.com/v1beta/openai/',
  'https://api.deepseek.com/v1',
  'https://openrouter.ai/api/v1',
  'http://localhost:11434/v1',
  'https://api.openai.com/v1',
  'https://api.hcnsec.cn/v1',
]);

const KNOWN_LLM_MODELS = new Set([
  '',
  'llama-3.3-70b-versatile',
  'gemini-2.0-flash',
  'deepseek-chat',
  'deepseek/deepseek-chat',
  'qwen2.5-coder:7b',
  'gpt-4o-mini',
  'MiMo-V2.6-Flash',
]);

export function inferLlmProviderDefaults(
  name: string,
  apiKey: string,
  baseUrl: string,
  model: string,
  forceFallback = false
): { base_url: string; model: string } {
  const n = name.trim().toLowerCase();
  const k = apiKey.trim();
  let inferredUrl = '';
  let inferredModel = '';

  if (n.includes('groq') || k.startsWith('gsk_')) {
    inferredUrl = 'https://api.groq.com/openai/v1';
    inferredModel = 'llama-3.3-70b-versatile';
  } else if (n.includes('gemini') || n.includes('google') || k.startsWith('AIza')) {
    inferredUrl = 'https://generativelanguage.googleapis.com/v1beta/openai/';
    inferredModel = 'gemini-2.0-flash';
  } else if (n.includes('openrouter') || k.startsWith('sk-or-')) {
    inferredUrl = 'https://openrouter.ai/api/v1';
    inferredModel = 'deepseek/deepseek-chat';
  } else if (n.includes('deepseek')) {
    inferredUrl = 'https://api.deepseek.com/v1';
    inferredModel = 'deepseek-chat';
  } else if (n.includes('ollama') || n.includes('local') || n.includes('qwen')) {
    inferredUrl = 'http://localhost:11434/v1';
    inferredModel = 'qwen2.5-coder:7b';
  } else if (n.includes('mimo') || n.includes('xiaomi') || n.includes('hcnsec')) {
    inferredUrl = 'https://api.hcnsec.cn/v1';
    inferredModel = 'MiMo-V2.6-Flash';
  } else if (n.includes('openai') || n.includes('gpt') || k.startsWith('sk-')) {
    inferredUrl = 'https://api.openai.com/v1';
    inferredModel = 'gpt-4o-mini';
  } else if (forceFallback && (n.length > 0 || k.length > 0)) {
    inferredUrl = 'https://api.hcnsec.cn/v1';
    inferredModel = 'MiMo-V2.6-Flash';
  }

  const curUrl = baseUrl.trim();
  const curModel = model.trim();
  const nextUrl =
    inferredUrl && (curUrl === '' || KNOWN_LLM_URLS.has(curUrl)) ? inferredUrl : curUrl;
  const nextModel =
    inferredModel && (curModel === '' || KNOWN_LLM_MODELS.has(curModel))
      ? inferredModel
      : curModel;

  return {
    base_url: nextUrl || (forceFallback ? 'https://api.hcnsec.cn/v1' : curUrl),
    model: nextModel || (forceFallback ? 'MiMo-V2.6-Flash' : curModel),
  };
}

const LLM_PRESETS: Array<{
  label: string;
  name: string;
  base_url: string;
  model: string;
  timeout_seconds: number;
}> = [
  {
    label: '+ Groq',
    name: 'Groq',
    base_url: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
    timeout_seconds: 2.5,
  },
  {
    label: '+ Gemini',
    name: 'Gemini',
    base_url: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    model: 'gemini-2.0-flash',
    timeout_seconds: 3.0,
  },
  {
    label: '+ DeepSeek',
    name: 'DeepSeek',
    base_url: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    timeout_seconds: 3.5,
  },
  {
    label: '+ OpenRouter',
    name: 'OpenRouter',
    base_url: 'https://openrouter.ai/api/v1',
    model: 'deepseek/deepseek-chat',
    timeout_seconds: 3.5,
  },
  {
    label: '+ Ollama',
    name: 'Ollama',
    base_url: 'http://localhost:11434/v1',
    model: 'qwen2.5-coder:7b',
    timeout_seconds: 4.0,
  },
  {
    label: '+ MiMo',
    name: 'MiMo',
    base_url: 'https://api.hcnsec.cn/v1',
    model: 'MiMo-V2.6-Flash',
    timeout_seconds: 2.5,
  },
];

export const WelcomeModal: React.FC<WelcomeModalProps> = ({
  isOpen,
  onClose,
  locale,
  setLocale,
  theme,
  setTheme,
}) => {
  const [phase, setPhase] = useState<'welcome' | 'wizard'>(() =>
    typeof window !== 'undefined' && localStorage.getItem('netops_onboarding_done') === 'true'
      ? 'wizard'
      : 'welcome'
  );
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
  const [wizardStep, setWizardStep] = useState<WizardStep>(1);

  // Step 1: Owner Identity & Network Contour (WebSocket & Auto-commit always ON)
  const [clusterName, setClusterName] = useState('CROC-FABRIC-PROD-01');
  const [exposureMode, setExposureMode] = useState<'local_only' | 'public_tunnel'>('local_only');
  const [ownerToken, setOwnerToken] = useState('');
  const [copiedKey, setCopiedKey] = useState(false);
  const [recoverMode, setRecoverMode] = useState(false);
  const [recoveryKeyInput, setRecoveryKeyInput] = useState('');
  const [telegramCodeInput, setTelegramCodeInput] = useState('');
  const [recoveryStatusMsg, setRecoveryStatusMsg] = useState('');
  const [claimingOwner, setClaimingOwner] = useState(false);
  const [clusterInitialized, setClusterInitialized] = useState(false);
  const [bootstrapCompleted, setBootstrapCompleted] = useState(false);
  const [callerIsBoundOwner, setCallerIsBoundOwner] = useState(true);
  const [hasPopulatedDb, setHasPopulatedDb] = useState(false);
  const [canTransferOwnerFlag, setCanTransferOwnerFlag] = useState(false);

  // Step 2: GitHub SoT (Private/Public Repo + PAT + Target Branch; auto-commit and sync always ON)
  const [githubRepoUrl, setGithubRepoUrl] = useState('');
  const [githubBranch, setGithubBranch] = useState('');
  const [githubPat, setGithubPat] = useState('');
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
  const [llmCascade, setLlmCascade] = useState<LlmCascadeConfig[]>([
    { name: '', base_url: '', model: '', api_key: '', timeout_seconds: 2.5 },
  ]);
  const [llmConfigRaw, setLlmConfigRaw] = useState('');
  const [showLlmPasteBox, setShowLlmPasteBox] = useState(false);
  const [savingAi, setSavingAi] = useState(false);
  const [aiSavedMsg, setAiSavedMsg] = useState('');
  const [aiMsgError, setAiMsgError] = useState(false);

  // Step 5: Server (Host & Password)
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
      const doneBefore =
        typeof window !== 'undefined' && localStorage.getItem('netops_onboarding_done') === 'true';
      setPhase(doneBefore ? 'wizard' : 'welcome');
    }
  }

  const t = translations[locale];
  const w = WIZARD_COPY[locale];

  const applyBootstrapStatusToState = (st: Awaited<ReturnType<typeof api.getBootstrapStatus>>) => {
    setClusterInitialized(Boolean(st.initialized));
    setBootstrapCompleted(Boolean(st.bootstrap_completed));
    setCallerIsBoundOwner(st.caller_is_bound_owner !== false);
    setHasPopulatedDb(Boolean(st.has_populated_db || (st.server?.devices_count ?? 0) > 0));
    setCanTransferOwnerFlag(Boolean(st.can_transfer_owner));

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
    if (st.owner?.recovery_key) setOwnerToken(st.owner.recovery_key);
    if (st.server?.clab_host) setServerHost(st.server.clab_host);
    if (st.server?.clab_port) setServerPort(st.server.clab_port);
    if (st.server?.clab_user) setServerUser(st.server.clab_user);
    if (Array.isArray(st.ai?.cascade) && st.ai.cascade.length > 0) {
      setLlmCascade(st.ai.cascade);
    }

    if (st.initialized && !st.caller_is_bound_owner) {
      setRecoverMode(true);
    }
  };

  const refreshBootstrapStatus = async () => {
    try {
      const st = await api.getBootstrapStatus();
      applyBootstrapStatusToState(st);
    } catch {
      // fallback to defaults
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    let active = true;

    const doneBefore =
      typeof window !== 'undefined' && localStorage.getItem('netops_onboarding_done') === 'true';

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
        applyBootstrapStatusToState(bootRes.value);
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

    const transitionTimer = setTimeout(
      () => {
        if (active) setPhase('wizard');
      },
      doneBefore ? 0 : 1800
    );

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

  const showTransferOwnerBtn =
    canTransferOwnerFlag ||
    ((clusterInitialized || bootstrapCompleted) && (hasPopulatedDb || preload.devicesCount > 0)) ||
    (!callerIsBoundOwner && clusterInitialized);

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

  // Step 2 Action: Connect Git SoT (Private HTTPS w/ PAT or SSH; auto-commit and sync always enabled)
  const handleConnectGithubSsh = async (advanceOnSuccess = false) => {
    const targetUrl = githubRepoUrl.trim();
    if (!targetUrl) {
      if (advanceOnSuccess) {
        setWizardStep(3);
        return;
      }
      setGithubSavedMsg(
        locale === 'en'
          ? 'Enter a GitHub repository URL (HTTPS or SSH)'
          : 'Введите URL репозитория GitHub (HTTPS или SSH)'
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
        github_pat: githubPat.trim() || undefined,
        auto_commit_on_diff: true,
      });
      const detectedBranch = res.git?.branch || githubBranch.trim() || 'main';
      const detectedCommit = res.git?.commit_short || 'HEAD';
      setGithubBranch(detectedBranch);
      setGithubSavedMsg(
        locale === 'en'
          ? `Connected: ${targetUrl} → ${detectedBranch}@${detectedCommit}`
          : `Подключён: ${targetUrl} → ${detectedBranch}@${detectedCommit}`
      );
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

    // 1. Try JSON object or array
    try {
      const parsed = JSON.parse(trimmed);
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      const mapped = arr
        .filter((x) => x && typeof x === 'object' && (x.name || x.provider || x.base_url || x.model || x.api_key || x.token))
        .map((x) => {
          const rawName = String(x.name || x.provider || '');
          const rawKey = String(x.api_key || x.token || '');
          const inferred = inferLlmProviderDefaults(
            rawName || 'LLM',
            rawKey,
            String(x.base_url || ''),
            String(x.model || ''),
            true
          );
          return {
            name: rawName || 'LLM',
            base_url: inferred.base_url,
            model: inferred.model,
            api_key: rawKey,
            timeout_seconds: Number(x.timeout_seconds || 2.5),
          };
        });
      if (mapped.length > 0) return mapped;
    } catch {
      // Fall through to .env or raw key parsing
    }

    // 2. Support .env lines (e.g. GROQ_API_KEY=gsk_..., GEMINI_API_KEY=AIza...) or raw API keys
    const results: LlmCascadeConfig[] = [];
    const lines = trimmed
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));

    for (const line of lines) {
      const envMatch = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*["']?([^"']+)["']?$/);
      if (envMatch) {
        const envKey = envMatch[1];
        const envVal = envMatch[2].trim();
        const providerHint = envKey.replace(/_?(API_KEY|TOKEN|KEY|URL)$/i, '') || 'LLM';
        const inferred = inferLlmProviderDefaults(providerHint, envVal, '', '', true);
        results.push({
          name: providerHint,
          base_url: inferred.base_url,
          model: inferred.model,
          api_key: envVal.startsWith('http') ? '' : envVal,
          timeout_seconds: 2.5,
        });
        continue;
      }

      if (/^(gsk_|AIza|sk-or-|sk-)[A-Za-z0-9_-]{8,}/.test(line)) {
        const inferred = inferLlmProviderDefaults('', line, '', '', true);
        const autoName = line.startsWith('gsk_')
          ? 'Groq'
          : line.startsWith('AIza')
            ? 'Gemini'
            : line.startsWith('sk-or-')
              ? 'OpenRouter'
              : 'OpenAI';
        results.push({
          name: autoName,
          base_url: inferred.base_url,
          model: inferred.model,
          api_key: line,
          timeout_seconds: 2.5,
        });
      }
    }

    return results;
  };

  const handleApplyLlmConfig = () => {
    const parsed = parseLlmConfigText(llmConfigRaw);
    if (parsed.length === 0) {
      setAiMsgError(true);
      setAiSavedMsg(
        locale === 'en'
          ? 'Could not parse JSON, .env line, or API key'
          : 'Укажите JSON, строку .env (GROQ_API_KEY=...) или API-ключ (gsk_..., AIza..., sk-...)'
      );
      return;
    }
    setLlmCascade((prev) => {
      const nonEmpty = prev.filter(
        (p) => p.name.trim() || p.base_url.trim() || p.model.trim() || (p.api_key || '').trim()
      );
      return [...nonEmpty, ...parsed];
    });
    setLlmConfigRaw('');
    setShowLlmPasteBox(false);
    setAiMsgError(false);
    setAiSavedMsg(
      locale === 'en' ? `Added to cascade: ${parsed.length}` : `Добавлено в каскад: ${parsed.length}`
    );
  };

  const handleMoveCascadeRow = (index: number, direction: -1 | 1) => {
    setLlmCascade((prev) => {
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= prev.length) return prev;
      const copy = [...prev];
      const [moved] = copy.splice(index, 1);
      copy.splice(targetIndex, 0, moved);
      return copy;
    });
  };

  // Step 4 Action: Save AI Cluster Cascade
  const handleSaveAiCluster = async () => {
    setSavingAi(true);
    setAiSavedMsg('');
    setAiMsgError(false);
    try {
      const extraFromPaste = parseLlmConfigText(llmConfigRaw);
      const combined = [...llmCascade, ...extraFromPaste]
        .filter(
          (p) => p.name.trim() || p.base_url.trim() || p.model.trim() || (p.api_key || '').trim()
        )
        .map((p, idx) => {
          const fallbackName = p.name.trim() || `LLM-${idx + 1}`;
          const inferred = inferLlmProviderDefaults(
            fallbackName,
            p.api_key || '',
            p.base_url || '',
            p.model || '',
            true
          );
          return {
            name: fallbackName,
            base_url: inferred.base_url,
            model: inferred.model,
            api_key: (p.api_key || '').trim(),
            timeout_seconds: Number(p.timeout_seconds) > 0 ? Number(p.timeout_seconds) : 2.5,
          };
        });

      if (combined.length > 0) {
        setLlmCascade(combined);
      }
      setLlmConfigRaw('');

      await api.configureBootstrapLayers({
        llm_cascade: combined,
        auto_commit_on_diff: true,
        websocket_enabled: true,
      });
      await refreshBootstrapStatus();
      setWizardStep(5);
    } catch (err: unknown) {
      setAiMsgError(true);
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
          'Initializing Owner Bootstrap Engine',
        ]
      : [
          'Подключение PostgreSQL 16 и Redis 7',
          `Индексация топологии (${preload.devicesCount} узлов)`,
          'Прогрев телеметрии и HierConfig AST',
          'Запуск мастера настройки Владельца',
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
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-2 sm:p-4 bg-[var(--bg-main)]/95 backdrop-blur-xl transition-colors duration-300 overflow-y-auto">
      {/* Global Top-Right Controls during Boot Splash */}
      {phase === 'welcome' && (
        <div className="absolute top-4 right-4 z-20 flex items-center gap-2">
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
          className="relative z-10 w-full max-w-md flex flex-col items-center justify-center text-center cursor-pointer animate-win-fade select-none px-3"
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
        <div className="relative z-10 w-full max-w-xl max-h-[94dvh] rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] shadow-2xl text-[var(--text-primary)] animate-win-fade flex flex-col overflow-hidden">
          {/* Header with Integrated Theme & Language Switchers */}
          <div className="px-3.5 sm:px-5 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)]/60 shrink-0">
            <div className="flex items-center justify-between gap-2 mb-2.5">
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

            <div className="grid grid-cols-5 gap-1 sm:gap-1.5">
              {stepsMeta.map((s) => {
                const active = wizardStep === s.id;
                const completed = wizardStep > s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setWizardStep(s.id)}
                    className={`px-1.5 sm:px-2 py-1.5 sm:py-2 rounded-lg border text-[10px] sm:text-[11px] font-medium transition-all cursor-pointer flex items-center justify-center gap-1 ${
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
          <div className="p-3.5 sm:p-5 space-y-4 overflow-y-auto flex-1">
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
                            {serverHost && serverHost !== 'localhost' && serverHost !== '127.0.0.1'
                              ? `${serverHost}:5173 (${locale === 'en' ? 'external' : 'открыт снаружи'})`
                              : locale === 'en'
                                ? '0.0.0.0:5173 (external access)'
                                : '0.0.0.0:5173 (открыт снаружи)'}
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
                      {showTransferOwnerBtn ? (
                        <button
                          type="button"
                          onClick={() => setRecoverMode(true)}
                          className="text-[11px] font-mono text-[var(--text-secondary)] hover:text-[var(--text-primary)] underline cursor-pointer"
                        >
                          {w.step1.transferAccessBtn}
                        </button>
                      ) : (
                        <span />
                      )}

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
                  /* COMPACT RECOVERY — EQUAL-LEVEL CARDS */
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

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-stretch">
                      {/* Card 1: Telegram Code */}
                      <div className="flex flex-col justify-between rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-main)] p-3 space-y-2.5 h-full">
                        <div className="space-y-1.5">
                          <div className="text-xs font-medium text-[var(--text-primary)]">
                            {w.step1.recoverStep1Title}
                          </div>
                          <div className="flex items-center justify-between gap-1.5 min-h-[24px]">
                            {telegramLinked ? (
                              <>
                                <button
                                  type="button"
                                  onClick={handleRequestTelegramRecoveryCode}
                                  className="px-2 py-0.5 rounded border border-[var(--border-subtle)] hover:border-[var(--border-hover)] bg-[var(--bg-elevated)] text-[10px] font-mono text-[var(--text-primary)] cursor-pointer"
                                >
                                  {w.step1.requestCodeBtn}
                                </button>
                                <a
                                  href={telegramRecoverLink}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="px-2 py-0.5 rounded bg-emerald-500/15 text-[10px] font-mono text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1"
                                >
                                  <span>{w.step1.botLinkBtn}</span>
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              </>
                            ) : (
                              <button
                                type="button"
                                onClick={() => {
                                  setRecoverMode(false);
                                  setWizardStep(3);
                                }}
                                className="px-2 py-0.5 rounded border border-amber-500/30 bg-amber-500/10 text-[10px] font-mono text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 cursor-pointer"
                              >
                                {locale === 'en'
                                  ? 'Connect Telegram (Step 3) →'
                                  : 'Подключить Telegram (Шаг 3) →'}
                              </button>
                            )}
                          </div>
                        </div>
                        <input
                          type="text"
                          value={telegramCodeInput}
                          onChange={(e) => setTelegramCodeInput(e.target.value)}
                          placeholder={w.step1.codePlaceholder}
                          className={inputClass}
                        />
                      </div>

                      {/* Card 2: Recovery Key */}
                      <div className="flex flex-col justify-between rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-main)] p-3 space-y-2.5 h-full">
                        <div className="space-y-1.5">
                          <div className="text-xs font-medium text-[var(--text-primary)]">
                            {w.step1.recoverStep2Title}
                          </div>
                          <div className="flex items-center justify-between gap-1.5 min-h-[24px]">
                            <span className="text-[10px] font-mono text-[var(--text-muted)] truncate">
                              {locale === 'en'
                                ? 'Key crk_owner_... from Step 1'
                                : 'Ключ crk_owner_... из Шага 1'}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                navigator.clipboard
                                  ?.readText()
                                  .then((txt) => {
                                    if (txt) setRecoveryKeyInput(txt.trim());
                                  })
                                  .catch(() => {});
                              }}
                              className="px-2 py-0.5 rounded border border-[var(--border-subtle)] hover:border-[var(--border-hover)] bg-[var(--bg-elevated)] text-[10px] font-mono text-[var(--text-primary)] cursor-pointer shrink-0"
                            >
                              {locale === 'en' ? 'Paste' : 'Вставить'}
                            </button>
                          </div>
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

            {/* ==================== STEP 2: GITHUB (PRIVATE/PUBLIC + PAT + BRANCH) ==================== */}
            {wizardStep === 2 && (
              <div className="space-y-3.5 animate-fade-in">
                <div>
                  <label className="block text-[11px] font-mono text-[var(--text-secondary)] mb-1">
                    {w.step2.repoLabel}
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={githubRepoUrl}
                      onChange={(e) => setGithubRepoUrl(e.target.value)}
                      placeholder="https://github.com/org/private-netops-sot.git"
                      className={inputClass}
                    />
                    <button
                      type="button"
                      onClick={() => void handleConnectGithubSsh(false)}
                      disabled={savingGithub}
                      className="px-3 py-1.5 rounded-md bg-emerald-500 hover:bg-emerald-400 text-zinc-950 text-xs font-semibold shrink-0 cursor-pointer transition-colors"
                    >
                      {savingGithub ? '...' : locale === 'en' ? 'Sync' : 'Синхр.'}
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[11px] font-mono text-[var(--text-secondary)] mb-1">
                      {w.step2.githubTokenLabel}
                    </label>
                    <input
                      type="password"
                      value={githubPat}
                      onChange={(e) => setGithubPat(e.target.value)}
                      placeholder="ghp_... / github_pat_..."
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-mono text-[var(--text-secondary)] mb-1">
                      {w.step2.branchLabel}
                    </label>
                    <input
                      type="text"
                      value={githubBranch}
                      onChange={(e) => setGithubBranch(e.target.value)}
                      placeholder="main"
                      className={inputClass}
                    />
                  </div>
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
                        {telegramChatId ? ` (${telegramChatId})` : ''}
                      </span>
                    </div>
                    <span className="px-2 py-0.5 rounded bg-emerald-500 text-zinc-950 text-[10px] font-mono font-bold">
                      OWNER
                    </span>
                  </div>
                ) : (
                  <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-main)] p-2.5 text-xs font-mono text-[var(--text-secondary)] flex items-center justify-between gap-2">
                    <span>
                      {telegramBotConfigured && telegramBotUsername
                        ? `${telegramBotUsername} · /start`
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

            {/* ==================== STEP 4: AI CLUSTER CASCADE ==================== */}
            {wizardStep === 4 && (
              <div className="space-y-3 animate-fade-in">
                <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-main)]/60 p-3 space-y-2.5">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-mono font-semibold text-[var(--text-primary)]">
                        {locale === 'en' ? 'LLM Cascade' : 'Каскад LLM'} ({llmCascade.length})
                      </span>
                      <span className="text-[10px] font-mono text-[var(--text-muted)]">
                        {llmCascade.length > 0
                          ? `${llmCascade.map((_, i) => `#${i + 1}`).join(' → ')} → Rule-Engine`
                          : 'Rule-Engine'}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setShowLlmPasteBox((v) => !v)}
                        className="px-2 py-0.5 rounded border border-[var(--border-subtle)] hover:border-[var(--border-hover)] bg-[var(--bg-card)] text-[10px] font-mono text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
                      >
                        {showLlmPasteBox
                          ? locale === 'en'
                            ? 'Hide'
                            : 'Скрыть'
                          : locale === 'en'
                            ? '+ Import'
                            : '+ Импорт'}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setLlmCascade((prev) => [
                            ...prev,
                            {
                              name: '',
                              base_url: '',
                              model: '',
                              api_key: '',
                              timeout_seconds: 2.5,
                            },
                          ])
                        }
                        className="px-2 py-0.5 rounded border border-emerald-500/40 bg-emerald-500/10 text-[10px] font-mono text-emerald-600 dark:text-emerald-400 cursor-pointer"
                      >
                        {locale === 'en' ? '+ Custom Provider' : '+ Свой провайдер'}
                      </button>
                    </div>
                  </div>

                  {/* Quick 1-click preset pills */}
                  <div className="flex items-center gap-1 flex-wrap">
                    {LLM_PRESETS.map((preset) => (
                      <button
                        key={preset.name}
                        type="button"
                        onClick={() =>
                          setLlmCascade((prev) => {
                            const hasEmptyFirst =
                              prev.length === 1 &&
                              !prev[0].name.trim() &&
                              !prev[0].base_url.trim() &&
                              !prev[0].model.trim() &&
                              !(prev[0].api_key || '').trim();
                            const row: LlmCascadeConfig = {
                              name: preset.name,
                              base_url: preset.base_url,
                              model: preset.model,
                              api_key: '',
                              timeout_seconds: preset.timeout_seconds,
                            };
                            return hasEmptyFirst ? [row] : [...prev, row];
                          })
                        }
                        className="px-2 py-0.5 rounded border border-[var(--border-subtle)] hover:border-emerald-500/40 bg-[var(--bg-card)] hover:bg-emerald-500/10 text-[10px] font-mono text-[var(--text-secondary)] hover:text-emerald-600 dark:hover:text-emerald-400 cursor-pointer transition-colors"
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>

                  {showLlmPasteBox && (
                    <div className="space-y-1.5">
                      <textarea
                        rows={3}
                        value={llmConfigRaw}
                        onChange={(e) => setLlmConfigRaw(e.target.value)}
                        placeholder={
                          'GROQ_API_KEY=gsk_...\nGEMINI_API_KEY=AIza...\n{"name":"Groq","api_key":"gsk_..."}'
                        }
                        className={`${inputClass} leading-relaxed resize-y`}
                      />
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={handleApplyLlmConfig}
                          className="px-2.5 py-1 rounded bg-emerald-500 hover:bg-emerald-400 text-zinc-950 text-[11px] font-mono font-semibold cursor-pointer shrink-0"
                        >
                          {locale === 'en' ? 'Add' : 'Добавить'}
                        </button>
                      </div>
                    </div>
                  )}

                  {llmCascade.length > 0 && (
                    <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                      {llmCascade.map((item, idx) => (
                        <div
                          key={idx}
                          className="rounded border border-[var(--border-subtle)] bg-[var(--bg-card)] p-1.5 flex items-center gap-1.5"
                        >
                          <div className="flex flex-col items-center gap-0.5 shrink-0">
                            <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-[10px] font-mono font-bold">
                              #{idx + 1}
                            </span>
                            <div className="flex items-center gap-0.5">
                              <button
                                type="button"
                                onClick={() => handleMoveCascadeRow(idx, -1)}
                                disabled={idx === 0}
                                className="px-1 text-[10px] font-mono text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-30 cursor-pointer"
                                title={locale === 'en' ? 'Move up' : 'Выше в каскаде'}
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                onClick={() => handleMoveCascadeRow(idx, 1)}
                                disabled={idx === llmCascade.length - 1}
                                className="px-1 text-[10px] font-mono text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-30 cursor-pointer"
                                title={locale === 'en' ? 'Move down' : 'Ниже в каскаде'}
                              >
                                ↓
                              </button>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 flex-1">
                            <input
                              type="text"
                              value={item.name}
                              onChange={(e) => {
                                const newName = e.target.value;
                                setLlmCascade((prev) =>
                                  prev.map((p, i) => {
                                    if (i !== idx) return p;
                                    const inferred = inferLlmProviderDefaults(
                                      newName,
                                      p.api_key || '',
                                      p.base_url || '',
                                      p.model || '',
                                      false
                                    );
                                    return {
                                      ...p,
                                      name: newName,
                                      base_url: inferred.base_url,
                                      model: inferred.model,
                                    };
                                  })
                                );
                              }}
                              onBlur={() => {
                                setLlmCascade((prev) =>
                                  prev.map((p, i) => {
                                    if (i !== idx) return p;
                                    if (!p.name.trim() && !(p.api_key || '').trim()) return p;
                                    const inferred = inferLlmProviderDefaults(
                                      p.name,
                                      p.api_key || '',
                                      p.base_url || '',
                                      p.model || '',
                                      true
                                    );
                                    return {
                                      ...p,
                                      base_url: inferred.base_url,
                                      model: inferred.model,
                                    };
                                  })
                                );
                              }}
                              placeholder={locale === 'en' ? 'Name (e.g. Groq)' : 'Имя (напр. Groq)'}
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
                              placeholder={locale === 'en' ? 'Model (auto)' : 'Модель (авто)'}
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
                              placeholder="Base URL (auto)"
                              className={inputClass}
                            />
                            <input
                              type="password"
                              value={item.api_key || ''}
                              onChange={(e) => {
                                const newKey = e.target.value;
                                setLlmCascade((prev) =>
                                  prev.map((p, i) => {
                                    if (i !== idx) return p;
                                    const inferred = inferLlmProviderDefaults(
                                      p.name,
                                      newKey,
                                      p.base_url || '',
                                      p.model || '',
                                      false
                                    );
                                    const autoName =
                                      p.name.trim() ||
                                      (newKey.startsWith('gsk_')
                                        ? 'Groq'
                                        : newKey.startsWith('AIza')
                                          ? 'Gemini'
                                          : newKey.startsWith('sk-or-')
                                            ? 'OpenRouter'
                                            : newKey.startsWith('sk-')
                                              ? 'OpenAI'
                                              : '');
                                    return {
                                      ...p,
                                      name: autoName,
                                      api_key: newKey,
                                      base_url: inferred.base_url,
                                      model: inferred.model,
                                    };
                                  })
                                );
                              }}
                              placeholder="API Key"
                              className={inputClass}
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              setLlmCascade((prev) => prev.filter((_, i) => i !== idx))
                            }
                            className="px-1.5 py-1 text-xs font-mono text-rose-500 hover:text-rose-400 cursor-pointer shrink-0"
                            title={locale === 'en' ? 'Remove' : 'Удалить'}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {aiSavedMsg && (
                  <div
                    className={`text-xs font-mono rounded px-3 py-1.5 border ${
                      aiMsgError
                        ? 'text-rose-600 dark:text-rose-400 bg-rose-500/10 border-rose-500/20'
                        : 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
                    }`}
                  >
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
                    placeholder="10.0.0.10"
                    className={inputClass}
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-mono text-[var(--text-secondary)] mb-1">
                    {locale === 'en' ? 'Password' : 'Пароль'}
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
                        {locale === 'en'
                          ? 'No active Containerlab nodes found.'
                          : 'Активных узлов Containerlab не обнаружено.'}
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
