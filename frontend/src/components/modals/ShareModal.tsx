import React, { useState, useEffect, useCallback } from 'react';
import {
  Copy,
  Check,
  Users,
  Plus,
  RefreshCw,
  Unlock,
  Trash2,
  GitBranch,
  Database,
  Send,
  KeyRound,
  CheckCircle2,
  AlertCircle,
  Ban,
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
  { value: '', label: 'Вся фабрика' },
  { value: 'telemetry:prometheus', label: 'Prometheus' },
  { value: 'sot:netbox', label: 'NetBox / Git' },
];

const TTL_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: 'Навсегда' },
  { value: 15, label: '15 мин' },
  { value: 60, label: '1 час' },
  { value: 480, label: '8 часов' },
  { value: 1440, label: '24 часа' },
  { value: 10080, label: '7 дней' },
];

function formatTokenExpiry(expiresAt: string | null | undefined): {
  label: string;
  expired: boolean;
  forever: boolean;
} {
  if (!expiresAt) {
    return { label: 'Навсегда', expired: false, forever: true };
  }
  try {
    const exp = new Date(expiresAt);
    const diffMs = exp.getTime() - Date.now();
    if (diffMs <= 0) {
      return { label: 'Истёк', expired: true, forever: false };
    }
    const mins = Math.ceil(diffMs / 60000);
    if (mins < 60) {
      return { label: `${mins}м`, expired: false, forever: false };
    }
    const hours = Math.floor(mins / 60);
    const remMins = mins % 60;
    if (hours < 48) {
      return { label: `${hours}ч ${remMins}м`, expired: false, forever: false };
    }
    const days = Math.ceil(hours / 24);
    return { label: `${days}д`, expired: false, forever: false };
  } catch {
    return { label: expiresAt, expired: false, forever: false };
  }
}

