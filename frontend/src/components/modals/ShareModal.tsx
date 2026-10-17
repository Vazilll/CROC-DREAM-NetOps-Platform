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
  Send,
  KeyRound,
  CheckCircle2,
  AlertCircle,
  Ban,
} from 'lucide-react';
import { api, getErrorMessage } from '../../api';
import type {
  BootstrapExposureInfo,
  UserRole,
  UserAccount,
  UserInviteCreated,
  IntegrationsStatus,
} from '../../api';
import type { Locale } from '../../i18n';
import { Modal } from '../layout/ui';
import { PublicConsolesBanner } from './share/PublicConsolesBanner';
import { ShareIntegrationsTab } from './share/ShareIntegrationsTab';

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  userRole: UserRole;
  locale?: Locale;
}

const MINTED_STORAGE_KEY = 'netops_minted_tokens_v1';

const TTL_OPTIONS = [
  { value: 0, label: 'Навсегда' },
  { value: 60, label: '1 час' },
  { value: 1440, label: '24 часа' },
  { value: 10080, label: '7 дней' },
];

function formatExpiry(expiresAt: string | null | undefined): { label: string; expired: boolean } {
  if (!expiresAt) return { label: 'Навсегда', expired: false };
  const diffMs = new Date(expiresAt).getTime() - Date.now();
  if (Number.isNaN(diffMs)) return { label: 'Навсегда', expired: false };
  if (diffMs <= 0) return { label: 'Истёк', expired: true };
  const mins = Math.ceil(diffMs / 60000);
  if (mins < 60) return { label: `${mins}м`, expired: false };
  const hours = Math.floor(mins / 60);
  return hours < 48
    ? { label: `${hours}ч`, expired: false }
    : { label: `${Math.ceil(hours / 24)}д`, expired: false };
}

