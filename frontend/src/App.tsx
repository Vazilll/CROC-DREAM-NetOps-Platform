import { useEffect, useMemo, useState } from 'react';
import { api } from './api';
import type { Device, JobSummary, UserRole } from './api';
import { Header } from './components/Header';
import type { AppTheme } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './components/Dashboard';
import { DeviceList } from './components/DeviceList';
import { JobsView } from './components/JobsView';
import { DiffViewer } from './components/DiffViewer';
import { DriftView } from './components/DriftView';
import { ChaosLabView } from './components/ChaosLabView';
import { DevicePage } from './components/DevicePage';
import { CopilotPanel } from './components/CopilotPanel';
import { CommandPalette } from './components/CommandPalette';
import { SlidesPresentation } from './components/SlidesPresentation';
import { DryRunModal } from './components/DryRunModal';
import { EmergencyHub } from './components/EmergencyHub';
import { WelcomeModal } from './components/WelcomeModal';
import { translations } from './i18n';
import type { Locale } from './i18n';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

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
    return !localStorage.getItem('netops_onboarding_done');
  });
  const [devices, setDevices] = useState<Device[]>([]);
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState<number | null>(null);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [copilotRequest, setCopilotRequest] = useState<{ text: string; n: number } | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [dryRunModalOpen, setDryRunModalOpen] = useState(false);
  const [dryRunTargetIds, setDryRunTargetIds] = useState<number[]>([]);
  const [apiHealthy, setApiHealthy] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(true);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(
    null
  );

  const handleSetLocale = (newLocale: Locale) => {
    setLocale(newLocale);
    localStorage.setItem('netops_lang', newLocale);
  };

  const handleSetTheme = (newTheme: AppTheme) => {
    setTheme(newTheme);
    localStorage.setItem('netops_theme', newTheme);
  };

  useEffect(() => {
    document.documentElement.className = `theme-${theme}`;
    if (theme === 'light') {
      document.body.classList.add('theme-light');
      document.body.classList.remove('theme-dark');
    } else {
      document.body.classList.add('theme-dark');
      document.body.classList.remove('theme-light');
    }
  }, [theme]);

  // Sync token whenever role changes
  useEffect(() => {
    const tokenMap: Record<UserRole, string> = {
      owner: 'dev-owner-token',
      admin: 'dev-admin-token',
      operator: 'dev-operator-token',
      viewer: 'dev-viewer-token',
    };
    api.setToken(tokenMap[userRole]);
  }, [userRole]);

  // Global window keydown listener with priority Escape order and Ctrl+K
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        e.stopPropagation();
        setSearchOpen((o) => !o);
        return;
      }

      if (e.key === 'Escape') {
        // Priority closure order:
        // 1. DryRunModal -> 2. CommandPalette -> 3. CopilotPanel
        if (dryRunModalOpen) {
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
  }, [dryRunModalOpen, searchOpen, copilotOpen]);

  const openDevice = (id: number) => {
    setDeviceId(id);
    setActiveTab('device');
  };

  const openDiff = (targetDeviceId?: number) => {
    if (targetDeviceId) {
      setDeviceId(targetDeviceId);
    }
    setActiveTab('diff');
  };

  const openDryRunModal = (targetIds: number[]) => {
    setDryRunTargetIds(targetIds.length > 0 ? targetIds : devices.map((d) => d.id));
    setDryRunModalOpen(true);
  };

  const askCopilot = (text: string) => {
    setCopilotOpen(true);
    setCopilotRequest({ text, n: Date.now() });
  };

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast(null);
    }, 4000);
  };

  const fetchDevices = async () => {
    try {
      const data = await api.getDevices();
      setDevices(data);
      setApiHealthy(true);
    } catch (err: any) {
      console.error('Failed to load devices', err);
      setApiHealthy(false);
    }
  };

  const fetchJobs = async () => {
    try {
      const data = await api.getJobs();
      setJobs(data);
      if (data.length > 0 && !selectedJobId) {
        setSelectedJobId(data[0].id);
      }
    } catch (err: any) {
      console.error('Failed to load jobs', err);
    }
  };

  const refreshAll = async () => {
    setLoading(true);
    await Promise.all([fetchDevices(), fetchJobs()]);
    setLoading(false);
  };

  const hasActiveJob = useMemo(() => {
    return jobs.some((j) => j.status === 'RUNNING' || j.status === 'PENDING');
  }, [jobs]);

  useEffect(() => {
    refreshAll();

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
      fetchJobs();
      fetchDevices();
    }, pollMs);

    return () => {
      window.removeEventListener('focus', onFocusOrVisible);
      document.removeEventListener('visibilitychange', onFocusOrVisible);
      clearInterval(interval);
    };
  }, [hasActiveJob]);

  const handleExecuteDryRun = async (deviceIds: number[]) => {
    try {
      showToast('Запуск холостого прогона (Dry-Run)...', 'info');
      const res = await api.createDryRun(deviceIds);
      setSelectedJobId(res.job_id);
      setActiveTab('jobs');
      showToast(`Задача ${res.job_id.slice(0, 8)} поставлена в очередь!`, 'success');
      await fetchJobs();
    } catch (err: any) {
      showToast(`Ошибка запуска Dry-Run: ${err.message}`, 'error');
    }
  };

  const handleDeploy = async (jobId: string) => {
    try {
      showToast('Запуск транзакционного деплоя (commit confirmed)...', 'info');
      const res = await api.createDeploy(jobId, userRole);
      setSelectedJobId(res.job_id);
      setActiveTab('jobs');
      showToast(`Деплой ${res.job_id.slice(0, 8)} запущен!`, 'success');
      await fetchJobs();
    } catch (err: any) {
      showToast(`Ошибка деплоя: ${err.message}`, 'error');
    }
  };

  const handleScanDrift = async (deviceIds?: number[]) => {
    try {
      showToast('Запуск сканирования дрейфа конфигураций...', 'info');
      const targetIds = deviceIds && deviceIds.length > 0 ? deviceIds : undefined;
      const res = await api.scanDrift(targetIds);
      setSelectedJobId(res.job_id);
      setActiveTab('jobs');
      showToast('Внеочередной скан дрейфа запущен!', 'success');
      await fetchJobs();
    } catch (err: any) {
      showToast(`Ошибка сканирования дрейфа: ${err.message}`, 'error');
    }
  };

  const handleRemediate = async (deviceId: number) => {
    try {
      showToast('Запуск компенсирующего патча (Remediate)...', 'info');
      const res = await api.remediateDrift(deviceId);
      setSelectedJobId(res.job_id);
      setActiveTab('jobs');
      showToast('Устранение дрейфа поставлено в очередь!', 'success');
      await fetchJobs();
    } catch (err: any) {
      showToast(`Ошибка устранения дрейфа: ${err.message}`, 'error');
    }
  };

  const handleSyncInventory = async () => {
    try {
      showToast('Синхронизация inventory.yaml из Git...', 'info');
      const res = await api.syncInventory();
      showToast(
        `Инвентарь синхронизирован! Создано: ${res.created.length}, обновлено: ${res.updated.length}`,
        'success'
      );
      await fetchDevices();
    } catch (err: any) {
      showToast(`Ошибка синхронизации инвентаря: ${err.message}`, 'error');
    }
  };

  const handleLintIntent = async () => {
    try {
      const res = await api.lintIntent();
      if (res.issues && res.issues.length > 0) {
        showToast(`Найдено ${res.issues.length} предупреждений в моделях Intent.`, 'error');
      } else {
        showToast('Pre-flight lint успешен: все модели Pydantic и связность валидны!', 'success');
      }
    } catch (err: any) {
      showToast(`Ошибка линтинга: ${err.message}`, 'error');
    }
  };

  return (
    <div className={`min-h-screen theme-${theme} ${theme === 'dark' ? 'bg-[#08090c] text-zinc-100' : 'bg-slate-50 text-slate-900'} flex flex-col font-sans selection:bg-cyan-500/30 selection:text-cyan-200 transition-colors`}>
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        userRole={userRole}
        setUserRole={setUserRole}
        apiHealthy={apiHealthy}
        onToggleCopilot={() => setCopilotOpen((o) => !o)}
        copilotOpen={copilotOpen}
        locale={locale}
        setLocale={handleSetLocale}
        theme={theme}
        setTheme={handleSetTheme}
        onOpenWelcomeModal={() => setWelcomeModalOpen(true)}
      />

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
        <main className="flex-1 min-w-0 p-4 md:p-6 space-y-6">
          {activeTab === 'dashboard' && (
            <Dashboard
              devices={devices}
              jobs={jobs}
              userRole={userRole}
              locale={locale}
              onOpenTab={setActiveTab}
              onOpenDevice={openDevice}
              onRunDryRun={openDryRunModal}
              onOpenDiff={(jobId) => {
                if (jobId) setSelectedJobId(jobId);
                setActiveTab('diff');
              }}
              onSyncInventory={handleSyncInventory}
            />
          )}

          {activeTab === 'device' && deviceId !== null && (
            <DevicePage
              deviceId={deviceId}
              userRole={userRole}
              locale={locale}
              onBack={() => {
                setActiveTab('devices');
                fetchDevices();
              }}
              onRunDryRun={openDryRunModal}
              onScanDrift={handleScanDrift}
              onAskCopilot={askCopilot}
              onDeleteDevice={async (id) => {
                try {
                  await api.deleteDevice(id);
                  showToast(locale === 'en' ? 'Device deleted successfully' : 'Устройство успешно удалено', 'success');
                  await fetchDevices();
                  setActiveTab('devices');
                } catch (err: any) {
                  showToast(`${locale === 'en' ? 'Delete error' : 'Ошибка удаления'}: ${err.message}`, 'error');
                }
              }}
            />
          )}

          {activeTab === 'slides' && (
            <SlidesPresentation
              onLaunchDemo={() => {
                openDryRunModal(devices.map((d) => d.id));
              }}
              onOpenTab={(tab) => setActiveTab(tab)}
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
              onDeleteDevice={async (id) => {
                try {
                  await api.deleteDevice(id);
                  showToast(locale === 'en' ? 'Device deleted successfully' : 'Устройство успешно удалено', 'success');
                  await fetchDevices();
                } catch (err: any) {
                  showToast(`${locale === 'en' ? 'Delete error' : 'Ошибка удаления'}: ${err.message}`, 'error');
                }
              }}
            />
          )}

          {activeTab === 'jobs' && (
            <JobsView
              jobs={jobs}
              loading={loading}
              selectedJobId={selectedJobId}
              onSelectJob={(id) => setSelectedJobId(id)}
              onDeploy={handleDeploy}
              onOpenDiff={(id) => {
                setSelectedJobId(id);
                setActiveTab('diff');
              }}
              onRefresh={fetchJobs}
              locale={locale}
            />
          )}

          {activeTab === 'diff' && (
            <DiffViewer
              jobs={jobs}
              selectedJobId={selectedJobId}
              onSelectJob={(id) => setSelectedJobId(id)}
              onDeploy={handleDeploy}
              locale={locale}
              theme={theme}
            />
          )}

          {activeTab === 'drift' && (
            <DriftView
              onRemediate={handleRemediate}
              onScanDrift={() => handleScanDrift()}
              locale={locale}
            />
          )}

          {activeTab === 'lab' && (
            <ChaosLabView onRefreshAll={refreshAll} locale={locale} />
          )}

          {activeTab === 'emergency' && (
            <EmergencyHub
              currentRole={userRole === 'admin' ? 'admin' : 'operator'}
              onSwitchRole={(role) => setUserRole(role)}
            />
          )}
        </main>
      </div>

      <CopilotPanel
        open={copilotOpen}
        onClose={() => setCopilotOpen(false)}
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

      <CommandPalette
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        devices={devices}
        onOpenDevice={openDevice}
        onOpenTab={setActiveTab}
      />

      <DryRunModal
        open={dryRunModalOpen}
        onClose={() => setDryRunModalOpen(false)}
        onConfirm={handleExecuteDryRun}
        deviceIds={dryRunTargetIds}
        devices={devices}
        locale={locale}
      />

      <WelcomeModal
        isOpen={welcomeModalOpen}
        onClose={async (role) => {
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
        }}
        locale={locale}
        setLocale={handleSetLocale}
      />
    </div>
  );
}

export default App;