function shortToken(tok: string): string {
  if (tok.length <= 14) return tok;
  return `${tok.slice(0, 6)}…${tok.slice(-4)}`;
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
  if (!ua) return 'CLI';
  let os = 'OS';
  if (ua.includes('Windows')) os = 'Win';
  else if (ua.includes('Mac OS') || ua.includes('Macintosh')) os = 'Mac';
  else if (ua.includes('Android')) os = 'Android';
  else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';
  else if (ua.includes('Linux')) os = 'Linux';

  let browser = 'Web';
  if (ua.includes('Edg/')) browser = 'Edge';
  else if (ua.includes('Chrome/')) browser = 'Chrome';
  else if (ua.includes('Firefox/')) browser = 'Firefox';
  else if (ua.includes('Safari/') && !ua.includes('Chrome/')) browser = 'Safari';
  else if (ua.includes('curl') || ua.includes('python') || ua.includes('httpx')) browser = 'API';

  return `${browser}/${os}`;
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

const ctrlClass =
  'bg-[var(--bg-main)] border border-[var(--border-subtle)] hover:border-[var(--border-hover)] focus:border-[var(--text-primary)] rounded-md text-xs font-mono text-[var(--text-primary)] focus:outline-none transition-colors';

const ghostBtnClass =
  'border border-[var(--border-subtle)] hover:border-[var(--border-hover)] bg-[var(--bg-elevated)]/60 hover:bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded-md font-mono transition-colors cursor-pointer';

const primaryBtnClass =
  'bg-[var(--text-primary)] hover:opacity-90 text-[var(--bg-main)] border border-[var(--text-primary)] rounded-md font-semibold transition-opacity cursor-pointer disabled:opacity-40';

export const ShareModal: React.FC<ShareModalProps> = ({
  isOpen,
  onClose,
  userRole,
  locale = 'ru',
}) => {
  const [activeTab, setActiveTab] = useState<'links' | 'integrations'>('links');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const [users, setUsers] = useState<UserAccount[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [prefix, setPrefix] = useState('jury');
  const [targetRole, setTargetRole] = useState<'viewer' | 'operator' | 'admin'>('viewer');
  const [targetSystem, setTargetSystem] = useState<string>('');
  const [targetTtlMinutes, setTargetTtlMinutes] = useState<number>(0);
  const [batchCount, setBatchCount] = useState<number>(1);
  const [mintedTokens, setMintedTokens] = useState<Record<string, string>>(() => loadMintedTokens());
  const [newlyCreated, setNewlyCreated] = useState<UserInviteCreated[]>([]);
  const [verifyCodes, setVerifyCodes] = useState<Record<string, { code: string; instruction: string }>>({});
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const [integrations, setIntegrations] = useState<IntegrationsStatus | null>(null);
  const [deviceTargets, setDeviceTargets] = useState<Array<{ value: string; label: string }>>([]);
  const [loadingIntegrations, setLoadingIntegrations] = useState(false);
  const [syncingGit, setSyncingGit] = useState(false);
  const [telegramNote, setTelegramNote] = useState('');
  const [sendingTelegram, setSendingTelegram] = useState(false);
  const [telegramPreview, setTelegramPreview] = useState<string | null>(null);

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
        setErrorMsg(getErrorMessage(err, 'Ошибка загрузки'));
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
      setErrorMsg(getErrorMessage(err, 'Ошибка загрузки интеграций'));
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
          api.getBootstrapStatus().catch(() => null),
        ]);
        let userList: UserAccount[] = integData.sessions || [];
        try {
          userList = await api.getUsers();
        } catch {
          // fallback to integData.sessions
        }
        if (!active) return;
        setUsers(userList);
        setIntegrations(integData);
        setDeviceTargets(
          devList.map((d) => ({
            value: d.hostname,
            label: d.hostname,
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
        if (active) setErrorMsg(getErrorMessage(err, 'Ошибка загрузки'));
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
    setTimeout(() => setCopiedKey(null), 2000);
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
      setStatusMsg(`Создано: ${created.length}`);
      await fetchUsers();
      await fetchIntegrations();
    } catch (err: unknown) {
      setErrorMsg(getErrorMessage(err, 'Ошибка создания'));
    }
  };

  const handleChangeUserTtl = async (u: UserAccount, minutes: number) => {
    if (u.id === null) return;
    ensureAdminToken();
    setErrorMsg(null);
    try {
      await api.updateUserInvite(u.id, { expires_in_minutes: minutes });
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
      setStatusMsg(`${u.username}: скопировано /verify ${code}`);
      await fetchUsers();
      await fetchIntegrations();
    } catch (err: unknown) {
      setErrorMsg(getErrorMessage(err, 'Ошибка генерации кода'));
    }
  };

  const handleToggleActive = async (u: UserAccount) => {
    if (u.id === null) return;
    ensureAdminToken();
    setErrorMsg(null);
    const nextActive = u.is_active === false;
    try {
      await api.updateUserInvite(u.id, { is_active: nextActive });
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
      setStatusMsg(`Токен ${rotated.username} обновлён`);
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
        `Git Sync: +${res.sync.created.length} / ~${res.sync.updated.length}`
      );
      await fetchIntegrations();
    } catch (err: unknown) {
      setErrorMsg(getErrorMessage(err, 'Ошибка Git Sync'));
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
      setStatusMsg(
        res.sent
          ? `Отправлено (${res.chat_ids.length})`
          : res.hint || 'Превью сформировано'
      );
      await fetchIntegrations();
    } catch (err: unknown) {
      setErrorMsg(getErrorMessage(err, 'Ошибка отправки'));
    } finally {
      setSendingTelegram(false);
    }
  };

  const copyAllNewLinks = () => {
    const lines = newlyCreated
      .map(
        (c) =>
          `${c.username} [${c.role.toUpperCase()} | /verify ${c.verification_code || '—'}]: ${api.buildInviteUrl(c.token)}`
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
      title={locale === 'en' ? 'Access & Integrations' : 'Доступ и интеграции'}
      icon={
        <div className="w-7 h-7 rounded-md bg-[var(--bg-elevated)] border border-[var(--border-subtle)] flex items-center justify-center text-[var(--text-primary)]">
          <Users className="w-3.5 h-3.5" />
        </div>
      }
      badge={<span className="text-xs text-[var(--text-muted)] font-mono">{canvasName}</span>}
      maxWidth="max-w-4xl"
      footer={
        <div className="w-full flex items-center justify-between text-[11px] text-[var(--text-muted)] font-mono">
          <div className="flex items-center gap-2">
            <span className="text-[var(--text-primary)] uppercase font-semibold">{userRole}</span>
            <span>·</span>
            <span className="text-[var(--text-secondary)]">{api.getClientId()}</span>
          </div>
          <button
            onClick={onClose}
            className={`px-3.5 py-1 text-xs font-sans ${ghostBtnClass}`}
          >
            {locale === 'en' ? 'Close' : 'Закрыть'}
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        {/* Top bar: Monochrome Tabs + compact stats */}
        <div className="flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] pb-2.5">
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setActiveTab('links')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer border ${
                activeTab === 'links'
                  ? 'bg-[var(--text-primary)] text-[var(--bg-main)] border-[var(--text-primary)]'
                  : 'bg-[var(--bg-elevated)]/40 text-[var(--text-secondary)] hover:text-[var(--text-primary)] border-[var(--border-subtle)] hover:border-[var(--border-hover)]'
              }`}
            >
              <KeyRound className="w-3.5 h-3.5" />
              <span>Участники ({users.length})</span>
            </button>
            <button
              onClick={() => setActiveTab('integrations')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer border ${
                activeTab === 'integrations'
                  ? 'bg-[var(--text-primary)] text-[var(--bg-main)] border-[var(--text-primary)]'
                  : 'bg-[var(--bg-elevated)]/40 text-[var(--text-secondary)] hover:text-[var(--text-primary)] border-[var(--border-subtle)] hover:border-[var(--border-hover)]'
              }`}
            >
              <GitBranch className="w-3.5 h-3.5" />
              <span>Telegram · Git · БД</span>
            </button>
          </div>

          <div className="flex items-center gap-1.5 text-[11px] font-mono shrink-0">
            <span className="px-2 py-0.5 rounded-md bg-[var(--bg-elevated)] text-[var(--text-secondary)] border border-[var(--border-subtle)]">
              Онлайн: <strong className="text-[var(--text-primary)]">{boundCount}</strong>
            </span>
            {restrictedCount > 0 && (
              <span className="px-2 py-0.5 rounded-md bg-[var(--bg-elevated)] text-[var(--text-secondary)] border border-[var(--border-subtle)]">
                Блок: <strong className="text-[var(--text-primary)]">{restrictedCount}</strong>
              </span>
            )}
            <button
              onClick={fetchUsers}
              className={`p-1.5 ${ghostBtnClass}`}
              title="Обновить"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingUsers ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {errorMsg && (
          <div className="px-3 py-2 rounded-md bg-[var(--bg-elevated)] border border-[var(--border-hover)] text-xs text-[var(--text-primary)] flex items-center gap-2">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 text-rose-400" />
            <span className="truncate">{errorMsg}</span>
          </div>
        )}

        {statusMsg && (
          <div className="px-3 py-2 rounded-md bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] flex items-center gap-2">
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-400" />
            <span className="truncate">{statusMsg}</span>
          </div>
        )}

        {activeTab === 'links' ? (
          <div className="space-y-3">
            {/* Compact Generator Bar — Monochrome */}
            <div className="p-2.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/40 space-y-2.5">
              <div className="grid grid-cols-2 sm:grid-cols-[1fr_110px_140px_110px_68px_auto] gap-2 items-center">
                <input
                  type="text"
                  value={prefix}
                  onChange={(e) => setPrefix(e.target.value)}
                  placeholder="Имя / префикс"
                  className={`w-full min-w-0 px-2.5 h-8 ${ctrlClass}`}
                />

                <select
                  value={targetRole}
                  onChange={(e) => setTargetRole(e.target.value as 'viewer' | 'operator' | 'admin')}
                  className={`w-full min-w-0 px-2 h-8 cursor-pointer ${ctrlClass}`}
                >
                  <option value="viewer">VIEWER</option>
                  <option value="operator">OPERATOR</option>
                  <option value="admin">ADMIN</option>
                </select>

                <select
                  value={targetSystem}
                  onChange={(e) => setTargetSystem(e.target.value)}
                  className={`w-full min-w-0 px-2 h-8 cursor-pointer ${ctrlClass}`}
                >
                  {SYSTEM_TARGETS.map((sys) => (
                    <option key={sys.value} value={sys.value}>
                      {sys.label}
                    </option>
                  ))}
                </select>

                <select
                  value={targetTtlMinutes}
                  onChange={(e) => setTargetTtlMinutes(Number(e.target.value))}
                  className={`w-full min-w-0 px-2 h-8 cursor-pointer ${ctrlClass}`}
                >
                  {TTL_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>

                <select
                  value={batchCount}
                  onChange={(e) => setBatchCount(Number(e.target.value))}
                  className={`w-full min-w-0 px-2 h-8 cursor-pointer ${ctrlClass}`}
                >
                  <option value={1}>×1</option>
                  <option value={3}>×3</option>
                  <option value={5}>×5</option>
                  <option value={10}>×10</option>
                </select>

                <button
                  onClick={handleBatchGenerate}
                  className={`h-8 px-3 text-xs flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 ${primaryBtnClass}`}
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Создать</span>
                </button>
              </div>

              {newlyCreated.length > 0 && (
                <div className="p-2.5 rounded-md bg-[var(--bg-main)] border border-[var(--border-subtle)] space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-mono text-[var(--text-secondary)]">
                      Новые ({newlyCreated.length})
                    </span>
                    <button
                      onClick={copyAllNewLinks}
                      className={`px-2 py-0.5 text-[11px] flex items-center gap-1 ${ghostBtnClass}`}
                    >
                      {copiedKey === 'all-new' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      <span>{copiedKey === 'all-new' ? 'Скопировано' : 'Копировать все'}</span>
                    </button>
                  </div>
                  <div className="space-y-1 max-h-28 overflow-y-auto">
                    {newlyCreated.map((item) => {
                      const url = api.buildInviteUrl(item.token);
                      const cKey = `new-${item.username}`;
                      return (
                        <div key={item.username} className="flex items-center gap-1.5 text-xs font-mono">
                          <span className="text-[var(--text-primary)] w-24 truncate shrink-0">{item.username}</span>
                          {item.verification_code && (
                            <button
                              onClick={() => handleCopy(`new-vc-${item.username}`, `/verify ${item.verification_code}`)}
                              className={`text-[10px] px-1.5 py-0.5 shrink-0 ${ghostBtnClass}`}
                            >
                              /verify {item.verification_code}
                            </button>
                          )}
                          <input
                            readOnly
                            value={url}
                            className={`flex-1 min-w-0 px-2 py-0.5 text-[11px] select-all ${ctrlClass}`}
                          />
                          <button
                            onClick={() => handleCopy(cKey, url)}
                            className={`px-2 py-0.5 text-[11px] shrink-0 flex items-center gap-1 ${ghostBtnClass}`}
                          >
                            {copiedKey === cKey ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Users Table — rigid 2-line rows, pure monochrome */}
            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] overflow-hidden">
              {users.length === 0 ? (
                <div className="p-6 text-center text-xs text-[var(--text-muted)] font-mono">
                  Список пуст
                </div>
              ) : (
                <div className="divide-y divide-[var(--border-subtle)] max-h-[360px] overflow-y-auto">
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
                        className={`px-3 py-2.5 space-y-1.5 transition-colors ${
                          !isActive || expiryInfo.expired
                            ? 'opacity-60 bg-[var(--bg-subtle)]'
                            : 'hover:bg-[var(--bg-subtle)]'
                        }`}
                      >
                        {/* Row Line 1: Fixed-width Left Controls + Right Action Bar */}
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 shrink-0">
                            <span
                              className={`w-2 h-2 rounded-full shrink-0 ${
                                isActive && !expiryInfo.expired ? 'bg-emerald-400' : 'bg-rose-400'
                              }`}
                              title={
                                isActive && !expiryInfo.expired
                                  ? 'Активен'
                                  : expiryInfo.expired
                                    ? 'Истёк'
                                    : 'Ограничен'
                              }
                            />
                            <span
                              className="text-xs font-mono font-semibold text-[var(--text-primary)] truncate w-24 shrink-0"
                              title={`#${u.id ?? '—'} ${u.username}`}
                            >
                              {u.username}
                            </span>

                            <select
                              aria-label={`Роль ${u.username}`}
                              value={u.role}
                              onChange={(e) =>
                                handleChangeUserRole(
                                  u,
                                  e.target.value as 'viewer' | 'operator' | 'admin'
                                )
                              }
                              className={`w-[82px] shrink-0 px-1.5 h-6 text-[10px] uppercase cursor-pointer ${ctrlClass}`}
                            >
                              <option value="viewer">VIEWER</option>
                              <option value="operator">OPERATOR</option>
                              <option value="admin">ADMIN</option>
                            </select>

                            <select
                              aria-label={`Система ${u.username}`}
                              value={u.allowed_system || ''}
                              onChange={(e) => handleChangeUserSystem(u, e.target.value)}
                              className={`w-[108px] shrink-0 px-1.5 h-6 text-[10px] cursor-pointer truncate ${ctrlClass}`}
                            >
                              {SYSTEM_TARGETS.map((sys) => (
                                <option key={sys.value} value={sys.value}>
                                  {sys.label}
                                </option>
                              ))}
                            </select>

                            <select
                              aria-label={`TTL ${u.username}`}
                              value=""
                              onChange={(e) => {
                                if (e.target.value !== '') {
                                  handleChangeUserTtl(u, Number(e.target.value));
                                }
                              }}
                              className={`w-[84px] shrink-0 px-1.5 h-6 text-[10px] cursor-pointer ${ctrlClass}`}
                            >
                              <option value="">
                                {expiryInfo.label}
                              </option>
                              {TTL_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          </div>

                          {/* Fixed-position Action Buttons */}
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              onClick={() => handleGenerateVerifyCode(u)}
                              className={`h-6 px-2 text-[10px] flex items-center gap-1 whitespace-nowrap ${ghostBtnClass}`}
                              title="Сгенерировать и скопировать код /verify для Telegram"
                            >
                              <Send className="w-2.5 h-2.5" />
                              <span>TG-код</span>
                            </button>

                            <button
                              onClick={() => inviteUrl && handleCopy(copyId, inviteUrl)}
                              disabled={!inviteUrl}
                              className={`h-6 w-20 justify-center text-[10px] flex items-center gap-1 whitespace-nowrap disabled:opacity-30 ${ghostBtnClass}`}
                              title="Скопировать ссылку"
                            >
                              {copiedKey === copyId ? (
                                <Check className="w-2.5 h-2.5" />
                              ) : (
                                <Copy className="w-2.5 h-2.5" />
                              )}
                              <span>{copiedKey === copyId ? 'ОК' : 'Ссылка'}</span>
                            </button>

                            <button
                              onClick={() => handleUnbind(u)}
                              disabled={!isBound}
                              className={`h-6 px-2 text-[10px] flex items-center gap-1 whitespace-nowrap disabled:opacity-25 disabled:pointer-events-none ${ghostBtnClass}`}
                              title="Отвязать устройство"
                            >
                              <Unlock className="w-2.5 h-2.5" />
                              <span>Отвязать</span>
                            </button>

                            <button
                              onClick={() => handleToggleActive(u)}
                              className={`h-6 w-20 justify-center text-[10px] flex items-center gap-1 whitespace-nowrap ${ghostBtnClass}`}
                            >
                              {isActive ? (
                                <>
                                  <Ban className="w-2.5 h-2.5" />
                                  <span>Блок</span>
                                </>
                              ) : (
                                <>
                                  <CheckCircle2 className="w-2.5 h-2.5" />
                                  <span>Разблок</span>
                                </>
                              )}
                            </button>

                            <button
                              onClick={() => handleRotate(u)}
                              className={`h-6 w-6 flex items-center justify-center ${ghostBtnClass}`}
                              title="Перевыпустить токен"
                            >
                              <RefreshCw className="w-3 h-3" />
                            </button>

                            <button
                              onClick={() => handleDelete(u)}
                              className={`h-6 w-6 flex items-center justify-center ${ghostBtnClass}`}
                              title="Удалить"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </div>

                        {/* Row Line 2: Compact Single-Line Telemetry & Badges */}
                        <div className="flex items-center justify-between gap-2 text-[10px] font-mono text-[var(--text-muted)]">
                          <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
                            {cachedToken && (
                              <button
                                onClick={() => handleCopy(`tok-${u.username}`, cachedToken)}
                                className={`px-1.5 py-0.5 shrink-0 ${ghostBtnClass}`}
                                title={cachedToken}
                              >
                                {copiedKey === `tok-${u.username}` ? '✓ Скопирован' : shortToken(cachedToken)}
                              </button>
                            )}

                            <span className="px-1.5 py-0.5 rounded bg-[var(--bg-elevated)] text-[var(--text-secondary)] border border-[var(--border-subtle)] shrink-0">
                              {u.telegram_chat_id
                                ? `TG: ${u.telegram_username ? `@${u.telegram_username}` : u.telegram_chat_id}`
                                : 'TG: —'}
                            </span>

                            {activeVerifyCode && (
                              <button
                                onClick={() =>
                                  handleCopy(`vcode-${u.username}`, `/verify ${activeVerifyCode}`)
                                }
                                className={`px-1.5 py-0.5 shrink-0 ${ghostBtnClass}`}
                                title="Скопировать команду /verify"
                              >
                                {copiedKey === `vcode-${u.username}`
                                  ? '✓ Скопировано'
                                  : `/verify ${activeVerifyCode}`}
                              </button>
                            )}
                          </div>

                          <div className="truncate text-right shrink-0">
                            {isBound ? (
                              <span className="text-[var(--text-secondary)]">
                                <span>{u.bound_client_id}</span>
                                {' · '}
                                <span>{u.bound_ip || 'local'}</span>
                                {' · '}
                                <span>{formatShortUA(u.bound_user_agent)}</span>
                                {' · '}
                                <span className="text-[var(--text-muted)]">{formatTimestamp(u.last_seen_at || u.bound_at)}</span>
                              </span>
                            ) : (
                              <span className="text-[var(--text-muted)]">Свободна</span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ) : (
          /* TAB 2: COMPACT INTEGRATIONS — Monochrome */
          <div className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* 1. GitOps */}
              <div className="p-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/40 flex flex-col justify-between gap-2.5">
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-primary)]">
                      <GitBranch className="w-3.5 h-3.5 text-[var(--text-secondary)] shrink-0" />
                      <span>GitOps SoT</span>
                    </div>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[var(--bg-main)] text-[var(--text-secondary)] border border-[var(--border-subtle)] whitespace-nowrap shrink-0">
                      {integrations?.github_sot?.branch || 'main'} @ {integrations?.github_sot?.commit_short || 'HEAD'}
                    </span>
                  </div>

                  <div className="text-[11px] font-mono text-[var(--text-secondary)] space-y-1">
                    <div className="truncate">
                      <a
                        href={integrations?.github_sot?.github_repo_url || '#'}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[var(--text-primary)] hover:underline"
                      >
                        {integrations?.github_sot?.github_repo_url || 'Локальный репозиторий'}
                      </a>
                    </div>
                    <div className="truncate text-[var(--text-muted)]">
                      {integrations?.github_sot?.last_commit_message || '—'}
                    </div>
                  </div>
                </div>

                <button
                  onClick={handleGitSync}
                  disabled={syncingGit}
                  className={`w-full h-8 px-3 text-xs font-mono flex items-center justify-center gap-1.5 ${ghostBtnClass}`}
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${syncingGit ? 'animate-spin' : ''}`} />
                  <span>{syncingGit ? 'Синхронизация...' : 'Git Pull + Sync'}</span>
                </button>
              </div>

              {/* 2. Database */}
              <div className="p-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/40 flex flex-col justify-between gap-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-primary)]">
                    <Database className="w-3.5 h-3.5 text-[var(--text-secondary)] shrink-0" />
                    <span>База данных</span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[var(--bg-main)] text-[var(--text-secondary)] border border-[var(--border-subtle)] uppercase whitespace-nowrap shrink-0 inline-flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    <span>{integrations?.database?.engine || 'sqlite'}</span>
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 text-center font-mono">
                  <div className="p-2 rounded-md bg-[var(--bg-main)] border border-[var(--border-subtle)]">
                    <div className="text-sm font-bold text-[var(--text-primary)]">
                      {integrations?.database?.counts?.devices ?? '—'}
                    </div>
                    <div className="text-[10px] text-[var(--text-muted)]">Устройств</div>
                  </div>
                  <div className="p-2 rounded-md bg-[var(--bg-main)] border border-[var(--border-subtle)]">
                    <div className="text-sm font-bold text-[var(--text-primary)]">
                      {integrations?.database?.counts?.users ?? '—'} / {integrations?.database?.counts?.bound_sessions ?? 0}
                    </div>
                    <div className="text-[10px] text-[var(--text-muted)]">Сессий</div>
                  </div>
                  <div className="p-2 rounded-md bg-[var(--bg-main)] border border-[var(--border-subtle)]">
                    <div className="text-sm font-bold text-[var(--text-primary)]">
                      {integrations?.database?.counts?.jobs ?? '—'}
                    </div>
                    <div className="text-[10px] text-[var(--text-muted)]">Задач</div>
                  </div>
                </div>

                <div className="text-[10px] font-mono text-[var(--text-muted)] flex items-center justify-between">
                  <span>access_registry.json</span>
                  <span>{integrations?.prometheus?.scrape_endpoint || '/metrics'}</span>
                </div>
              </div>
            </div>

            {/* 3. Telegram Bot */}
            <div className="p-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/40 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-primary)]">
                  <Send className="w-3.5 h-3.5 text-[var(--text-secondary)] shrink-0" />
                  <a
                    href="https://t.me/Croc_Dream_bot"
                    target="_blank"
                    rel="noreferrer"
                    className="hover:underline font-mono"
                  >
                    @Croc_Dream_bot
                  </a>
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[var(--bg-main)] text-[var(--text-secondary)] border border-[var(--border-subtle)] whitespace-nowrap shrink-0 inline-flex items-center gap-1.5">
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      integrations?.telegram?.bot_token_set ? 'bg-emerald-400' : 'bg-amber-400'
                    }`}
                  />
                  <span>
                    {integrations?.telegram?.bot_token_set
                      ? `Чатов: ${integrations.telegram.chat_ids.length}`
                      : 'Токен не задан'}
                  </span>
                </span>
              </div>

              <div className="flex items-center gap-1.5 flex-wrap text-[10px] font-mono">
                {['/verify <код>', '/users', '/ttl', '/block', '/unblock', '/unbind', '/role', '/security'].map((cmd) => (
                  <span
                    key={cmd}
                    className="px-1.5 py-0.5 rounded bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-secondary)]"
                  >
                    {cmd}
                  </span>
                ))}
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  value={telegramNote}
                  onChange={(e) => setTelegramNote(e.target.value)}
                  placeholder="Комментарий к сводке..."
                  className={`flex-1 min-w-0 px-3 h-8 ${ctrlClass}`}
                />
                <button
                  onClick={handleSendTelegram}
                  disabled={sendingTelegram || loadingIntegrations}
                  className={`h-8 px-3 text-xs flex items-center justify-center gap-1.5 shrink-0 whitespace-nowrap ${primaryBtnClass}`}
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{sendingTelegram ? 'Отправка...' : 'Отправить'}</span>
                </button>
              </div>

              {telegramPreview && (
                <div className="p-2.5 rounded-md bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[11px] font-mono text-[var(--text-secondary)] whitespace-pre-wrap leading-relaxed max-h-32 overflow-y-auto">
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
