import React, { useState } from 'react';
import { Copy, Check, Users, Shield } from 'lucide-react';
import { api } from '../api';
import type { UserRole } from '../api';
import type { Locale } from '../i18n';
import { Modal } from './ui';

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  userRole: UserRole;
  locale?: Locale;
}

export const ShareModal: React.FC<ShareModalProps> = ({
  isOpen,
  onClose,
  userRole,
  locale = 'ru',
}) => {
  const [copiedType, setCopiedType] = useState<'jury' | 'admin' | null>(null);

  if (!isOpen) return null;

  const juryUrl = api.getShareUrl('viewer');
  const adminUrl = api.getShareUrl('admin');
  const canvasName = api.getCanvasName();

  const handleCopy = (type: 'jury' | 'admin', url: string) => {
    navigator.clipboard.writeText(url);
    setCopiedType(type);
    setTimeout(() => setCopiedType(null), 2500);
  };

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title={locale === 'en' ? 'Share Canvas & Access Tokens' : 'Поделиться доступом к холсту'}
      icon={
        <div className="w-8 h-8 rounded-lg bg-white/[0.05] border border-white/[0.1] flex items-center justify-center text-zinc-300">
          <Users className="w-4 h-4 text-zinc-200" />
        </div>
      }
      badge={<span className="text-xs text-zinc-400 font-mono ml-1">{canvasName}</span>}
      maxWidth="max-w-lg"
      footer={
        <div className="w-full flex items-center justify-between text-[11px] text-zinc-500">
          <span>
            {locale === 'en' ? 'Your current role' : 'Ваша текущая роль'}:{' '}
            <strong className="text-zinc-300 uppercase">{userRole}</strong>
          </span>
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
        {/* Matryoshka RBAC explanation */}
        <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/[0.06] text-xs space-y-1.5 leading-relaxed text-zinc-400">
          <div className="flex items-center gap-2 text-zinc-200 font-medium">
            <Shield className="w-3.5 h-3.5 text-emerald-400" />
            <span>{locale === 'en' ? 'Crash-Proof Demo Mode' : 'Безопасный режим презентации (Защита от сбоев)'}</span>
          </div>
          <p>
            {locale === 'en'
              ? 'When sharing with jury or audience members, viewers get instant Read-Only access. All mutation actions (Deploy, Remediate, Delete) are safely locked, protecting the live Containerlab testbed from interference.'
              : 'При передаче ссылки жюри или зрителям в зале они получают мгновенный доступ в режиме Наблюдателя. Все кнопки изменений (Деплой, Удаление, Сброс) защитно заблокированы, что исключает сбои стенда во время выступления.'}
          </p>
        </div>

        {/* Links section */}
        <div className="space-y-3">
          {/* 1. Jury Link */}
          <div className="p-3.5 rounded-xl border border-white/[0.08] bg-white/[0.02] space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                <span className="text-xs font-semibold text-white">
                  {locale === 'en' ? 'Jury & Audience Link (Read-Only)' : 'Ссылка для жюри и зрителей (Только чтение)'}
                </span>
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                Viewer Role
              </span>
            </div>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={juryUrl}
                className="w-full bg-[#08090d] border border-white/[0.08] rounded-lg px-3 py-1.5 text-xs font-mono text-zinc-300 select-all focus:outline-none"
              />
              <button
                onClick={() => handleCopy('jury', juryUrl)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all shrink-0 cursor-pointer ${
                  copiedType === 'jury'
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                    : 'bg-white/[0.08] hover:bg-white/[0.14] text-white border border-white/[0.1]'
                }`}
              >
                {copiedType === 'jury' ? (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>Скопировано</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Копировать</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* 2. Admin Link (only for Owner) */}
          {userRole === 'owner' && (
            <div className="p-3.5 rounded-xl border border-white/[0.08] bg-white/[0.02] space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-amber-400" />
                  <span className="text-xs font-semibold text-white">
                    {locale === 'en' ? 'Team Member Link (Admin Operations)' : 'Ссылка для инженера команды (Оператор / Админ)'}
                  </span>
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20">
                  Admin Role
                </span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={adminUrl}
                  className="w-full bg-[#08090d] border border-white/[0.08] rounded-lg px-3 py-1.5 text-xs font-mono text-zinc-300 select-all focus:outline-none"
                />
                <button
                  onClick={() => handleCopy('admin', adminUrl)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all shrink-0 cursor-pointer ${
                    copiedType === 'admin'
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                      : 'bg-white/[0.08] hover:bg-white/[0.14] text-white border border-white/[0.1]'
                  }`}
                >
                  {copiedType === 'admin' ? (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>Скопировано</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Копировать</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
};