function loadMintedTokens(): Record<string, string> {
  try {
    localStorage.removeItem(MINTED_STORAGE_KEY);
  } catch {
    // ignore
  }
  return {};
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
  const [loading, setLoading] = useState(false);
  const [prefix, setPrefix] = useState('jury');
  const [targetRole, setTargetRole] = useState<'viewer' | 'operator' | 'admin'>('viewer');
  const [targetSystem, setTargetSystem] = useState('');
  const [targetTtlMinutes, setTargetTtlMinutes] = useState(0);
  const [batchCount, setBatchCount] = useState(1);
  const [mintedTokens, setMintedTokens] = useState<Record<string, string>>(loadMintedTokens);
  const [newlyCreated, setNewlyCreated] = useState<UserInviteCreated[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [integrations, setIntegrations] = useState<IntegrationsStatus | null>(null);
  const [exposureInfo, setExposureInfo] = useState<BootstrapExposureInfo | null>(null);
  const [deviceTargets, setDeviceTargets] = useState<Array<{ value: string; label: string }>>([]);
  const [syncingGit, setSyncingGit] = useState(false);
  const [telegramNote, setTelegramNote] = useState('');
  const [sendingTelegram, setSendingTelegram] = useState(false);
  const [telegramPreview, setTelegramPreview] = useState<string | null>(null);

  const refreshAll = useCallback(async (showSpinner = false) => {
    if (showSpinner) setLoading(true);
    try {
      const [integData, devList, bootStatus] = await Promise.all([
        api.getIntegrationsStatus(),
        api.getDevices().catch(() => []),
        api.getBootstrapStatus().catch(() => null),
      ]);
      const userList = await api.getUsers().catch(() => integData.sessions || []);
      setUsers(userList);
      setIntegrations(integData);
      if (bootStatus?.exposure) {
        setExposureInfo(bootStatus.exposure);
      }
      const fabrics = Array.from(
        new Set(devList.map((d) => d.fabric_id).filter((f): f is string => Boolean(f)))
      );
      setDeviceTargets([
        ...fabrics.map((f) => ({ value: `fabric:${f}`, label: `Фабрика: ${f}` })),
        ...devList.map((d) => ({ value: d.hostname, label: d.hostname })),
      ]);
      if (integData.user_tokens) {
        setMintedTokens((prev) => ({ ...prev, ...integData.user_tokens }));
      }
    } catch (err: unknown) {
      setErrorMsg(getErrorMessage(err, 'Ошибка загрузки'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const t0 = setTimeout(() => void refreshAll(false), 0);
    const timer = setInterval(() => {
      if (document.visibilityState !== 'hidden') void refreshAll(false);
    }, 8000);
    return () => {
      clearTimeout(t0);
      clearInterval(timer);
    };
  }, [isOpen, refreshAll]);

  if (!isOpen) return null;

  const systemTargets = [{ value: '', label: 'Вся фабрика' }, ...deviceTargets];
  const publicConsoles = api.getPublicConsoles(exposureInfo);

  const handleCopy = (key: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleBatchGenerate = async () => {
    setErrorMsg(null);
    setStatusMsg(null);
    const cleanPrefix = prefix.trim() || 'jury';
    const sysScope = targetSystem.trim() || null;
    const ttlArg = targetTtlMinutes > 0 ? targetTtlMinutes : null;
    try {
      const created =
        batchCount === 1
          ? [
              await api.createUserInvite(
                `${cleanPrefix}-${Math.floor(100 + Math.random() * 900)}`,
                targetRole,
                sysScope,
                ttlArg
              ),
            ]
          : await api.createBatchInvites(cleanPrefix, targetRole, batchCount, sysScope, ttlArg);

      const updatedMap = { ...mintedTokens };
      for (const item of created) updatedMap[item.username] = item.token;
      setMintedTokens(updatedMap);
      setNewlyCreated(created);
      setStatusMsg(`Создано: ${created.length}`);
      await refreshAll();
    } catch (err: unknown) {
      setErrorMsg(getErrorMessage(err, 'Ошибка создания'));
    }
  };

  const runUserAction = async (fn: () => Promise<void>) => {
    setErrorMsg(null);
    try {
      await fn();
      await refreshAll();
    } catch (err: unknown) {
      setErrorMsg(getErrorMessage(err));
    }
  };

  const handleGenerateVerifyCode = async (u: UserAccount) => {
    if (u.id === null) return;
    await runUserAction(async () => {
      const res = await api.generateUserVerifyCode(u.id!);
      const code = res.verification_code || '';
      handleCopy(`vcode-${u.username}`, code);
      setStatusMsg(`${u.username}: выдан 6-значный код входа ${code}`);
    });
  };

  const handleRotate = async (u: UserAccount) => {
    if (u.id === null) return;
    await runUserAction(async () => {
      const rotated = await api.rotateUserToken(u.id!);
      const updatedMap = { ...mintedTokens, [rotated.username]: rotated.token };
      setMintedTokens(updatedMap);
      setNewlyCreated([rotated]);
      setStatusMsg(`Токен ${rotated.username} обновлён`);
    });
  };

  const handleGitSync = async () => {
    setSyncingGit(true);
    setErrorMsg(null);
    try {
      const res = await api.syncGitSot();
      setStatusMsg(`Git Sync: +${res.sync.created.length} / ~${res.sync.updated.length}`);
      await refreshAll();
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
      setStatusMsg(res.sent ? `Отправлено (${res.chat_ids.length})` : res.hint || 'Превью сформировано');
      await refreshAll();
    } catch (err: unknown) {
      setErrorMsg(getErrorMessage(err, 'Ошибка отправки'));
    } finally {
      setSendingTelegram(false);
    }
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
      badge={<span className="text-xs text-[var(--text-muted)] font-mono">{api.getCanvasName()}</span>}
      maxWidth="max-w-4xl"
      footer={
        <div className="w-full flex items-center justify-between text-[11px] text-[var(--text-muted)] font-mono">
          <div className="flex items-center gap-2">
            <span className="text-[var(--text-primary)] uppercase font-semibold">{userRole}</span>
            <span>·</span>
            <span className="text-[var(--text-secondary)]">{api.getClientId()}</span>
          </div>
          <button onClick={onClose} className={`px-3.5 py-1 text-xs font-sans ${ghostBtnClass}`}>
            {locale === 'en' ? 'Close' : 'Закрыть'}
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] pb-2.5">
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setActiveTab('links')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer border ${
                activeTab === 'links'
                  ? 'bg-[var(--text-primary)] text-[var(--bg-main)] border-[var(--text-primary)]'
                  : 'bg-[var(--bg-elevated)]/40 text-[var(--text-secondary)] hover:text-[var(--text-primary)] border-[var(--border-subtle)]'
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
                  : 'bg-[var(--bg-elevated)]/40 text-[var(--text-secondary)] hover:text-[var(--text-primary)] border-[var(--border-subtle)]'
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
            <button onClick={() => void refreshAll()} className={`p-1.5 ${ghostBtnClass}`} title="Обновить">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
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
            <PublicConsolesBanner
              consoles={publicConsoles}
              copiedKey={copiedKey}
              onCopy={handleCopy}
              ghostBtnClass={ghostBtnClass}
            />

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
                  {systemTargets.map((sys) => (
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
                <div className="p-2 rounded-md bg-[var(--bg-main)] border border-[var(--border-subtle)] space-y-1 max-h-28 overflow-y-auto">
                  {newlyCreated.map((item) => {
                    const url = api.buildInviteUrl(item.token, exposureInfo?.public_url || undefined);
                    return (
                      <div key={item.username} className="flex items-center gap-1.5 text-xs font-mono">
                        <span className="text-[var(--text-primary)] w-24 truncate shrink-0">{item.username}</span>
                        {item.verification_code && (
                          <button
                            onClick={() => handleCopy(`new-code-${item.username}`, item.verification_code!)}
                            className={`px-2 py-0.5 text-[11px] shrink-0 text-emerald-400 ${ghostBtnClass}`}
                            title="Скопировать 6-значный код доступа"
                          >
                            {copiedKey === `new-code-${item.username}` ? 'ОК' : `Код: ${item.verification_code}`}
                          </button>
                        )}
                        <input readOnly value={url} className={`flex-1 min-w-0 px-2 py-0.5 text-[11px] ${ctrlClass}`} />
                        <button
                          onClick={() => handleCopy(`new-${item.username}`, url)}
                          className={`px-2 py-0.5 text-[11px] shrink-0 ${ghostBtnClass}`}
                        >
                          {copiedKey === `new-${item.username}` ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] overflow-hidden">
              {users.length === 0 ? (
                <div className="p-6 text-center text-xs text-[var(--text-muted)] font-mono">Список пуст</div>
              ) : (
                <div className="divide-y divide-[var(--border-subtle)] max-h-[300px] overflow-y-auto">
                  {users.map((u) => {
                    const cachedToken = mintedTokens[u.username] || u.verification_code || null;
                    const inviteUrl = cachedToken
                      ? api.buildInviteUrl(cachedToken, exposureInfo?.public_url || undefined)
                      : null;
                    const isBound = Boolean(u.bound_client_id);
                    const isActive = u.is_active !== false;
                    const copyId = `row-${u.username}`;
                    const expiryInfo = formatExpiry(u.expires_at);

                    return (
                      <div
                        key={u.id ?? u.username}
                        className={`px-3 py-2 space-y-1 transition-colors ${
                          !isActive || expiryInfo.expired ? 'opacity-60 bg-[var(--bg-subtle)]' : 'hover:bg-[var(--bg-subtle)]'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 shrink-0">
                            <span
                              className={`w-2 h-2 rounded-full shrink-0 ${
                                isActive && !expiryInfo.expired ? 'bg-emerald-400' : 'bg-rose-400'
                              }`}
                            />
                            <span className="text-xs font-mono font-semibold text-[var(--text-primary)] truncate w-24 shrink-0">
                              {u.username}
                            </span>

                            <select
                              aria-label={`Роль ${u.username}`}
                              value={u.role}
                              disabled={String(u.role) === 'owner' || u.username === 'owner'}
                              onChange={(e) =>
                                u.id !== null &&
                                void runUserAction(() =>
                                  api.updateUserInvite(u.id!, {
                                    role: e.target.value as 'viewer' | 'operator' | 'admin',
                                  }).then(() => undefined)
                                )
                              }
                              className={`w-[82px] shrink-0 px-1.5 h-6 text-[10px] uppercase cursor-pointer ${ctrlClass}`}
                            >
                              {(String(u.role) === 'owner' || u.username === 'owner') && (
                                <option value="owner">OWNER</option>
                              )}
                              <option value="viewer">VIEWER</option>
                              <option value="operator">OPERATOR</option>
                              <option value="admin">ADMIN</option>
                            </select>

                            <select
                              aria-label={`Система ${u.username}`}
                              value={u.allowed_system || ''}
                              onChange={(e) =>
                                u.id !== null &&
                                void runUserAction(() =>
                                  api.updateUserInvite(u.id!, {
                                    allowed_system: e.target.value.trim() || null,
                                  }).then(() => undefined)
                                )
                              }
                              className={`w-[108px] shrink-0 px-1.5 h-6 text-[10px] cursor-pointer truncate ${ctrlClass}`}
                            >
                              {systemTargets.map((sys) => (
                                <option key={sys.value} value={sys.value}>
                                  {sys.label}
                                </option>
                              ))}
                            </select>

                            <select
                              aria-label={`TTL ${u.username}`}
                              value=""
                              onChange={(e) =>
                                u.id !== null &&
                                e.target.value !== '' &&
                                void runUserAction(() =>
                                  api.updateUserInvite(u.id!, {
                                    expires_in_minutes: Number(e.target.value),
                                  }).then(() => undefined)
                                )
                              }
                              className={`w-[84px] shrink-0 px-1.5 h-6 text-[10px] cursor-pointer ${ctrlClass}`}
                            >
                              <option value="">{expiryInfo.label}</option>
                              {TTL_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              onClick={() => void handleGenerateVerifyCode(u)}
                              className={`h-6 px-2 text-[10px] flex items-center gap-1 ${ghostBtnClass}`}
                              title="Код верификации для Telegram"
                            >
                              <Send className="w-2.5 h-2.5" />
                              <span>TG-код</span>
                            </button>

                            <button
                              onClick={() => inviteUrl && handleCopy(copyId, inviteUrl)}
                              disabled={!inviteUrl}
                              className={`h-6 w-20 justify-center text-[10px] flex items-center gap-1 disabled:opacity-30 ${ghostBtnClass}`}
                            >
                              {copiedKey === copyId ? <Check className="w-2.5 h-2.5" /> : <Copy className="w-2.5 h-2.5" />}
                              <span>{copiedKey === copyId ? 'ОК' : 'Ссылка'}</span>
                            </button>

                            <button
                              onClick={() => u.id !== null && void runUserAction(() => api.unbindUserDevice(u.id!).then(() => undefined))}
                              disabled={!isBound}
                              className={`h-6 px-2 text-[10px] flex items-center gap-1 disabled:opacity-25 ${ghostBtnClass}`}
                            >
                              <Unlock className="w-2.5 h-2.5" />
                              <span>Отвязать</span>
                            </button>

                            <button
                              onClick={() =>
                                u.id !== null &&
                                void runUserAction(() =>
                                  api.updateUserInvite(u.id!, { is_active: u.is_active === false }).then(() => undefined)
                                )
                              }
                              className={`h-6 w-20 justify-center text-[10px] flex items-center gap-1 ${ghostBtnClass}`}
                            >
                              {isActive ? <Ban className="w-2.5 h-2.5" /> : <CheckCircle2 className="w-2.5 h-2.5" />}
                              <span>{isActive ? 'Блок' : 'Разблок'}</span>
                            </button>

                            <button
                              onClick={() => void handleRotate(u)}
                              className={`h-6 w-6 flex items-center justify-center ${ghostBtnClass}`}
                              title="Перевыпустить токен"
                            >
                              <RefreshCw className="w-3 h-3" />
                            </button>

                            <button
                              onClick={() => u.id !== null && void runUserAction(() => api.deleteUserInvite(u.id!).then(() => undefined))}
                              className={`h-6 w-6 flex items-center justify-center ${ghostBtnClass}`}
                              title="Удалить"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </div>

                        <div className="flex items-center justify-between gap-2 text-[10px] font-mono text-[var(--text-muted)]">
                          <div className="flex items-center gap-1.5">
                            <span className="px-1.5 py-0.5 rounded bg-[var(--bg-elevated)] text-[var(--text-secondary)] border border-[var(--border-subtle)]">
                              {u.telegram_chat_id
                                ? `TG: ${u.telegram_username ? `@${u.telegram_username}` : u.telegram_chat_id}`
                                : 'TG: —'}
                            </span>
                            {u.verification_code && (
                              <>
                                <button
                                  onClick={() => handleCopy(`rawcode-${u.username}`, u.verification_code!)}
                                  className={`px-1.5 py-0.5 text-emerald-400 ${ghostBtnClass}`}
                                  title="Скопировать 6-значный код для входа через браузер"
                                >
                                  {copiedKey === `rawcode-${u.username}` ? 'ОК' : `Код: ${u.verification_code}`}
                                </button>
                                <button
                                  onClick={() => handleCopy(`vcode-${u.username}`, `/verify ${u.verification_code}`)}
                                  className={`px-1.5 py-0.5 ${ghostBtnClass}`}
                                  title="Скопировать команду для Telegram-бота"
                                >
                                  /verify {u.verification_code}
                                </button>
                              </>
                            )}
                          </div>
                          <div className="truncate text-right">
                            {isBound ? `${u.bound_client_id} · ${u.bound_ip || 'local'}` : 'Свободна'}
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
          <ShareIntegrationsTab
            integrations={integrations}
            syncingGit={syncingGit}
            onGitSync={handleGitSync}
            telegramNote={telegramNote}
            setTelegramNote={setTelegramNote}
            sendingTelegram={sendingTelegram}
            onSendTelegram={handleSendTelegram}
            telegramPreview={telegramPreview}
            ctrlClass={ctrlClass}
            ghostBtnClass={ghostBtnClass}
            primaryBtnClass={primaryBtnClass}
          />
        )}
      </div>
    </Modal>
  );
};
