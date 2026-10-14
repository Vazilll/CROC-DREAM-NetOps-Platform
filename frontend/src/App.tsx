import { Suspense, lazy, useEffect, useMemo, useState, useCallback } from 'react';
import { api, getErrorMessage } from './api';
import type { Device, JobSummary, UserRole } from './api';
import { Header } from './components/layout/Header';
import type { AppTheme } from './components/layout/Header';
import { Sidebar } from './components/layout/Sidebar';
import { Dashboard } from './components/views/Dashboard';
import { CommandPalette } from './components/layout/CommandPalette';
import { MobileNav } from './components/layout/MobileNav';
import { translations } from './i18n';
import type { Locale } from './i18n';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

// Lazy-loaded secondary views and overlays to isolate heavy dependencies and code-split bundles
const DevicePage = lazy(() => import('./components/views/DevicePage').then((m) => ({ default: m.DevicePage })));
const DeviceList = lazy(() => import('./components/views/DeviceList').then((m) => ({ default: m.DeviceList })));
const JobsView = lazy(() => import('./components/views/JobsView').then((m) => ({ default: m.JobsView })));
const DiffViewer = lazy(() => import('./components/views/DiffViewer').then((m) => ({ default: m.DiffViewer })));
const DriftView = lazy(() => import('./components/views/DriftView').then((m) => ({ default: m.DriftView })));
const ChaosLabView = lazy(() => import('./components/views/ChaosLabView').then((m) => ({ default: m.ChaosLabView })));
const EmergencyHub = lazy(() => import('./components/views/EmergencyHub').then((m) => ({ default: m.EmergencyHub })));
const SlidesPresentation = lazy(() => import('./components/views/SlidesPresentation').then((m) => ({ default: m.SlidesPresentation })));
const CopilotPanel = lazy(() => import('./components/modals/CopilotPanel').then((m) => ({ default: m.CopilotPanel })));
const DryRunModal = lazy(() => import('./components/modals/DryRunModal').then((m) => ({ default: m.DryRunModal })));
const WelcomeModal = lazy(() => import('./components/modals/WelcomeModal').then((m) => ({ default: m.WelcomeModal })));
const ShareModal = lazy(() => import('./components/modals/ShareModal').then((m) => ({ default: m.ShareModal })));
const ShortcutsModal = lazy(() => import('./components/modals/ShortcutsModal').then((m) => ({ default: m.ShortcutsModal })));

function LoadingFallback() {
  return (
    <div className="flex items-center justify-center p-16 text-zinc-500 font-mono text-xs">
      <div className="w-5 h-5 rounded-full border-2 border-cyan-500/20 border-t-cyan-400 animate-spin mr-3" />
      <span>Загрузка модуля...</span>
    </div>
  );
}

function areDevicesEqual(a: Device[], b: Device[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const da = a[i];
    const db = b[i];
    if (
      da.id !== db.id ||
      da.hostname !== db.hostname ||
      da.status !== db.status ||
      da.oper_status !== db.oper_status ||
      da.management_mode !== db.management_mode ||
      da.platform !== db.platform ||
      da.role !== db.role ||
      da.management_ip !== db.management_ip ||
      da.last_checked_at !== db.last_checked_at ||
      da.updated_at !== db.updated_at ||
      da.sparkline?.length !== db.sparkline?.length ||
      da.sparkline?.at(-1) !== db.sparkline?.at(-1)
    ) {
      return false;
    }
  }
  return true;
}

function areJobsEqual(a: JobSummary[], b: JobSummary[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const ja = a[i];
    const jb = b[i];
    if (
      ja.id !== jb.id ||
      ja.status !== jb.status ||
      ja.progress !== jb.progress ||
      ja.started_at !== jb.started_at ||
      ja.finished_at !== jb.finished_at
    ) {
      return false;
    }
  }
  return true;
}

