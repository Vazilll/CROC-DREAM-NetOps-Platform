import React, { useState, useEffect, useCallback } from 'react';
import {
  Copy,
  Check,
  Users,
  Shield,
  Plus,
  RefreshCw,
  Unlock,
  Trash2,
  GitBranch,
  Database,
  Send,
  Smartphone,
  KeyRound,
  CheckCircle2,
  AlertCircle,
  Ban,
  Server,
  Globe,
  Clock,
} from 'lucide-react';
import { api, getErrorMessage } from '../../api';
import type {
  UserRole,
  UserAccount,
  UserInviteCreated,
  IntegrationsStatus,
} from '../../api';
import type { Locale } from '../../i18n';
import { Modal } from '../layout/ui';

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  userRole: UserRole;
  locale?: Locale;
}

const MINTED_STORAGE_KEY = 'netops_minted_tokens_v1';

const BASE_SYSTEM_TARGETS = [
  { value: '', label: 'Вся фабрика CLOS (все системы и узлы)' },
  { value: 'telemetry:prometheus', label: 'Telemetry (Prometheus / Grafana)' },
  { value: 'sot:netbox', label: 'Source of Truth (NetBox / GitOps)' },
];

const TTL_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: 'Навсегда (бессрочный)' },
  { value: 15, label: '15 минут (временный)' },
  { value: 60, label: '1 час (временный)' },
  { value: 480, label: '8 часов (смена)' },
  { value: 1440, label: '24 часа (сутки)' },
  { value: 10080, label: '7 дней (неделя)' },
];

function formatTokenExpiry(expiresAt: string | null | undefined): {
  label: string;
  expired: boolean;
  forever: boolean;
} {
  if (!expiresAt) {
    return { label: 'НАВСЕГДА', expired: false, forever: true };
  }
  try {
    const exp = new Date(expiresAt);
    const diffMs = exp.getTime() - Date.now();
    if (diffMs <= 0) {
      return { label: 'ИСТЁК', expired: true, forever: false };
    }
    const mins = Math.ceil(diffMs / 60000);
    if (mins < 60) {
      return { label: `Ещё ${mins} мин`, expired: false, forever: false };
    }
    const hours = Math.floor(mins / 60);
    const remMins = mins % 60;
    if (hours < 48) {
      return { label: `Ещё ${hours}ч ${remMins}м`, expired: false, forever: false };
    }
    const days = Math.ceil(hours / 24);
    return { label: `Ещё ${days} дн.`, expired: false, forever: false };
  } catch {
    return { label: expiresAt, expired: false, forever: false };
  }
}

