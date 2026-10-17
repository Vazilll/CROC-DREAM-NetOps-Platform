import React, { useState, useEffect, useCallback } from 'react';
import {
  Key,
  Server,
  ArrowRight,
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

type WizardStep = 1 | 2 | 3 | 4 | 5;

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
];

function inferProviderDefaults(name: string, apiKey: string): { name: string; base_url: string; model: string } {
  const n = name.trim().toLowerCase();
  const k = apiKey.trim();
  if (n.includes('groq') || k.startsWith('gsk_')) {
    return { name: name || 'Groq', base_url: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' };
  }
  if (n.includes('gemini') || k.startsWith('AIza')) {
    return { name: name || 'Gemini', base_url: 'https://generativelanguage.googleapis.com/v1beta/openai/', model: 'gemini-2.0-flash' };
  }
  if (n.includes('openrouter') || k.startsWith('sk-or-')) {
    return { name: name || 'OpenRouter', base_url: 'https://openrouter.ai/api/v1', model: 'deepseek/deepseek-chat' };
  }
  if (n.includes('deepseek')) {
    return { name: name || 'DeepSeek', base_url: 'https://api.deepseek.com/v1', model: 'deepseek-chat' };
  }
  if (n.includes('ollama') || n.includes('local')) {
    return { name: name || 'Ollama', base_url: 'http://localhost:11434/v1', model: 'qwen2.5-coder:7b' };
  }
  return { name: name || 'OpenAI', base_url: 'https://api.openai.com/v1', model: 'gpt-4o-mini' };
}

const inputClass =
  'w-full bg-[var(--bg-main)] border border-[var(--border-subtle)] focus:border-[var(--border-hover)] rounded-md px-3 py-1.5 text-xs font-mono text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none transition-colors';

const primaryBtnClass =
  'px-4 py-2 rounded-md bg-[var(--text-primary)] hover:opacity-90 text-[var(--bg-main)] text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-opacity disabled:opacity-50';

const secondaryBtnClass =
  'px-3 py-1.5 rounded-md border border-[var(--border-subtle)] hover:border-[var(--border-hover)] bg-[var(--bg-elevated)] text-xs font-mono text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer transition-colors';

const utilityPillClass =
  'h-7 flex items-center gap-1.5 px-2.5 rounded-md border border-[var(--border-subtle)] hover:border-[var(--border-hover)] bg-[var(--bg-card)] hover:bg-[var(--bg-elevated)] text-[11px] font-mono text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer';

export const WelcomeModal: React.FC<WelcomeModalProps> = ({
  isOpen,
  onClose,
  locale,
  setLocale,
  theme,
  setTheme,
}) => {
  const [wizardStep, setWizardStep] = useState<WizardStep>(1);
  const [clusterName, setClusterName] = useState('');
  const [exposureMode, setExposureMode] = useState<'local_only' | 'public_tunnel'>('local_only');
  const [ownerToken, setOwnerToken] = useState('');
  const [copiedKey, setCopiedKey] = useState(false);
  const [recoverMode, setRecoverMode] = useState(false);
  const [recoveryKeyInput, setRecoveryKeyInput] = useState('');
  const [telegramCodeInput, setTelegramCodeInput] = useState('');
  const [recoveryStatusMsg, setRecoveryStatusMsg] = useState('');
  const [claimingOwner, setClaimingOwner] = useState(false);
  const [sendingTelegramCode, setSendingTelegramCode] = useState(false);
  const [canTransferOwnerFlag, setCanTransferOwnerFlag] = useState(false);

  const [githubRepoUrl, setGithubRepoUrl] = useState('');
  const [githubBranch, setGithubBranch] = useState('');
  const [githubPat, setGithubPat] = useState('');
  const [savingGithub, setSavingGithub] = useState(false);
  const [githubSavedMsg, setGithubSavedMsg] = useState('');

  const [telegramBotToken, setTelegramBotToken] = useState('');
  const [telegramChatId, setTelegramChatId] = useState('');
  const [telegramBotUsername, setTelegramBotUsername] = useState('');
  const [telegramClaimLink, setTelegramClaimLink] = useState('');
  const [telegramRecoverLink, setTelegramRecoverLink] = useState('');
  const [telegramLinked, setTelegramLinked] = useState(false);
  const [telegramLinkedUser, setTelegramLinkedUser] = useState('');
  const [savingTelegram, setSavingTelegram] = useState(false);
  const [telegramSavedMsg, setTelegramSavedMsg] = useState('');

  const [llmCascade, setLlmCascade] = useState<LlmCascadeConfig[]>([
    { name: '', base_url: '', model: '', api_key: '', timeout_seconds: 2.5 },
  ]);
  const [savingAi, setSavingAi] = useState(false);
  const [aiSavedMsg, setAiSavedMsg] = useState('');

  const [serverHost, setServerHost] = useState('');
  const [serverPort, setServerPort] = useState(221);
  const [serverUser, setServerUser] = useState('');
  const [serverPassword, setServerPassword] = useState('');
  const [discoveringServer, setDiscoveringServer] = useState(false);
  const [discoveryResult, setDiscoveryResult] = useState<ServerDiscoveryResponse | null>(null);

  const t = translations[locale];
  const isEn = locale === 'en';

  const refreshBootstrapStatus = useCallback(async () => {
    try {
      const st = await api.getBootstrapStatus();
      setCanTransferOwnerFlag(Boolean(st.can_transfer_owner || st.initialized));
      if (st.cluster_name) setClusterName(st.cluster_name);
      if (st.exposure?.mode === 'public_tunnel' || st.exposure?.mode === 'local_only') {
        setExposureMode(st.exposure.mode);
      }
      if (st.github?.repo_connected) {
        setGithubRepoUrl(st.github.github_repo_url || '');
        setGithubBranch(st.github.branch || '');
      } else {
        setGithubRepoUrl('');
        setGithubBranch('');
      }
      setTelegramBotUsername(st.telegram?.bot_username || '');
      setTelegramClaimLink(st.telegram?.deep_link_claim || '');
      setTelegramRecoverLink(st.telegram?.deep_link_recover || '');
      setTelegramLinked(Boolean(st.owner?.telegram_linked));
      setTelegramLinkedUser(st.owner?.telegram_username || '');
      setTelegramChatId(st.owner?.telegram_chat_id || '');
      setOwnerToken(st.owner?.recovery_key || '');
      setServerHost(st.server?.clab_host || '');
      if (st.server?.clab_port) setServerPort(st.server.clab_port);
      if (st.server?.clab_user) setServerUser(st.server.clab_user);
      if (Array.isArray(st.ai?.cascade) && st.ai.cascade.length > 0) {
        setLlmCascade(st.ai.cascade);
      } else {
        setLlmCascade([{ name: '', base_url: '', model: '', api_key: '', timeout_seconds: 2.5 }]);
      }
      if (st.initialized && st.caller_is_bound_owner === false) {
        setRecoverMode(true);
      } else if (!st.initialized) {
        setRecoverMode(false);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const t0 = setTimeout(() => void refreshBootstrapStatus(), 0);
    return () => clearTimeout(t0);
  }, [isOpen, refreshBootstrapStatus]);

  useEffect(() => {
    if (!isOpen || wizardStep !== 3) return;
    const timer = setInterval(() => {
      void refreshBootstrapStatus();
    }, 2000);
    return () => clearInterval(timer);
  }, [isOpen, wizardStep, refreshBootstrapStatus]);

  if (!isOpen) return null;

  const handleClaimOwner = async () => {
    setClaimingOwner(true);
    setRecoveryStatusMsg('');
    try {
      const res = await api.claimOwnerBootstrap({
        cluster_name: clusterName.trim() || '',
        recovery_key: recoveryKeyInput.trim() || undefined,
      });
      await api.configureBootstrapLayers({
        cluster_name: clusterName.trim() || '',
        exposure_mode: exposureMode,
        websocket_enabled: true,
        auto_commit_on_diff: true,
      });
      localStorage.setItem(
        'netops_share_base_url',
        exposureMode === 'local_only'
          ? 'http://127.0.0.1:5173'
          : serverHost
            ? `http://${serverHost}:5173`
            : window.location.origin
      );
      setOwnerToken(res.token);
      localStorage.setItem('netops_user_role', 'owner');
      localStorage.setItem('netops_cluster_name', res.cluster_name);
      setRecoverMode(false);
      setWizardStep(2);
    } catch (err: unknown) {
      setRecoverMode(true);
      setRecoveryStatusMsg(getErrorMessage(err, 'Кластер уже привязан к другому ПК'));
    } finally {
      setClaimingOwner(false);
    }
  };

  const handleRequestTelegramRecoveryCode = async () => {
    setSendingTelegramCode(true);
    setRecoveryStatusMsg('');
    try {
      const res = await api.recoverOwnerAccess({ action: 'request_telegram_code' });
      setRecoveryStatusMsg(
        res.message ||
          (isEn
            ? '6-digit code sent to Owner in Telegram'
            : '6-значный код отправлен Владельцу в Telegram')
      );
    } catch (err: unknown) {
      setRecoveryStatusMsg(
        getErrorMessage(err, isEn ? 'Failed to send code via Telegram' : 'Не удалось отправить код в Telegram')
      );
    } finally {
      setSendingTelegramCode(false);
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
      if (res.token) setOwnerToken(res.token);
      localStorage.setItem('netops_user_role', 'owner');
      localStorage.setItem('netops_cluster_name', clusterName.trim() || '');
      localStorage.setItem('netops_onboarding_done', 'true');
      setRecoverMode(false);
      onClose('owner');
    } catch (err: unknown) {
      setRecoveryStatusMsg(getErrorMessage(err, 'Неверный ключ или код'));
    } finally {
      setClaimingOwner(false);
    }
  };

  const handleConnectGithub = async (advance: boolean) => {
    const targetUrl = githubRepoUrl.trim();
    if (!targetUrl) {
      if (advance) setWizardStep(3);
      return;
    }
    setSavingGithub(true);
    setGithubSavedMsg('');
    try {
      const res = await api.configureBootstrapLayers({
        cluster_name: clusterName.trim(),
        exposure_mode: exposureMode,
        github_repo_url: targetUrl,
        github_branch: githubBranch.trim() || 'main',
        github_pat: githubPat.trim() || undefined,
        auto_commit_on_diff: true,
      });
      const br = res.git?.branch || githubBranch.trim() || 'main';
      setGithubBranch(br);
      setGithubSavedMsg(`Подключён: ${targetUrl} (${br})`);
      if (advance) setWizardStep(3);
    } catch (err: unknown) {
      setGithubSavedMsg(getErrorMessage(err, 'Ошибка сохранения GitHub'));
    } finally {
      setSavingGithub(false);
    }
  };

  const handleSaveTelegram = async (advance: boolean) => {
    setSavingTelegram(true);
    setTelegramSavedMsg('');
    try {
      if (telegramBotToken.trim()) {
        const res = await api.configureBootstrapLayers({
          telegram_bot_token: telegramBotToken.trim(),
        });
        if (res.bot_username) setTelegramBotUsername(res.bot_username);
        setTelegramSavedMsg('Токен бота сохранён');
      }
      await refreshBootstrapStatus();
      if (advance) setWizardStep(4);
    } catch (err: unknown) {
      setTelegramSavedMsg(getErrorMessage(err, 'Ошибка сохранения Telegram'));
    } finally {
      setSavingTelegram(false);
    }
  };

  const handleSaveAiCluster = async () => {
    setSavingAi(true);
    setAiSavedMsg('');
    try {
      const cleaned = llmCascade
        .filter((p) => p.name.trim() || p.base_url.trim() || (p.api_key || '').trim())
        .map((p) => {
          const def = inferProviderDefaults(p.name, p.api_key || '');
          return {
            name: p.name.trim() || def.name,
            base_url: p.base_url.trim() || def.base_url,
            model: p.model.trim() || def.model,
            api_key: (p.api_key || '').trim(),
            timeout_seconds: Number(p.timeout_seconds) || 2.5,
          };
        });
      await api.configureBootstrapLayers({ llm_cascade: cleaned });
      await refreshBootstrapStatus();
      setWizardStep(5);
    } catch (err: unknown) {
      setAiSavedMsg(getErrorMessage(err, 'Ошибка сохранения ИИ'));
    } finally {
      setSavingAi(false);
    }
  };

  const handleDiscoverServer = async () => {
    if (!serverHost.trim()) {
      setDiscoveryResult({ status: 'error', message: 'Введите IP или хост сервера' });
      return;
    }
    setDiscoveringServer(true);
    try {
      const res = await api.discoverAndAttachServer({
        mode: 'ssh',
        host: serverHost.trim(),
        port: Number(serverPort) || 221,
        username: serverUser.trim(),
        password: serverPassword || undefined,
      });
      setDiscoveryResult(res);
    } catch (err: unknown) {
      setDiscoveryResult({ status: 'error', message: getErrorMessage(err, 'Сервер недоступен') });
    } finally {
      setDiscoveringServer(false);
    }
  };

  const handleDiscoverOffline = async () => {
    setDiscoveringServer(true);
    try {
      const res = await api.discoverAndAttachServer({ mode: 'offline' });
      setDiscoveryResult(res);
    } catch (err: unknown) {
      setDiscoveryResult({ status: 'error', message: getErrorMessage(err, 'Ошибка подключения офлайн-стенда') });
    } finally {
      setDiscoveringServer(false);
    }
  };

  const handleFinishWizard = async () => {
    try {
      if (!ownerToken && !localStorage.getItem('netops_auth_token')) {
        const res = await api.claimOwnerBootstrap({
          cluster_name: clusterName.trim() || '',
        });
        setOwnerToken(res.token);
      }
      await api.configureBootstrapLayers({
        cluster_name: clusterName.trim() || '',
        bootstrap_completed: true,
      });
      if (!discoveryResult?.synced_total) {
        await api.syncInventory().catch(() => {});
      }
    } catch {
      // ignore
    }
    localStorage.setItem('netops_user_role', 'owner');
    localStorage.setItem('netops_cluster_name', clusterName.trim() || '');
    localStorage.setItem('netops_onboarding_done', 'true');
    onClose('owner');
  };

  const stepsMeta: { id: WizardStep; title: string; icon: React.ReactNode }[] = [
    { id: 1, title: isEn ? '1. Owner' : '1. Владелец', icon: <Key className="w-3.5 h-3.5 shrink-0" /> },
    { id: 2, title: '2. GitHub', icon: <GitBranch className="w-3.5 h-3.5 shrink-0" /> },
    { id: 3, title: '3. Telegram', icon: <Send className="w-3.5 h-3.5 shrink-0" /> },
    { id: 4, title: isEn ? '4. AI' : '4. ИИ', icon: <Cpu className="w-3.5 h-3.5 shrink-0" /> },
    { id: 5, title: isEn ? '5. Server' : '5. Сервер', icon: <Server className="w-3.5 h-3.5 shrink-0" /> },
  ];

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-2 sm:p-4 bg-[var(--bg-main)]/95 backdrop-blur-xl overflow-y-auto">
      <div className="relative z-10 w-full max-w-xl max-h-[94dvh] rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] shadow-2xl text-[var(--text-primary)] flex flex-col overflow-hidden">
        <div className="px-3.5 sm:px-5 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)]/60 shrink-0">
          <div className="flex items-center justify-between gap-2 mb-2.5">
            <span className="inline-flex items-center gap-2 text-xs font-mono font-semibold">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span>{isEn ? 'Cluster Setup' : 'Настройка кластера'}</span>
            </span>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                className={utilityPillClass}
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

              <button
                type="button"
                onClick={() => setLocale(locale === 'ru' ? 'en' : 'ru')}
                className={utilityPillClass}
              >
                <Globe className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                <span className="uppercase font-semibold">{locale === 'ru' ? 'RU' : 'EN'}</span>
              </button>

              <button
                type="button"
                onClick={handleFinishWizard}
                className="h-7 px-2.5 rounded-md text-[11px] font-mono text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
              >
                {isEn ? 'Skip →' : 'Пропустить →'}
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
                      ? 'border-[var(--text-primary)] bg-[var(--bg-card)] text-[var(--text-primary)]'
                      : completed
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500'
                        : 'border-[var(--border-subtle)] bg-[var(--bg-main)]/60 text-[var(--text-secondary)]'
                  }`}
                >
                  {completed ? <Check className="w-3.5 h-3.5 shrink-0" /> : s.icon}
                  <span className="truncate">{s.title}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="p-3.5 sm:p-5 space-y-4 overflow-y-auto flex-1">
          {ownerToken && (
            <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-2.5 space-y-1.5">
              <div className="text-xs font-semibold text-emerald-500 flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 shrink-0" />
                <span>{isEn ? 'Owner Recovery Key:' : 'Резервный ключ Владельца:'}</span>
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-[var(--bg-main)] border border-[var(--border-subtle)] rounded px-2.5 py-1 text-xs font-mono text-emerald-500 select-all truncate">
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
                  {copiedKey ? 'OK' : isEn ? 'Copy' : 'Копировать'}
                </button>
              </div>
            </div>
          )}

          {wizardStep === 1 && (
            <div className="space-y-3.5">
              {!recoverMode ? (
                <div className="space-y-3.5">
                  <div>
                    <label className="block text-[11px] font-mono text-[var(--text-secondary)] mb-1">
                      {isEn ? 'Cluster Name' : 'Имя кластера'}
                    </label>
                    <input
                      type="text"
                      value={clusterName}
                      onChange={(e) => setClusterName(e.target.value)}
                      className={inputClass}
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-mono text-[var(--text-secondary)] mb-1">
                      {isEn ? 'Network Exposure' : 'Сетевой контур'}
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setExposureMode('local_only')}
                        className={`p-2.5 rounded-lg border text-left cursor-pointer ${
                          exposureMode === 'local_only'
                            ? 'border-emerald-500/60 bg-emerald-500/10'
                            : 'border-[var(--border-subtle)] bg-[var(--bg-main)]'
                        }`}
                      >
                        <div className="text-xs font-semibold">🔒 {isEn ? 'Local Only' : 'Только локально'}</div>
                        <div className="text-[10px] font-mono text-[var(--text-muted)] mt-0.5">127.0.0.1:5173</div>
                      </button>

                      <button
                        type="button"
                        onClick={() => setExposureMode('public_tunnel')}
                        className={`p-2.5 rounded-lg border text-left cursor-pointer ${
                          exposureMode === 'public_tunnel'
                            ? 'border-sky-500/60 bg-sky-500/10'
                            : 'border-[var(--border-subtle)] bg-[var(--bg-main)]'
                        }`}
                      >
                        <div className="text-xs font-semibold">🌐 {isEn ? 'Public Access' : 'Внешний доступ'}</div>
                        <div className="text-[10px] font-mono text-[var(--text-muted)] mt-0.5">0.0.0.0:5173</div>
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    {canTransferOwnerFlag ? (
                      <button
                        type="button"
                        onClick={() => setRecoverMode(true)}
                        className="text-[11px] font-mono text-[var(--text-secondary)] hover:text-[var(--text-primary)] underline cursor-pointer"
                      >
                        {isEn ? 'Transfer Owner rights' : 'Перенести права со старого ПК'}
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
                      <span>{claimingOwner ? '...' : isEn ? 'Next' : 'Далее'}</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-amber-500 flex items-center gap-1.5">
                      <Smartphone className="w-4 h-4" />
                      <span>{isEn ? 'Transfer Owner Authority' : 'Перенос прав Владельца'}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setRecoverMode(false)}
                      className="text-xs font-mono text-[var(--text-secondary)] cursor-pointer"
                    >
                      ← {isEn ? 'Back' : 'Назад'}
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-main)] p-3 space-y-2">
                      <div className="flex items-center justify-between gap-1.5 text-xs font-medium">
                        <span>1. Telegram Code</span>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={handleRequestTelegramRecoveryCode}
                            disabled={sendingTelegramCode}
                            className="px-2 py-0.5 rounded bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-[10px] font-mono text-emerald-500 cursor-pointer disabled:opacity-50"
                          >
                            {sendingTelegramCode ? '...' : isEn ? 'Send Code' : 'Отправить код'}
                          </button>
                          {telegramRecoverLink && (
                          <a
                            href={telegramRecoverLink}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[10px] font-mono text-emerald-500 inline-flex items-center gap-1 hover:underline"
                          >
                            <span>Bot</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                          )}
                        </div>
                      </div>
                      <input
                        type="text"
                        value={telegramCodeInput}
                        onChange={(e) => setTelegramCodeInput(e.target.value)}
                        placeholder="6-digit code"
                        className={inputClass}
                      />
                    </div>

                    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-main)] p-3 space-y-2">
                      <div className="flex items-center justify-between gap-1.5 text-xs font-medium">
                        <span>2. Recovery Key</span>
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              const txt = await navigator.clipboard.readText();
                              if (txt) setRecoveryKeyInput(txt.trim());
                            } catch {
                              // ignore
                            }
                          }}
                          className="px-2 py-0.5 rounded border border-[var(--border-subtle)] hover:border-[var(--border-hover)] text-[10px] font-mono text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
                        >
                          {isEn ? 'Paste' : 'Вставить'}
                        </button>
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
                    <div className="text-xs font-mono text-amber-500 bg-amber-500/10 border border-amber-500/20 rounded px-2.5 py-1.5">
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
                      {isEn ? 'Bind This PC →' : 'Привязать этот ПК →'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {wizardStep === 2 && (
            <div className="space-y-3.5">
              <div>
                <label className="block text-[11px] font-mono text-[var(--text-secondary)] mb-1">
                  GitHub Repository (SoT)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={githubRepoUrl}
                    onChange={(e) => setGithubRepoUrl(e.target.value)}
                    placeholder="https://github.com/org/netops-sot.git"
                    className={inputClass}
                  />
                  <button
                    type="button"
                    onClick={() => void handleConnectGithub(false)}
                    disabled={savingGithub}
                    className="px-3 py-1.5 rounded-md bg-emerald-500 hover:bg-emerald-400 text-zinc-950 text-xs font-semibold shrink-0 cursor-pointer"
                  >
                    {savingGithub ? '...' : 'Sync'}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] font-mono text-[var(--text-secondary)] mb-1">
                    GitHub Token (optional)
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
                    {isEn ? 'Branch' : 'Ветка'}
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
                <div className="text-xs font-mono text-emerald-500 bg-emerald-500/10 border border-emerald-500/20 rounded px-3 py-1.5">
                  {githubSavedMsg}
                </div>
              )}

              <div className="flex items-center justify-between pt-1">
                <button type="button" onClick={() => setWizardStep(1)} className={secondaryBtnClass}>
                  ← {isEn ? 'Back' : 'Назад'}
                </button>
                <button
                  type="button"
                  onClick={() => void handleConnectGithub(true)}
                  disabled={savingGithub}
                  className={primaryBtnClass}
                >
                  <span>{isEn ? 'Next' : 'Далее'}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          {wizardStep === 3 && (
            <div className="space-y-3.5">
              <div>
                <label className="block text-[11px] font-mono text-[var(--text-secondary)] mb-1">
                  Telegram Bot Token (@BotFather)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="password"
                    value={telegramBotToken}
                    onChange={(e) => setTelegramBotToken(e.target.value)}
                    placeholder="8993240454:AAHnq-..."
                    className={inputClass}
                  />
                  <button
                    type="button"
                    onClick={() => void handleSaveTelegram(false)}
                    disabled={savingTelegram || !telegramBotToken.trim()}
                    className="px-3 py-1.5 rounded-md bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-zinc-950 text-xs font-semibold shrink-0 cursor-pointer"
                  >
                    {savingTelegram ? '...' : isEn ? 'Connect' : 'Подключить'}
                  </button>
                </div>
              </div>

              {telegramLinked ? (
                <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 flex items-center justify-between gap-2 text-xs font-mono text-emerald-500">
                  <span className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>
                      Owner: <strong>{telegramLinkedUser ? `@${telegramLinkedUser}` : 'owner'}</strong>
                      {telegramChatId ? ` (${telegramChatId})` : ''}
                    </span>
                  </span>
                  <span className="px-2 py-0.5 rounded bg-emerald-500 text-zinc-950 text-[10px] font-bold">OWNER</span>
                </div>
              ) : (
                <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-main)] p-2.5 flex items-center justify-between gap-2 text-xs font-mono text-[var(--text-secondary)]">
                  <span>{telegramBotUsername ? `${telegramBotUsername} · /start` : isEn ? 'Add a bot token to get the bot link' : 'Укажите токен бота — появится ссылка'}</span>
                  {telegramClaimLink && (
                  <a
                    href={telegramClaimLink}
                    target="_blank"
                    rel="noreferrer"
                    className="px-2.5 py-1 rounded bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-[11px] font-mono text-emerald-500 inline-flex items-center gap-1 shrink-0"
                  >
                    <span>{isEn ? 'Open Bot (/start)' : 'Открыть бота (/start)'}</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                  )}
                </div>
              )}

              {telegramSavedMsg && (
                <div className="text-xs font-mono text-emerald-500 bg-emerald-500/10 border border-emerald-500/20 rounded px-3 py-1.5">
                  {telegramSavedMsg}
                </div>
              )}

              <div className="flex items-center justify-between pt-1">
                <button type="button" onClick={() => setWizardStep(2)} className={secondaryBtnClass}>
                  ← {isEn ? 'Back' : 'Назад'}
                </button>
                <button
                  type="button"
                  onClick={() => void handleSaveTelegram(true)}
                  disabled={savingTelegram}
                  className={primaryBtnClass}
                >
                  <span>{isEn ? 'Next' : 'Далее'}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          {wizardStep === 4 && (
            <div className="space-y-3">
              <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-main)]/60 p-3 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-mono font-semibold">
                    LLM Cascade ({llmCascade.length})
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setLlmCascade((prev) => [
                        ...prev,
                        { name: '', base_url: '', model: '', api_key: '', timeout_seconds: 2.5 },
                      ])
                    }
                    className="px-2 py-0.5 rounded border border-emerald-500/40 bg-emerald-500/10 text-[10px] font-mono text-emerald-500 cursor-pointer"
                  >
                    + Provider
                  </button>
                </div>

                <div className="flex items-center gap-1 flex-wrap">
                  {LLM_PRESETS.map((preset) => (
                    <button
                      key={preset.name}
                      type="button"
                      onClick={() =>
                        setLlmCascade((prev) => {
                          const row: LlmCascadeConfig = { ...preset, api_key: '' };
                          const isEmptyFirst =
                            prev.length === 1 && !prev[0].name.trim() && !(prev[0].api_key || '').trim();
                          return isEmptyFirst ? [row] : [...prev, row];
                        })
                      }
                      className="px-2 py-0.5 rounded border border-[var(--border-subtle)] bg-[var(--bg-card)] text-[10px] font-mono text-[var(--text-secondary)] hover:text-emerald-500 cursor-pointer"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>

                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {llmCascade.map((item, idx) => (
                    <div
                      key={idx}
                      className="rounded border border-[var(--border-subtle)] bg-[var(--bg-card)] p-1.5 flex items-center gap-1.5"
                    >
                      <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-500 text-[10px] font-mono font-bold">
                        #{idx + 1}
                      </span>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 flex-1">
                        <input
                          type="text"
                          value={item.name}
                          onChange={(e) =>
                            setLlmCascade((prev) =>
                              prev.map((p, i) => (i === idx ? { ...p, name: e.target.value } : p))
                            )
                          }
                          placeholder="Name"
                          className={inputClass}
                        />
                        <input
                          type="text"
                          value={item.model}
                          onChange={(e) =>
                            setLlmCascade((prev) =>
                              prev.map((p, i) => (i === idx ? { ...p, model: e.target.value } : p))
                            )
                          }
                          placeholder="Model"
                          className={inputClass}
                        />
                        <input
                          type="text"
                          value={item.base_url}
                          onChange={(e) =>
                            setLlmCascade((prev) =>
                              prev.map((p, i) => (i === idx ? { ...p, base_url: e.target.value } : p))
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
                              prev.map((p, i) => (i === idx ? { ...p, api_key: e.target.value } : p))
                            )
                          }
                          placeholder="API Key"
                          className={inputClass}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => setLlmCascade((prev) => prev.filter((_, i) => i !== idx))}
                        className="px-1.5 py-1 text-xs font-mono text-rose-500 cursor-pointer"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {aiSavedMsg && (
                <div className="text-xs font-mono text-rose-500 bg-rose-500/10 border border-rose-500/20 rounded px-3 py-1.5">
                  {aiSavedMsg}
                </div>
              )}

              <div className="flex items-center justify-between pt-1">
                <button type="button" onClick={() => setWizardStep(3)} className={secondaryBtnClass}>
                  ← {isEn ? 'Back' : 'Назад'}
                </button>
                <button
                  type="button"
                  onClick={handleSaveAiCluster}
                  disabled={savingAi}
                  className={primaryBtnClass}
                >
                  <span>{isEn ? 'Next' : 'Далее'}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          {wizardStep === 5 && (
            <div className="space-y-3.5">
              <div className="grid grid-cols-3 gap-2.5">
                <div className="col-span-2">
                  <label className="block text-[11px] font-mono text-[var(--text-secondary)] mb-1">
                    {isEn ? 'Host' : 'Хост'}
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
                    {isEn ? 'SSH Port' : 'SSH Порт'}
                  </label>
                  <input
                    type="number"
                    value={serverPort}
                    onChange={(e) => setServerPort(Number(e.target.value) || 221)}
                    placeholder="221"
                    className={inputClass}
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-mono text-[var(--text-secondary)] mb-1">
                  {isEn ? 'SSH User' : 'Пользователь SSH'}
                </label>
                <input
                  type="text"
                  value={serverUser}
                  onChange={(e) => setServerUser(e.target.value)}
                  className={inputClass}
                />
              </div>

              <div>
                <label className="block text-[11px] font-mono text-[var(--text-secondary)] mb-1">
                  {isEn ? 'SSH Password' : 'Пароль SSH'}
                </label>
                <div className="flex flex-wrap sm:flex-nowrap gap-2">
                  <input
                    type="password"
                    value={serverPassword}
                    onChange={(e) => setServerPassword(e.target.value)}
                    placeholder="SSH password"
                    className={inputClass}
                  />
                  <button
                    type="button"
                    onClick={handleDiscoverServer}
                    disabled={discoveringServer}
                    className="px-3.5 py-1.5 rounded-md bg-emerald-500 hover:bg-emerald-400 text-zinc-950 text-xs font-semibold flex items-center gap-1.5 cursor-pointer shrink-0"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${discoveringServer ? 'animate-spin' : ''}`} />
                    <span>{discoveringServer ? '...' : isEn ? 'Connect SSH' : 'Подключить'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleDiscoverOffline}
                    disabled={discoveringServer}
                    className={secondaryBtnClass}
                  >
                    <span>{isEn ? 'Offline (Git SoT)' : 'Офлайн-стенд (Git SoT)'}</span>
                  </button>
                </div>
              </div>

              {discoveryResult?.discovered_switches && (
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2.5 space-y-2">
                  <div className="text-xs font-semibold text-emerald-500 flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>
                      {isEn ? 'Nodes:' : 'Узлов:'} {discoveryResult.synced_total}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {discoveryResult.discovered_switches.map((sw: DiscoveredSwitchItem) => (
                      <div
                        key={sw.hostname}
                        className="rounded border border-[var(--border-subtle)] bg-[var(--bg-main)] px-2.5 py-1.5 flex items-center justify-between text-[11px] font-mono"
                      >
                        <span className="truncate font-semibold">{sw.hostname}</span>
                        <span className={sw.reachable ? 'text-emerald-500' : 'text-rose-500'}>
                          {sw.reachable ? 'SSH OK' : 'OFFLINE'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {discoveryResult?.status === 'error' && discoveryResult.message && (
                <div className="text-xs font-mono text-rose-500 bg-rose-500/10 border border-rose-500/20 rounded px-3 py-1.5">
                  {discoveryResult.message}
                </div>
              )}

              <div className="flex items-center justify-between pt-1">
                <button type="button" onClick={() => setWizardStep(4)} className={secondaryBtnClass}>
                  ← {isEn ? 'Back' : 'Назад'}
                </button>
                <button type="button" onClick={handleFinishWizard} className={primaryBtnClass}>
                  <span>{isEn ? 'Launch Console' : 'Открыть пульт'}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