export function App() {
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [locale, setLocale] = useState<Locale>(() => {
    return (localStorage.getItem('netops_lang') as Locale) || 'ru';
  });
  const [theme, setTheme] = useState<AppTheme>(() => {
    const saved = localStorage.getItem('netops_theme');
    return saved === 'light' ? 'light' : 'dark';
  });
  const [userRole, setUserRole] = useState<UserRole>(() => {
    return (localStorage.getItem('netops_user_role') as UserRole) || 'owner';
  });
  const [welcomeModalOpen, setWelcomeModalOpen] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('setup') || params.get('welcome')) {
        localStorage.removeItem('netops_onboarding_done');
        return true;
      }
      if (params.get('token')) {
        return false;
      }
    }
    return !localStorage.getItem('netops_onboarding_done');
  });
  const [shareModalOpen, setShareModalOpen] = useState<boolean>(false);
  const [devices, setDevices] = useState<Device[]>([]);
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState<number | null>(null);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [copilotRequest, setCopilotRequest] = useState<{ text: string; n: number } | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [dryRunModalOpen, setDryRunModalOpen] = useState(false);
  const [dryRunTargetIds, setDryRunTargetIds] = useState<number[]>([]);
  const [shortcutsModalOpen, setShortcutsModalOpen] = useState(false);
  const [apiHealthy, setApiHealthy] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(true);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(
    null
  );

  const handleSetLocale = useCallback((newLocale: Locale) => {
    setLocale(newLocale);
    localStorage.setItem('netops_lang', newLocale);
  }, []);

  const handleSetTheme = useCallback((newTheme: AppTheme) => {
    setTheme(newTheme);
    localStorage.setItem('netops_theme', newTheme);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.className = theme === 'dark' ? 'theme-dark dark' : 'theme-light';
  }, [theme]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('token')) return;
    api
      .getBootstrapStatus()
      .then((st) => {
        if (st && st.bootstrap_completed === false) {
          localStorage.removeItem('netops_onboarding_done');
          setWelcomeModalOpen(true);
        } else if (st && st.bootstrap_completed && st.caller_is_bound_owner) {
          localStorage.setItem('netops_onboarding_done', 'true');
          setWelcomeModalOpen(false);
        }
      })
      .catch(() => {});
  }, []);

  // Global window keydown listener with priority Escape order, ?, and Ctrl+K
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInput = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        e.stopPropagation();
        setSearchOpen((o) => !o);
        return;
      }

      if (e.key === '?' && !isInput && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setShortcutsModalOpen((o) => !o);
        return;
      }

      if (e.key === 'Escape') {
        // Priority closure order:
        // 1. ShortcutsModal -> 2. DryRunModal -> 3. CommandPalette -> 4. CopilotPanel
        if (shortcutsModalOpen) {
          e.preventDefault();
          e.stopPropagation();
          setShortcutsModalOpen(false);
        } else if (dryRunModalOpen) {
          e.preventDefault();
          e.stopPropagation();
          setDryRunModalOpen(false);
        } else if (searchOpen) {
          e.preventDefault();
          e.stopPropagation();
          setSearchOpen(false);
        } else if (copilotOpen) {
          e.preventDefault();
          e.stopPropagation();
          setCopilotOpen(false);
        }
      }
    };

    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [shortcutsModalOpen, dryRunModalOpen, searchOpen, copilotOpen]);

  const openDevice = useCallback((id: number) => {
    setDeviceId(id);
    setActiveTab('device');
  }, []);

  const openDiff = useCallback((targetDeviceId?: number) => {
    if (targetDeviceId) {
      setDeviceId(targetDeviceId);
    }
    setActiveTab('diff');
  }, []);

  const handleOpenDiffJob = useCallback((jobId?: string) => {
    if (jobId) {
      setSelectedJobId(jobId);
    }
    setActiveTab('diff');
  }, []);

  const openDryRunModal = useCallback((targetIds: number[]) => {
    setDryRunTargetIds(targetIds.length > 0 ? targetIds : devices.map((d) => d.id));
    setDryRunModalOpen(true);
  }, [devices]);

  const askCopilot = useCallback((text: string) => {
    setCopilotOpen(true);
    setCopilotRequest({ text, n: Date.now() });
  }, []);

  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast(null);
    }, 4000);
  }, []);

  const fetchDevices = useCallback(async () => {
    try {
      const data = await api.getDevices();
      setDevices((prev) => (areDevicesEqual(prev, data) ? prev : data));
      setApiHealthy((prev) => (prev ? prev : true));
    } catch (err: unknown) {
      console.error('Failed to load devices', err);
      setApiHealthy(false);
    }
  }, []);

  const fetchJobs = useCallback(async () => {
    try {
      const data = await api.getJobs();
      setJobs((prev) => (areJobsEqual(prev, data) ? prev : data));
      setSelectedJobId((current) => {
        if (current && data.some((j) => j.id === current)) return current;
        const diffJob = data.find((j) => j.type === 'DRY_RUN' || j.type === 'DEPLOY');
        return diffJob?.id ?? data[0]?.id ?? null;
      });
    } catch (err: unknown) {
      console.error('Failed to load jobs', err);
    }
  }, []);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([fetchDevices(), fetchJobs()]);
    } finally {
      setLoading(false);
    }
  }, [fetchDevices, fetchJobs]);

  const hasActiveJob = useMemo(() => {
    return jobs.some((j) => j.status === 'RUNNING' || j.status === 'PENDING');
  }, [jobs]);

  // Initial load on mount (including personal token & device binding verification)
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        try {
          const me = await api.getMe();
          if (active && me.id !== null) {
            setUserRole(me.role);
            localStorage.setItem('netops_user_role', me.role);
          }
        } catch (authErr: unknown) {
          if (active) {
            showToast(getErrorMessage(authErr, 'Ошибка авторизации токена'), 'error');
            api.setRole('viewer');
            setUserRole('viewer');
          }
        }

        const [devs, jbs] = await Promise.all([api.getDevices(), api.getJobs()]);
        if (!active) return;
        setDevices((prev) => (areDevicesEqual(prev, devs) ? prev : devs));
        setJobs((prev) => (areJobsEqual(prev, jbs) ? prev : jbs));
        setSelectedJobId((current) => {
          if (current && jbs.some((j) => j.id === current)) return current;
          const diffJob = jbs.find((j) => j.type === 'DRY_RUN' || j.type === 'DEPLOY');
          return diffJob?.id ?? jbs[0]?.id ?? null;
        });
        setApiHealthy(true);
      } catch (err: unknown) {
        if (!active) return;
        console.error('Failed initial load', err);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [showToast]);

  // Periodic polling & visibility-based updates
  useEffect(() => {
    const onFocusOrVisible = () => {
      if (document.visibilityState === 'visible') {
        fetchDevices();
        fetchJobs();
      }
    };
    window.addEventListener('focus', onFocusOrVisible);
    document.addEventListener('visibilitychange', onFocusOrVisible);

    const pollMs = hasActiveJob ? 1500 : 5000;
    const interval = setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      fetchJobs();
      fetchDevices();
    }, pollMs);

    return () => {
      window.removeEventListener('focus', onFocusOrVisible);
      document.removeEventListener('visibilitychange', onFocusOrVisible);
      clearInterval(interval);
    };
  }, [hasActiveJob, fetchDevices, fetchJobs]);

  const handleExecuteDryRun = useCallback(async (deviceIds: number[]) => {
    try {
      showToast('Запуск холостого прогона (Dry-Run)...', 'info');
      const res = await api.createDryRun(deviceIds);
      setSelectedJobId(res.job_id);
      setActiveTab('jobs');
      showToast(`Задача ${res.job_id.slice(0, 8)} поставлена в очередь!`, 'success');
      await fetchJobs();
    } catch (err: unknown) {
      showToast(`Ошибка запуска Dry-Run: ${getErrorMessage(err)}`, 'error');
    }
  }, [fetchJobs, showToast]);

  const handleDeploy = useCallback(async (jobId: string) => {
    try {
      showToast('Запуск транзакционного деплоя (commit confirmed)...', 'info');
      const res = await api.createDeploy(jobId, userRole);
      setSelectedJobId(res.job_id);
      setActiveTab('jobs');
      showToast(`Деплой ${res.job_id.slice(0, 8)} запущен!`, 'success');
      await fetchJobs();
    } catch (err: unknown) {
      showToast(`Ошибка деплоя: ${getErrorMessage(err)}`, 'error');
    }
  }, [fetchJobs, showToast, userRole]);

  const handleScanDrift = useCallback(async (deviceIds?: number[]) => {
    try {
      showToast('Запуск сканирования дрейфа конфигураций...', 'info');
      const targetIds = deviceIds && deviceIds.length > 0 ? deviceIds : undefined;
      const res = await api.scanDrift(targetIds);
      setSelectedJobId(res.job_id);
      setActiveTab('jobs');
      showToast('Внеочередной скан дрейфа запущен!', 'success');
      await fetchJobs();
    } catch (err: unknown) {
      showToast(`Ошибка сканирования дрейфа: ${getErrorMessage(err)}`, 'error');
    }
  }, [fetchJobs, showToast]);

  const handleRemediate = useCallback(async (targetDeviceId: number) => {
    try {
      showToast('Запуск компенсирующего патча (Remediate)...', 'info');
      const res = await api.remediateDrift(targetDeviceId);
      setSelectedJobId(res.job_id);
      setActiveTab('jobs');
      showToast('Устранение дрейфа поставлено в очередь!', 'success');
      await fetchJobs();
    } catch (err: unknown) {
      showToast(`Ошибка устранения дрейфа: ${getErrorMessage(err)}`, 'error');
    }
  }, [fetchJobs, showToast]);

  const handleSyncInventory = useCallback(async () => {
    try {
      showToast('Синхронизация inventory.yaml из Git...', 'info');
      const res = await api.syncInventory();
      showToast(
        `Инвентарь синхронизирован! Создано: ${res.created.length}, обновлено: ${res.updated.length}`,
        'success'
      );
      await fetchDevices();
    } catch (err: unknown) {
      showToast(`Ошибка синхронизации инвентаря: ${getErrorMessage(err)}`, 'error');
    }
  }, [fetchDevices, showToast]);

  const handleLintIntent = useCallback(async () => {
    try {
      const res = await api.lintIntent();
      if (res.issues && res.issues.length > 0) {
        showToast(`Найдено ${res.issues.length} предупреждений в моделях Intent.`, 'error');
      } else {
        showToast('Pre-flight lint успешен: все модели Pydantic и связность валидны!', 'success');
      }
    } catch (err: unknown) {
      showToast(`Ошибка линтинга: ${getErrorMessage(err)}`, 'error');
    }
  }, [showToast]);

  const handleDeleteDevice = useCallback(async (id: number, returnToList = false) => {
    try {
      await api.deleteDevice(id);
      showToast(locale === 'en' ? 'Device deleted successfully' : 'Устройство успешно удалено', 'success');
      await Promise.all([fetchDevices(), fetchJobs()]);
      if (returnToList) {
        setActiveTab('devices');
      }
    } catch (err: unknown) {
      showToast(`${locale === 'en' ? 'Delete error' : 'Ошибка удаления'}: ${getErrorMessage(err)}`, 'error');
    }
  }, [fetchDevices, fetchJobs, locale, showToast]);

  const handleBackFromDevice = useCallback(() => {
    setActiveTab('devices');
    fetchDevices();
  }, [fetchDevices]);

  const handleDeleteDeviceFromPage = useCallback((id: number) => {
    handleDeleteDevice(id, true);
  }, [handleDeleteDevice]);

  const handleDeleteDeviceFromList = useCallback((id: number) => {
    handleDeleteDevice(id, false);
  }, [handleDeleteDevice]);

  const handleLaunchSlidesDemo = useCallback(() => {
    openDryRunModal(devices.map((d) => d.id));
  }, [openDryRunModal, devices]);

  const handleScanDriftAll = useCallback(() => {
    handleScanDrift();
  }, [handleScanDrift]);

  const handleSwitchRole = useCallback((role: UserRole) => {
    api.setRole(role);
    setUserRole(role);
  }, []);

  const handleToggleCopilot = useCallback(() => setCopilotOpen((o) => !o), []);
  const handleOpenWelcomeModal = useCallback(() => setWelcomeModalOpen(true), []);
  const handleOpenShareModal = useCallback(() => setShareModalOpen(true), []);
  const handleCloseCopilot = useCallback(() => setCopilotOpen(false), []);
  const handleCloseSearch = useCallback(() => setSearchOpen(false), []);
  const handleCloseDryRun = useCallback(() => setDryRunModalOpen(false), []);
  const handleCloseShare = useCallback(() => setShareModalOpen(false), []);
  const handleOpenSearch = useCallback(() => setSearchOpen(true), []);
  const handleSelectJob = useCallback((id: string) => setSelectedJobId(id), []);

  const handleWelcomeClose = useCallback(async (role: UserRole) => {
    setUserRole(role);
    setWelcomeModalOpen(false);
    const t = translations[locale];
    showToast(role === 'owner' ? t.toastOwnerSuccess : t.toastConnectSuccess, 'success');
    await refreshAll();
    try {
      const current = await api.getDevices();
      if (!current || current.length === 0) {
        await api.syncInventory();
        await fetchDevices();
      }
    } catch (e) {
      console.error('Welcome auto-sync error', e);
    }
  }, [locale, showToast, refreshAll, fetchDevices]);

  return (
    <div className="min-h-dvh overflow-x-hidden bg-[var(--bg-main)] text-[var(--text-primary)] flex flex-col font-sans selection:bg-cyan-500/30 selection:text-cyan-200 transition-colors">
      <Header
        userRole={userRole}
        setUserRole={handleSwitchRole}
        apiHealthy={apiHealthy}
        onToggleCopilot={handleToggleCopilot}
        copilotOpen={copilotOpen}
        locale={locale}
        setLocale={handleSetLocale}
        theme={theme}
        setTheme={handleSetTheme}
        onOpenWelcomeModal={handleOpenWelcomeModal}
        onOpenShareModal={handleOpenShareModal}
        onOpenShortcutsModal={() => setShortcutsModalOpen(true)}
      />

      {!apiHealthy && (
        <div className="bg-rose-500/15 border-b border-rose-500/30 px-4 py-2 flex items-center justify-between text-xs text-rose-300 font-mono animate-fade-in">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-rose-400 animate-ping shrink-0" />
            <span>
              {locale === 'en'
                ? 'Connection to NetOps API lost. Reconnecting automatically...'
                : 'Потеряна связь с NetOps API. Автоматическое переподключение...'}
            </span>
          </div>
          <button
            onClick={refreshAll}
            className="px-2.5 py-1 rounded bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 border border-rose-500/30 transition-colors cursor-pointer text-[11px]"
          >
            {locale === 'en' ? 'Retry Now' : 'Повторить попытку'}
          </button>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center space-x-3 px-4 py-3 rounded-xl bg-zinc-900 border border-white/[0.1] shadow-2xl animate-fade-in text-xs">
          {toast.type === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
          {toast.type === 'error' && <AlertCircle className="w-4 h-4 text-rose-400" />}
          {toast.type === 'info' && <Info className="w-4 h-4 text-cyan-400" />}
          <span className="text-zinc-200">{toast.message}</span>
          <button onClick={() => setToast(null)} className="text-zinc-400 hover:text-zinc-200 cursor-pointer">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <div className="flex flex-1">
        <Sidebar
          activeTab={activeTab === 'device' ? 'devices' : activeTab}
          setActiveTab={setActiveTab}
          locale={locale}
        />
        <main className="flex-1 min-w-0 p-3 sm:p-6 space-y-4 sm:space-y-6 pb-24 lg:pb-6">
          <Suspense fallback={<LoadingFallback />}>
            {activeTab === 'dashboard' && (
              <Dashboard
                devices={devices}
                jobs={jobs}
                userRole={userRole}
                locale={locale}
                onOpenTab={setActiveTab}
                onOpenDevice={openDevice}
                onRunDryRun={openDryRunModal}
                onOpenDiff={handleOpenDiffJob}
                onSyncInventory={handleSyncInventory}
              />
            )}

            {activeTab === 'device' && deviceId !== null && (
              <DevicePage
                key={deviceId}
                deviceId={deviceId}
                userRole={userRole}
                locale={locale}
                onBack={handleBackFromDevice}
                onRunDryRun={openDryRunModal}
                onScanDrift={handleScanDrift}
                onAskCopilot={askCopilot}
                onDeleteDevice={handleDeleteDeviceFromPage}
              />
            )}

            {activeTab === 'slides' && (
              <SlidesPresentation
                onLaunchDemo={handleLaunchSlidesDemo}
                onOpenTab={setActiveTab}
              />
            )}

            {activeTab === 'devices' && (
              <DeviceList
                devices={devices}
                loading={loading}
                userRole={userRole}
                locale={locale}
                onRefresh={refreshAll}
                onRunDryRun={openDryRunModal}
                onScanDrift={handleScanDrift}
                onSyncInventory={handleSyncInventory}
                onLintIntent={handleLintIntent}
                onOpenDevice={openDevice}
                onOpenDiff={openDiff}
                onDeleteDevice={handleDeleteDeviceFromList}
              />
            )}

            {activeTab === 'jobs' && (
              <JobsView
                jobs={jobs}
                selectedJobId={selectedJobId}
                onSelectJob={handleSelectJob}
                onDeploy={handleDeploy}
                onOpenDiff={handleOpenDiffJob}
                onRefresh={fetchJobs}
                locale={locale}
              />
            )}

            {activeTab === 'diff' && (
              <DiffViewer
                jobs={jobs}
                selectedJobId={selectedJobId}
                onSelectJob={handleSelectJob}
                onDeploy={handleDeploy}
                locale={locale}
                theme={theme}
              />
            )}

            {activeTab === 'drift' && (
              <DriftView
                onRemediate={handleRemediate}
                onScanDrift={handleScanDriftAll}
                locale={locale}
              />
            )}

            {activeTab === 'lab' && (
              <ChaosLabView onRefreshAll={refreshAll} locale={locale} />
            )}

            {activeTab === 'emergency' && (
              <EmergencyHub
                currentRole={userRole === 'admin' ? 'admin' : 'operator'}
                onSwitchRole={handleSwitchRole}
              />
            )}
          </Suspense>
        </main>
      </div>

      <Suspense fallback={null}>
        {copilotOpen && (
          <CopilotPanel
            open={copilotOpen}
            onClose={handleCloseCopilot}
            deviceId={activeTab === 'device' ? deviceId : null}
            locale={locale}
            request={copilotRequest}
            activeScreen={activeTab}
            onRunDryRun={openDryRunModal}
            onOpenDiff={openDiff}
            onScanDrift={handleScanDrift}
            onOpenDevice={openDevice}
            onRemediate={handleRemediate}
            onOpenTab={setActiveTab}
          />
        )}

        {dryRunModalOpen && (
          <DryRunModal
            open={dryRunModalOpen}
            onClose={handleCloseDryRun}
            onConfirm={handleExecuteDryRun}
            deviceIds={dryRunTargetIds}
            devices={devices}
            locale={locale}
          />
        )}

        {shareModalOpen && (
          <ShareModal
            isOpen={shareModalOpen}
            onClose={handleCloseShare}
            userRole={userRole}
            locale={locale}
          />
        )}

        {welcomeModalOpen && (
          <WelcomeModal
            isOpen={welcomeModalOpen}
            onClose={handleWelcomeClose}
            locale={locale}
            setLocale={handleSetLocale}
            theme={theme}
            setTheme={handleSetTheme}
          />
        )}

        {shortcutsModalOpen && (
          <ShortcutsModal
            isOpen={shortcutsModalOpen}
            onClose={() => setShortcutsModalOpen(false)}
            locale={locale}
          />
        )}
      </Suspense>

      <CommandPalette
        open={searchOpen}
        onClose={handleCloseSearch}
        devices={devices}
        onOpenDevice={openDevice}
        onOpenTab={setActiveTab}
        locale={locale}
      />

      <MobileNav
        activeTab={activeTab === 'device' ? 'devices' : activeTab}
        setActiveTab={setActiveTab}
        locale={locale}
        theme={theme}
        setTheme={handleSetTheme}
        userRole={userRole}
        setUserRole={handleSwitchRole}
        setLocale={handleSetLocale}
        onToggleCopilot={handleToggleCopilot}
        onOpenSearch={handleOpenSearch}
        onOpenShare={handleOpenShareModal}
      />
    </div>
  );
}

export default App;