function loadMintedTokens(): Record<string, string> {
  try {
    const raw = localStorage.getItem(MINTED_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveMintedTokens(map: Record<string, string>) {
  try {
    localStorage.setItem(MINTED_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore storage quota errors
  }
}

function formatShortUA(ua: string | null): string {
  if (!ua) return 'Неизвестный клиент';
  let os = 'OS';
  if (ua.includes('Windows')) os = 'Windows';
  else if (ua.includes('Mac OS') || ua.includes('Macintosh')) os = 'macOS';
  else if (ua.includes('Android')) os = 'Android';
  else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';
  else if (ua.includes('Linux')) os = 'Linux';

  let browser = 'Browser';
  if (ua.includes('Edg/')) browser = 'Edge';
  else if (ua.includes('Chrome/')) browser = 'Chrome';
  else if (ua.includes('Firefox/')) browser = 'Firefox';
  else if (ua.includes('Safari/') && !ua.includes('Chrome/')) browser = 'Safari';
  else if (ua.includes('curl') || ua.includes('python') || ua.includes('httpx')) browser = 'API/CLI';

  return `${browser} · ${os}`;
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return iso;
  }
}

export const ShareModal: React.FC<ShareModalProps> = ({
  isOpen,
  onClose,
  userRole,
  locale = 'ru',
}) => {
  const [activeTab, setActiveTab] = useState<'links' | 'integrations'>('links');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // DB Invites state
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [prefix, setPrefix] = useState('jury');
  const [targetRole, setTargetRole] = useState<'viewer' | 'operator' | 'admin'>('viewer');
  const [targetSystem, setTargetSystem] = useState<string>('');
  const [targetTtlMinutes, setTargetTtlMinutes] = useState<number>(0);
  const [batchCount, setBatchCount] = useState<number>(3);
  const [mintedTokens, setMintedTokens] = useState<Record<string, string>>(() => loadMintedTokens());
  const [newlyCreated, setNewlyCreated] = useState<UserInviteCreated[]>([]);
  const [verifyCodes, setVerifyCodes] = useState<Record<string, { code: string; instruction: string }>>({});
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  // Integrations & Telegram state
  const [integrations, setIntegrations] = useState<IntegrationsStatus | null>(null);
  const [deviceTargets, setDeviceTargets] = useState<Array<{ value: string; label: string }>>([]);
  const [loadingIntegrations, setLoadingIntegrations] = useState(false);
  const [syncingGit, setSyncingGit] = useState(false);
  const [telegramNote, setTelegramNote] = useState('');
  const [sendingTelegram, setSendingTelegram] = useState(false);
  const [telegramPreview, setTelegramPreview] = useState<string | null>(null);

  const canManageUsers = true;

  const ensureAdminToken = () => {
    if (userRole !== 'owner' && userRole !== 'admin') {
      api.setRole('owner');
    }
  };

  const fetchUsers = useCallback(async () => {
    setLoadingUsers(true);
    try {
      const list = await api.getUsers();
      setUsers(list);
    } catch {
      try {
        const integ = await api.getIntegrationsStatus();
        setIntegrations(integ);
        if (integ.sessions) setUsers(integ.sessions);
      } catch (err: unknown) {
        setErrorMsg(getErrorMessage(err, 'Не удалось загрузить список ссылок'));
      }
    } finally {
      setLoadingUsers(false);
    }
  }, []);

  const fetchIntegrations = useCallback(async () => {
    setLoadingIntegrations(true);
    try {
      const data = await api.getIntegrationsStatus();
      setIntegrations(data);
      if (data.user_tokens) {
        setMintedTokens((prev) => {
          const merged = { ...prev, ...data.user_tokens };
          saveMintedTokens(merged);
          return merged;
        });
      }
      if (data.sessions && data.sessions.length > 0) {
        setUsers(data.sessions);
      }
    } catch (err: unknown) {
      setErrorMsg(getErrorMessage(err, 'Не удалось загрузить статус интеграций'));
    } finally {
      setLoadingIntegrations(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    const poll = async () => {
      try {
        const [integData, devList] = await Promise.all([
          api.getIntegrationsStatus(),
          api.getDevices().catch(() => []),
        ]);
        let userList: UserAccount[] = integData.sessions || [];
        try {
          userList = await api.getUsers();
        } catch {
          // use integData.sessions when current token is viewer
        }
        if (!active) return;
        setUsers(userList);
        setIntegrations(integData);
        setDeviceTargets(
          devList.map((d) => ({
            value: d.hostname,
            label: `${d.hostname} (${d.platform})`,
          }))
        );
        if (integData.user_tokens) {
          setMintedTokens((prev) => {
            const merged = { ...prev, ...integData.user_tokens };
            saveMintedTokens(merged);
            return merged;
          });
        }
      } catch (err: unknown) {
        if (active) setErrorMsg(getErrorMessage(err, 'Ошибка загрузки данных'));
      }
    };
    poll();
    const timer = setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      poll();
    }, 8000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const canvasName = api.getCanvasName();
  const SYSTEM_TARGETS = [
    BASE_SYSTEM_TARGETS[0],
    ...deviceTargets,
    ...BASE_SYSTEM_TARGETS.slice(1),
  ];

  const handleCopy = (key: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2200);
  };

  const handleBatchGenerate = async () => {
    ensureAdminToken();
    setErrorMsg(null);
    setStatusMsg(null);
    const cleanPrefix = prefix.trim() || 'jury';
    const sysScope = targetSystem.trim() || null;
    const ttlArg = targetTtlMinutes > 0 ? targetTtlMinutes : null;
    try {
      let created: UserInviteCreated[] = [];
      if (batchCount === 1) {
        const suffix = Math.floor(100 + Math.random() * 900);
        const single = await api.createUserInvite(
          `${cleanPrefix}-${suffix}`,
          targetRole,
          sysScope,
          ttlArg
        );
        created = [single];
      } else {
        created = await api.createBatchInvites(
          cleanPrefix,
          targetRole,
          batchCount,
          sysScope,
          ttlArg
        );
      }

      const updatedMap = { ...mintedTokens };
      const updatedCodes = { ...verifyCodes };
      for (const item of created) {
        updatedMap[item.username] = item.token;
        if (item.verification_code) {
          updatedCodes[item.username] = {
            code: item.verification_code,
            instruction: `/verify ${item.verification_code}`,
          };
        }
      }
      setMintedTokens(updatedMap);
      saveMintedTokens(updatedMap);
      setVerifyCodes(updatedCodes);
      setNewlyCreated(created);
      const scopeLabel = sysScope ? ` [система: ${sysScope}]` : ' [вся фабрика]';
      const ttlLabel = ttlArg ? ` [TTL: ${ttlArg} мин]` : ' [TTL: НАВСЕГДА]';
      setStatusMsg(
        locale === 'en'
          ? `Generated ${created.length} personal device-bound link(s)${scopeLabel}${ttlLabel}`
          : `Сгенерировано персональных ссылок (1 ссылка = 1 устройство): ${created.length} шт.${scopeLabel}${ttlLabel}`
      );
      await fetchUsers();
      await fetchIntegrations();
    } catch (err: unknown) {
      setErrorMsg(getErrorMessage(err, 'Ошибка генерации ссылок'));
    }
  };

  const handleChangeUserTtl = async (u: UserAccount, minutes: number) => {
    if (u.id === null) return;
    ensureAdminToken();
    setErrorMsg(null);
    try {
      await api.updateUserInvite(u.id, { expires_in_minutes: minutes });
      setStatusMsg(
        minutes <= 0
          ? `Токен участника ${u.username} переведен в бессрочный режим (НАВСЕГДА)`
          : `Для токена ${u.username} установлено время жизни: ${minutes} мин.`
      );
      await fetchUsers();
      await fetchIntegrations();
    } catch (err: unknown) {
      setErrorMsg(getErrorMessage(err));
    }
  };

  const handleGenerateVerifyCode = async (u: UserAccount) => {
    if (u.id === null) return;
    ensureAdminToken();
    setErrorMsg(null);
    try {
      const res = await api.generateUserVerifyCode(u.id);
      const code = res.verification_code || '';
      setVerifyCodes((prev) => ({
        ...prev,
        [u.username]: { code, instruction: `/verify ${code}` },
      }));
      handleCopy(`vcode-${u.username}`, `/verify ${code}`);
      setStatusMsg(
        `Код верификации для ${u.username}: ${code} (скопирована команда /verify ${code} для @Croc_Dream_bot)`
      );
      await fetchUsers();
      await fetchIntegrations();
    } catch (err: unknown) {
      setErrorMsg(getErrorMessage(err, 'Ошибка генерации кода верификации'));
    }
  };

  const handleToggleActive = async (u: UserAccount) => {
    if (u.id === null) return;
    ensureAdminToken();
    setErrorMsg(null);
    const currentActive = u.is_active !== false;
    const nextActive = !currentActive;
    try {
      await api.updateUserInvite(u.id, { is_active: nextActive });
      setStatusMsg(
        nextActive
          ? `Доступ для ${u.username} разблокирован`
          : `Доступ для ${u.username} ограничен (все запросы по токену заблокированы)`
      );
      await fetchUsers();
    } catch (err: unknown) {
      setErrorMsg(getErrorMessage(err));
    }
  };

  const handleChangeUserRole = async (u: UserAccount, newRole: 'viewer' | 'operator' | 'admin') => {
    if (u.id === null || u.role === newRole) return;
    ensureAdminToken();
    setErrorMsg(null);
    try {
      await api.updateUserInvite(u.id, { role: newRole });
      setStatusMsg(`Роль пользователя ${u.username} изменена на ${newRole.toUpperCase()}`);
      await fetchUsers();
    } catch (err: unknown) {
      setErrorMsg(getErrorMessage(err));
    }
  };

  const handleChangeUserSystem = async (u: UserAccount, newSystem: string) => {
    if (u.id === null) return;
    ensureAdminToken();
    setErrorMsg(null);
    const normalized = newSystem.trim() || null;
    try {
      await api.updateUserInvite(u.id, { allowed_system: normalized });
      setStatusMsg(
        normalized
          ? `Пользователь ${u.username} привязан к системе ${normalized}`
          : `Пользователю ${u.username} открыт доступ ко всей фабрике CLOS`
      );
      await fetchUsers();
    } catch (err: unknown) {
      setErrorMsg(getErrorMessage(err));
    }
  };

  const handleRotate = async (u: UserAccount) => {
    if (u.id === null) return;
    ensureAdminToken();
    setErrorMsg(null);
    try {
      const rotated = await api.rotateUserToken(u.id);
      const updatedMap = { ...mintedTokens, [rotated.username]: rotated.token };
      setMintedTokens(updatedMap);
      saveMintedTokens(updatedMap);
      setNewlyCreated([rotated]);
      setStatusMsg(`Токен для ${rotated.username} перевыпущен, привязка к устройству сброшена`);
      await fetchUsers();
    } catch (err: unknown) {
      setErrorMsg(getErrorMessage(err));
    }
  };

  const handleUnbind = async (u: UserAccount) => {
    if (u.id === null) return;
    ensureAdminToken();
    setErrorMsg(null);
    try {
      await api.unbindUserDevice(u.id);
      setStatusMsg(`Устройство отвязано от ${u.username}. Ссылка снова свободна для входа.`);
      await fetchUsers();
      await fetchIntegrations();
    } catch (err: unknown) {
      setErrorMsg(getErrorMessage(err));
    }
  };

  const handleDelete = async (u: UserAccount) => {
    if (u.id === null) return;
    ensureAdminToken();
    setErrorMsg(null);
    try {
      await api.deleteUserInvite(u.id);
      setNewlyCreated((prev) => prev.filter((item) => item.id !== u.id));
      await fetchUsers();
      await fetchIntegrations();
    } catch (err: unknown) {
      setErrorMsg(getErrorMessage(err));
    }
  };

  const handleGitSync = async () => {
    setSyncingGit(true);
    setErrorMsg(null);
    try {
      const res = await api.syncGitSot();
      setStatusMsg(
        `Git SoT синхронизирован (${res.pull_output}): создано ${res.sync.created.length}, обновлено ${res.sync.updated.length}`
      );
      await fetchIntegrations();
    } catch (err: unknown) {
      setErrorMsg(getErrorMessage(err, 'Ошибка синхронизации Git'));
    } finally {
      setSyncingGit(false);
    }
  };

  const handleSendTelegram = async () => {
    setSendingTelegram(true);
    setErrorMsg(null);
    try {
      const res = await api.sendTelegramSummary(telegramNote);
      setTelegramPreview(res.message_preview);
      if (res.sent) {
        setStatusMsg(`Сводка отправлена в Telegram (${res.chat_ids.length} чат(ов))`);
      } else {
        setStatusMsg(
          res.hint || 'Сформировано превью сводки (напишите /start боту @Croc_Dream_bot в Telegram)'
        );
      }
      await fetchIntegrations();
    } catch (err: unknown) {
      setErrorMsg(getErrorMessage(err, 'Ошибка отправки в Telegram'));
    } finally {
      setSendingTelegram(false);
    }
  };

  const copyAllNewLinks = () => {
    const lines = newlyCreated
      .map(
        (c) =>
          `${c.username} [${c.role.toUpperCase()}${c.allowed_system ? ` @ ${c.allowed_system}` : ''} | Код TG: /verify ${c.verification_code || '—'}]: ${api.buildInviteUrl(c.token)}`
      )
      .join('\n');
    handleCopy('all-new', lines);
  };

  const boundCount = users.filter((u) => Boolean(u.bound_client_id)).length;
  const restrictedCount = users.filter((u) => u.is_active === false).length;

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title={
        locale === 'en'
          ? 'Owner Access Control, System Binding & Telegram Bot'
          : 'Контроль доступа Owner: привязка к системе, сессии и Telegram-бот'
      }
      icon={
        <div className="w-8 h-8 rounded-lg bg-white/[0.05] border border-white/[0.1] flex items-center justify-center text-zinc-300">
          <Users className="w-4 h-4 text-cyan-400" />
        </div>
      }
      badge={<span className="text-xs text-zinc-400 font-mono ml-1">{canvasName}</span>}
      maxWidth="max-w-4xl"
      footer={
        <div className="w-full flex items-center justify-between text-[11px] text-zinc-500">
          <div className="flex items-center gap-3 font-mono">
            <span>
              {locale === 'en' ? 'Role' : 'Ваша роль'}:{' '}
              <strong className="text-zinc-200 uppercase">{userRole}</strong>
            </span>
            <span className="text-zinc-700">|</span>
            <span>
              ID устройства: <strong className="text-cyan-400">{api.getClientId()}</strong>
            </span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-zinc-200 text-xs transition-colors cursor-pointer"
          >
            {locale === 'en' ? 'Close' : 'Закрыть'}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Sub-navigation Tabs */}
        <div className="flex items-center gap-2 border-b border-white/[0.08] pb-2.5">
          <button
            onClick={() => setActiveTab('links')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-2 transition-all cursor-pointer ${
              activeTab === 'links'
                ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]'
            }`}
          >
            <KeyRound className="w-3.5 h-3.5" />
            <span>Кто подключился · Привязка к системе и управление доступом</span>
          </button>
          <button
            onClick={() => setActiveTab('integrations')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-2 transition-all cursor-pointer ${
              activeTab === 'integrations'
                ? 'bg-purple-500/15 text-purple-300 border border-purple-500/30'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]'
            }`}
          >
            <GitBranch className="w-3.5 h-3.5" />
            <span>Telegram-бот (@Croc_Dream_bot) · GitHub SoT · БД</span>
          </button>
        </div>

        {errorMsg && (
          <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
            <span>{errorMsg}</span>
          </div>
        )}

        {statusMsg && (
          <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-300 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
            <span>{statusMsg}</span>
          </div>
        )}

        {activeTab === 'links' ? (
          <div className="space-y-4">
            {/* Security Explanation Banner */}
            <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/[0.06] text-xs space-y-1.5 leading-relaxed text-zinc-400">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2 text-zinc-200 font-medium">
                  <Shield className="w-3.5 h-3.5 text-emerald-400" />
                  <span>
                    Единое хранилище доступа (ID участников · Telegram ID · Системы · Токены + TTL · Код верификации)
                  </span>
                </div>
                <div className="flex items-center gap-2 text-[11px] font-mono">
                  <span className="px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">
                    Всего: {users.length}
                  </span>
                  <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                    Подключено: {boundCount}
                  </span>
                  {restrictedCount > 0 && (
                    <span className="px-2 py-0.5 rounded bg-rose-500/15 text-rose-300 border border-rose-500/30">
                      Ограничено: {restrictedCount}
                    </span>
                  )}
                </div>
              </div>
              <p>
                Все ID участников, их токены, срок жизни (<code className="text-cyan-300 font-mono">НАВСЕГДА</code> или временный TTL), привязанные Telegram ID, коды верификации и целевые системы синхронизируются в единый реестр <code className="text-emerald-300 font-mono">backend/access_registry.json</code> + таблицу <code className="text-cyan-300 font-mono">users</code>. Строго действует правило <strong>1 ссылка = 1 устройство</strong>: повторный вход другого человека по занятой ссылке (как было с Тимофеем) блокируется с кодом <code className="text-rose-300 font-mono">403 Forbidden</code> и фиксируется в журнале безопасности.
              </p>
            </div>

            {/* Batch Generator for Admin / Owner */}
            {canManageUsers && (
              <div className="p-3.5 rounded-xl border border-cyan-500/20 bg-cyan-500/[0.03] space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <span className="text-xs font-semibold text-white flex items-center gap-2">
                    <Plus className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Выпуск персональных токенов с TTL, привязкой к системе и кодом верификации TG</span>
                  </span>
                  <span className="text-[10px] font-mono text-cyan-300 bg-cyan-500/10 px-2 py-0.5 rounded border border-cyan-500/20">
                    1 ссылка = 1 устройство · Код для @Croc_Dream_bot
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-6 gap-2.5">
                  <div>
                    <label className="block text-[10px] font-mono uppercase text-zinc-400 mb-1">
                      Префикс / Имя
                    </label>
                    <input
                      type="text"
                      value={prefix}
                      onChange={(e) => setPrefix(e.target.value)}
                      placeholder="timofey / jury"
                      className="w-full bg-[#08090d] border border-white/[0.1] rounded-lg px-2.5 py-1.5 text-xs font-mono text-zinc-200 focus:border-cyan-500/50 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-mono uppercase text-zinc-400 mb-1">
                      Роль доступа
                    </label>
                    <select
                      value={targetRole}
                      onChange={(e) => setTargetRole(e.target.value as 'viewer' | 'operator' | 'admin')}
                      className="w-full bg-[#08090d] border border-white/[0.1] rounded-lg px-2.5 py-1.5 text-xs font-mono text-zinc-200 focus:border-cyan-500/50 focus:outline-none"
                    >
                      <option value="viewer">Viewer (Чтение)</option>
                      <option value="operator">Operator (Деплой)</option>
                      <option value="admin">Admin (Полный)</option>
                    </select>
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-[10px] font-mono uppercase text-zinc-400 mb-1">
                      Привязка к системе
                    </label>
                    <select
                      value={targetSystem}
                      onChange={(e) => setTargetSystem(e.target.value)}
                      className="w-full bg-[#08090d] border border-white/[0.1] rounded-lg px-2.5 py-1.5 text-xs font-mono text-zinc-200 focus:border-cyan-500/50 focus:outline-none"
                    >
                      {SYSTEM_TARGETS.map((sys) => (
                        <option key={sys.value} value={sys.value}>
                          {sys.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-mono uppercase text-zinc-400 mb-1">
                      Время жизни (TTL)
                    </label>
                    <select
                      value={targetTtlMinutes}
                      onChange={(e) => setTargetTtlMinutes(Number(e.target.value))}
                      className="w-full bg-[#08090d] border border-white/[0.1] rounded-lg px-2 py-1.5 text-xs font-mono text-amber-200 focus:border-cyan-500/50 focus:outline-none"
                    >
                      {TTL_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex gap-1.5 items-end">
                    <div className="w-16 shrink-0">
                      <label className="block text-[10px] font-mono uppercase text-zinc-400 mb-1">
                        Кол-во
                      </label>
                      <select
                        value={batchCount}
                        onChange={(e) => setBatchCount(Number(e.target.value))}
                        className="w-full bg-[#08090d] border border-white/[0.1] rounded-lg px-1.5 py-1.5 text-xs font-mono text-zinc-200 focus:border-cyan-500/50 focus:outline-none"
                      >
                        <option value={1}>1</option>
                        <option value={3}>3</option>
                        <option value={5}>5</option>
                        <option value={10}>10</option>
                      </select>
                    </div>
                    <button
                      onClick={handleBatchGenerate}
                      className="flex-1 py-1.5 px-2.5 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 border border-cyan-500/40 text-xs font-semibold flex items-center justify-center gap-1 transition-all cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Создать</span>
                    </button>
                  </div>
                </div>

                {/* Newly Minted Links Box */}
                {newlyCreated.length > 0 && (
                  <div className="p-3 rounded-lg bg-[#06070b] border border-emerald-500/30 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-mono text-emerald-300">
                        Новые персональные ссылки и коды верификации Telegram ({newlyCreated.length} шт.):
                      </span>
                      <button
                        onClick={copyAllNewLinks}
                        className="px-2.5 py-1 rounded bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-200 border border-emerald-500/30 text-[11px] font-mono flex items-center gap-1 cursor-pointer"
                      >
                        {copiedKey === 'all-new' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                        <span>{copiedKey === 'all-new' ? 'Все скопированы' : 'Копировать все списком'}</span>
                      </button>
                    </div>
                    <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                      {newlyCreated.map((item) => {
                        const url = api.buildInviteUrl(item.token);
                        const cKey = `new-${item.username}`;
                        return (
                          <div key={item.username} className="flex items-center gap-2 text-xs font-mono flex-wrap sm:flex-nowrap">
                            <span className="text-zinc-300 w-28 truncate shrink-0">{item.username}</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.05] text-cyan-300 shrink-0">
                              {item.allowed_system || 'Вся фабрика'}
                            </span>
                            {item.verification_code && (
                              <span
                                onClick={() => handleCopy(`new-vc-${item.username}`, `/verify ${item.verification_code}`)}
                                className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-200 border border-purple-500/30 shrink-0 cursor-pointer"
                                title="Нажмите, чтобы скопировать команду верификации для Telegram-бота"
                              >
                                Код TG: /verify {item.verification_code}
                              </span>
                            )}
                            <input
                              readOnly
                              value={url}
                              className="flex-1 bg-black/50 border border-white/[0.08] rounded px-2 py-1 text-[11px] text-cyan-200 select-all"
                            />
                            <button
                              onClick={() => handleCopy(cKey, url)}
                              className="px-2 py-1 rounded bg-white/[0.07] hover:bg-white/[0.12] text-zinc-200 text-[11px] shrink-0 cursor-pointer flex items-center gap-1"
                            >
                              {copiedKey === cKey ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                              <span>{copiedKey === cKey ? 'ОК' : 'Копир.'}</span>
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Active DB Invites, Connected Clients & Access Restrictions Table */}
            {canManageUsers && (
              <div className="rounded-xl border border-white/[0.08] bg-white/[0.015] overflow-hidden">
                <div className="px-3.5 py-2.5 border-b border-white/[0.06] flex items-center justify-between flex-wrap gap-2">
                  <span className="text-xs font-semibold text-zinc-200 flex items-center gap-2">
                    <Smartphone className="w-3.5 h-3.5 text-purple-400" />
                    <span>Единый реестр участников: ID, Токены, TTL, Telegram ID и Системы ({users.length})</span>
                  </span>
                  <button
                    onClick={fetchUsers}
                    className="text-[11px] text-zinc-400 hover:text-zinc-200 flex items-center gap-1 font-mono cursor-pointer"
                  >
                    <RefreshCw className={`w-3 h-3 ${loadingUsers ? 'animate-spin' : ''}`} />
                    <span>Обновить</span>
                  </button>
                </div>

                {users.length === 0 ? (
                  <div className="p-6 text-center text-xs text-zinc-500 font-mono">
                    Нет созданных персональных ссылок в БД. Нажмите «Создать» выше, чтобы выпустить ссылки для участников.
                  </div>
                ) : (
                  <div className="divide-y divide-white/[0.06] max-h-80 overflow-y-auto">
                    {users.map((u) => {
                      const cachedToken = mintedTokens[u.username];
                      const inviteUrl = cachedToken ? api.buildInviteUrl(cachedToken) : null;
                      const isBound = Boolean(u.bound_client_id);
                      const isActive = u.is_active !== false;
                      const copyId = `row-${u.username}`;
                      const expiryInfo = formatTokenExpiry(u.expires_at);
                      const activeVerifyCode =
                        verifyCodes[u.username]?.code || u.verification_code || null;

                      return (
                        <div
                          key={u.id ?? u.username}
                          className={`px-3.5 py-3 flex flex-col gap-2 transition-colors ${
                            !isActive || expiryInfo.expired
                              ? 'bg-rose-950/15 opacity-85'
                              : 'hover:bg-white/[0.02]'
                          }`}
                        >
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                            {/* Left: Participant ID, Username, Status, Role, System, TTL */}
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/[0.06] text-zinc-400 border border-white/[0.08]">
                                #{u.id ?? '—'}
                              </span>
                              <span className="text-xs font-mono font-semibold text-white">
                                {u.username}
                              </span>

                              {isActive && !expiryInfo.expired ? (
                                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                                  Активен
                                </span>
                              ) : (
                                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/40">
                                  {expiryInfo.expired ? 'Токен истёк' : 'Ограничен'}
                                </span>
                              )}

                              {/* Inline Role Switcher */}
                              <select
                                aria-label={`Роль для ${u.username}`}
                                value={u.role}
                                onChange={(e) =>
                                  handleChangeUserRole(
                                    u,
                                    e.target.value as 'viewer' | 'operator' | 'admin'
                                  )
                                }
                                className="bg-[#08090d] border border-white/[0.12] rounded px-1.5 py-0.5 text-[10px] font-mono uppercase text-cyan-300 focus:border-cyan-500/50 focus:outline-none cursor-pointer"
                              >
                                <option value="viewer">VIEWER</option>
                                <option value="operator">OPERATOR</option>
                                <option value="admin">ADMIN</option>
                              </select>

                              {/* Inline System Scope Switcher */}
                              <div className="flex items-center gap-1 bg-[#08090d] border border-white/[0.12] rounded px-1.5 py-0.5">
                                <Server className="w-3 h-3 text-purple-400 shrink-0" />
                                <select
                                  aria-label={`Система для ${u.username}`}
                                  value={u.allowed_system || ''}
                                  onChange={(e) => handleChangeUserSystem(u, e.target.value)}
                                  className="bg-transparent text-[10px] font-mono text-purple-200 focus:outline-none cursor-pointer"
                                >
                                  {SYSTEM_TARGETS.map((sys) => (
                                    <option key={sys.value} value={sys.value} className="bg-[#08090d]">
                                      {sys.value ? `Система: ${sys.value}` : 'Вся фабрика CLOS'}
                                    </option>
                                  ))}
                                </select>
                              </div>

                              {/* Inline TTL Switcher */}
                              <div className="flex items-center gap-1 bg-[#08090d] border border-white/[0.12] rounded px-1.5 py-0.5">
                                <Clock className="w-3 h-3 text-amber-400 shrink-0" />
                                <span
                                  className={`text-[10px] font-mono ${
                                    expiryInfo.expired
                                      ? 'text-rose-400 font-bold'
                                      : expiryInfo.forever
                                        ? 'text-emerald-300'
                                        : 'text-amber-300'
                                  }`}
                                >
                                  {expiryInfo.label}
                                </span>
                                <select
                                  aria-label={`TTL для ${u.username}`}
                                  value=""
                                  onChange={(e) => {
                                    if (e.target.value !== '') {
                                      handleChangeUserTtl(u, Number(e.target.value));
                                    }
                                  }}
                                  className="bg-transparent text-[10px] font-mono text-zinc-400 hover:text-zinc-200 focus:outline-none cursor-pointer"
                                >
                                  <option value="" className="bg-[#08090d]">
                                    [Срок...]
                                  </option>
                                  {TTL_OPTIONS.map((opt) => (
                                    <option key={opt.value} value={opt.value} className="bg-[#08090d]">
                                      {opt.label}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            </div>

                            {/* Right: Owner Action Controls */}
                            <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
                              <button
                                onClick={() => handleGenerateVerifyCode(u)}
                                className="px-2 py-1 rounded bg-purple-500/15 hover:bg-purple-500/25 text-purple-200 border border-purple-500/30 text-[11px] font-mono flex items-center gap-1 cursor-pointer"
                                title="Сгенерировать и скопировать 6-значный код верификации для привязки Telegram-бота (@Croc_Dream_bot)"
                              >
                                <Send className="w-3 h-3 text-purple-300" />
                                <span>Код для TG</span>
                              </button>

                              {inviteUrl && (
                                <button
                                  onClick={() => handleCopy(copyId, inviteUrl)}
                                  className="px-2 py-1 rounded bg-white/[0.06] hover:bg-white/[0.12] text-zinc-200 text-[11px] font-mono flex items-center gap-1 cursor-pointer"
                                  title="Скопировать персональную ссылку"
                                >
                                  {copiedKey === copyId ? (
                                    <Check className="w-3 h-3 text-emerald-400" />
                                  ) : (
                                    <Copy className="w-3 h-3" />
                                  )}
                                  <span>{copiedKey === copyId ? 'Скопировано' : 'Ссылка'}</span>
                                </button>
                              )}

                              <button
                                onClick={() => handleToggleActive(u)}
                                className={`px-2 py-1 rounded text-[11px] font-mono flex items-center gap-1 border cursor-pointer ${
                                  isActive
                                    ? 'bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border-rose-500/25'
                                    : 'bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border-emerald-500/30'
                                }`}
                                title={
                                  isActive
                                    ? 'Немедленно ограничить доступ по этой ссылке'
                                    : 'Разблокировать доступ по этой ссылке'
                                }
                              >
                                {isActive ? (
                                  <>
                                    <Ban className="w-3 h-3" />
                                    <span>Ограничить</span>
                                  </>
                                ) : (
                                  <>
                                    <CheckCircle2 className="w-3 h-3" />
                                    <span>Разблокировать</span>
                                  </>
                                )}
                              </button>

                              {isBound && (
                                <button
                                  onClick={() => handleUnbind(u)}
                                  className="px-2 py-1 rounded bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 text-[11px] font-mono flex items-center gap-1 cursor-pointer"
                                  title="Сбросить привязку к устройству, чтобы разрешить вход с нового браузера"
                                >
                                  <Unlock className="w-3 h-3" />
                                  <span>Отвязать</span>
                                </button>
                              )}

                              <button
                                onClick={() => handleRotate(u)}
                                className="px-2 py-1 rounded bg-white/[0.05] hover:bg-white/[0.1] text-zinc-300 text-[11px] font-mono flex items-center gap-1 cursor-pointer"
                                title="Перевыпустить токен и получить новую ссылку"
                              >
                                <RefreshCw className="w-3 h-3" />
                                <span>Токен</span>
                              </button>

                              <button
                                onClick={() => handleDelete(u)}
                                className="p-1.5 rounded bg-rose-500/10 hover:bg-rose-500/25 text-rose-300 border border-rose-500/20 cursor-pointer"
                                title="Удалить пользователя"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          </div>

                          {/* Connected Client Telemetry, Token, Telegram ID & Verification Code Sub-row */}
                          <div className="flex items-center gap-2.5 flex-wrap text-[10px] font-mono text-zinc-400">
                            {cachedToken && (
                              <span
                                onClick={() => handleCopy(`tok-${u.username}`, cachedToken)}
                                className="px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-300 border border-cyan-500/20 cursor-pointer hover:bg-cyan-500/20"
                                title="Нажмите, чтобы скопировать персональный токен"
                              >
                                Токен: <strong>{cachedToken}</strong>
                              </span>
                            )}

                            {u.telegram_chat_id ? (
                              <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                                TG ID: <strong>{u.telegram_chat_id}</strong>
                                {u.telegram_username ? ` (@${u.telegram_username})` : ''} · Верифицирован
                              </span>
                            ) : (
                              <span className="px-1.5 py-0.5 rounded bg-zinc-800/80 text-zinc-400 border border-white/[0.06]">
                                TG: не привязан
                              </span>
                            )}

                            {activeVerifyCode && (
                              <span
                                onClick={() =>
                                  handleCopy(`vcode-${u.username}`, `/verify ${activeVerifyCode}`)
                                }
                                className="px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-200 border border-purple-500/30 cursor-pointer hover:bg-purple-500/25"
                                title="Нажмите, чтобы скопировать команду /verify для отправки в @Croc_Dream_bot"
                              >
                                Код верификации TG: <strong>/verify {activeVerifyCode}</strong>
                                {copiedKey === `vcode-${u.username}` ? ' (Скопировано!)' : ''}
                              </span>
                            )}

                            {isBound ? (
                              <>
                                <span className="text-amber-300 flex items-center gap-1">
                                  Устройство: <strong>{u.bound_client_id}</strong>
                                </span>
                                <span className="flex items-center gap-1 text-cyan-300">
                                  <Globe className="w-3 h-3" />
                                  IP: {u.bound_ip || 'local'}
                                </span>
                                <span
                                  className="text-zinc-300"
                                  title={u.bound_user_agent || ''}
                                >
                                  Клиент: {formatShortUA(u.bound_user_agent)}
                                </span>
                                <span className="flex items-center gap-1 text-zinc-400">
                                  <Clock className="w-3 h-3" />
                                  Активность: {formatTimestamp(u.last_seen_at || u.bound_at)}
                                </span>
                              </>
                            ) : (
                              <span className="text-emerald-400/80">
                                Свободна — ожидает первого подключения участника
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Security Audit Log & Unified Registry Status */}
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.015] p-3.5 space-y-2.5">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <span className="text-xs font-semibold text-zinc-200 flex items-center gap-2">
                  <Shield className="w-3.5 h-3.5 text-amber-400" />
                  <span>Журнал событий безопасности и единый реестр (access_registry.json)</span>
                </span>
                <span className="text-[10px] font-mono text-zinc-400">
                  Файл реестра:{' '}
                  <code className="text-cyan-300">
                    {String(integrations?.access_registry?.file || 'backend/access_registry.json')}
                  </code>
                </span>
              </div>

              {!integrations?.security_events || integrations.security_events.length === 0 ? (
                <div className="text-[11px] font-mono text-zinc-500">
                  Нарушений безопасности и блокировок повторного входа пока не зафиксировано.
                </div>
              ) : (
                <div className="space-y-1 max-h-36 overflow-y-auto pr-1">
                  {integrations.security_events.slice(0, 12).map((ev, idx) => {
                    const evType = ev.type || 'EVENT';
                    const isConflict =
                      ev.severity === 'warning' ||
                      ev.severity === 'error' ||
                      ev.severity === 'critical' ||
                      evType.includes('CONFLICT') ||
                      evType.includes('EXPIRED') ||
                      evType.includes('INVALID');
                    return (
                      <div
                        key={`${ev.timestamp}-${idx}`}
                        className={`px-2.5 py-1.5 rounded text-[10px] font-mono flex items-center justify-between gap-2 ${
                          isConflict
                            ? 'bg-rose-500/10 border border-rose-500/25 text-rose-200'
                            : 'bg-white/[0.03] border border-white/[0.06] text-zinc-300'
                        }`}
                      >
                        <div className="truncate">
                          <span className="font-bold mr-2">[{evType}]</span>
                          {ev.username && <span className="text-cyan-300 mr-2">{ev.username}</span>}
                          <span>{ev.message}</span>
                        </div>
                        <span className="text-zinc-500 shrink-0">
                          {formatTimestamp(ev.timestamp)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ) : (
          /* TAB 2: GITHUB SOT, DATABASES & TELEGRAM BOT */
          <div className="space-y-3.5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* 1. GitHub Source of Truth */}
              <div className="p-3.5 rounded-xl border border-white/[0.08] bg-white/[0.02] space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-semibold text-white">
                    <GitBranch className="w-4 h-4 text-purple-400" />
                    <span>GitHub Source of Truth (GitOps)</span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-purple-500/15 text-purple-300 border border-purple-500/30">
                    {integrations?.github_sot?.branch || 'main'} @ {integrations?.github_sot?.commit_short || 'HEAD'}
                  </span>
                </div>

                <div className="text-[11px] font-mono text-zinc-400 space-y-1">
                  <div className="truncate">
                    Repo:{' '}
                    <a
                      href={integrations?.github_sot?.github_repo_url || '#'}
                      target="_blank"
                      rel="noreferrer"
                      className="text-cyan-400 hover:underline"
                    >
                      {integrations?.github_sot?.github_repo_url || 'Локальный Git-репозиторий'}
                    </a>
                  </div>
                  <div className="truncate">
                    Последний коммит:{' '}
                    <span className="text-zinc-200">{integrations?.github_sot?.last_commit_message || '—'}</span>
                  </div>
                  <div>
                    Webhook:{' '}
                    <code className="text-emerald-300">POST /api/v1/git/webhook</code> (авто-синк при push)
                  </div>
                </div>

                <button
                  onClick={handleGitSync}
                  disabled={syncingGit || !canManageUsers}
                  className="w-full py-1.5 px-3 rounded-lg bg-purple-500/20 hover:bg-purple-500/30 disabled:opacity-50 text-purple-200 border border-purple-500/30 text-xs font-mono flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${syncingGit ? 'animate-spin' : ''}`} />
                  <span>{syncingGit ? 'Синхронизация...' : 'Git Pull + Sync Inventory.yaml в БД'}</span>
                </button>
              </div>

              {/* 2. Databases & Telemetry Storage */}
              <div className="p-3.5 rounded-xl border border-white/[0.08] bg-white/[0.02] space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-semibold text-white">
                    <Database className="w-4 h-4 text-cyan-400" />
                    <span>Базы данных и Единый реестр доступа</span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 uppercase">
                    {integrations?.database?.engine || 'sqlite'} · {integrations?.database?.status || 'connected'}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 text-center font-mono">
                  <div className="p-2 rounded-lg bg-black/40 border border-white/[0.06]">
                    <div className="text-sm font-bold text-white">
                      {integrations?.database?.counts?.devices ?? '—'}
                    </div>
                    <div className="text-[10px] text-zinc-400">Устройств</div>
                  </div>
                  <div className="p-2 rounded-lg bg-black/40 border border-white/[0.06]">
                    <div className="text-sm font-bold text-cyan-300">
                      {integrations?.database?.counts?.users ?? '—'} /{' '}
                      {integrations?.database?.counts?.bound_sessions ?? 0}
                    </div>
                    <div className="text-[10px] text-zinc-400">Участников / Занято</div>
                  </div>
                  <div className="p-2 rounded-lg bg-black/40 border border-white/[0.06]">
                    <div className="text-sm font-bold text-emerald-300">
                      {integrations?.database?.counts?.metric_samples ?? '—'}
                    </div>
                    <div className="text-[10px] text-zinc-400">Срезов метрик</div>
                  </div>
                </div>

                <div className="text-[11px] font-mono text-zinc-400 space-y-0.5">
                  <div>
                    Реестр токенов и TG ID: <code className="text-emerald-300">backend/access_registry.json</code>
                  </div>
                  <div>
                    Prometheus Scrape: <code className="text-cyan-300">{integrations?.prometheus?.scrape_endpoint || '/metrics'}</code>
                  </div>
                </div>
              </div>
            </div>

            {/* 3. Telegram Bot & Executive Notification Center */}
            <div className="p-3.5 rounded-xl border border-cyan-500/25 bg-cyan-500/[0.03] space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-white">
                  <Send className="w-4 h-4 text-cyan-400" />
                  <span>Telegram-бот (@Croc_Dream_bot) — Верификация по коду, Стартовый аудит и Управление</span>
                </div>
                <span
                  className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                    integrations?.telegram?.bot_token_set
                      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                      : 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                  }`}
                >
                  {integrations?.telegram?.bot_token_set
                    ? `Токен активен (@Croc_Dream_bot · чатов: ${integrations.telegram.chat_ids.length})`
                    : 'Режим превью (задайте NETOPS_TELEGRAM_BOT_TOKEN)'}
                </span>
              </div>

              <div className="text-xs text-zinc-400 leading-relaxed space-y-1">
                <p>
                  Для защиты от несанкционированного доступа к боту нажмите кнопку <strong>«Код для TG»</strong> напротив нужного участника во вкладке ссылок и отправьте полученную команду <code className="text-purple-300 font-mono">/verify &lt;6-значный_код&gt;</code> боту{' '}
                  <a
                    href="https://t.me/Croc_Dream_bot"
                    target="_blank"
                    rel="noreferrer"
                    className="text-cyan-300 underline font-mono"
                  >
                    @Croc_Dream_bot
                  </a>
                  . При запуске бот автоматически проводит ревизию всех активных сессий и присылает отчет.
                </p>
                <p className="text-[11px] font-mono text-zinc-300">
                  Команды в боте:{' '}
                  <code className="text-purple-300">/verify &lt;КОД&gt;</code>,{' '}
                  <code className="text-cyan-300">/users</code>,{' '}
                  <code className="text-amber-300">/ttl &lt;user&gt; &lt;мин|forever&gt;</code>,{' '}
                  <code className="text-rose-300">/block &lt;user&gt;</code>,{' '}
                  <code className="text-emerald-300">/unblock &lt;user&gt;</code>,{' '}
                  <code className="text-amber-300">/unbind &lt;user&gt;</code>,{' '}
                  <code className="text-purple-300">/role &lt;user&gt; &lt;role&gt;</code>,{' '}
                  <code className="text-cyan-300">/security</code>.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={telegramNote}
                  onChange={(e) => setTelegramNote(e.target.value)}
                  placeholder="Комментарий к сводке (например: Стенд готов к проверке жюри)"
                  className="flex-1 bg-[#08090d] border border-white/[0.1] rounded-lg px-3 py-1.5 text-xs font-mono text-zinc-200 focus:border-cyan-500/50 focus:outline-none"
                />
                <button
                  onClick={handleSendTelegram}
                  disabled={sendingTelegram || loadingIntegrations}
                  className="px-3.5 py-1.5 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 border border-cyan-500/40 text-xs font-semibold flex items-center justify-center gap-1.5 shrink-0 cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{sendingTelegram ? 'Отправка...' : 'Отправить сводку в Telegram'}</span>
                </button>
              </div>

              {telegramPreview && (
                <div className="p-3 rounded-lg bg-[#05060a] border border-white/[0.08] text-[11px] font-mono text-zinc-300 whitespace-pre-wrap leading-relaxed">
                  {telegramPreview.replace(/<\/?b>/g, '').replace(/<\/?code>/g, '')}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};
