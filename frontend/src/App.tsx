import { useEffect, useState } from 'react';
import { api } from './api';
import type { Device, JobSummary, UserRole } from './api';
import { Header } from './components/Header';
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
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

export function App() {
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [userRole, setUserRole] = useState<UserRole>('admin');
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

  // Sync token whenever role changes
  useEffect(() => {
    const tokenMap: Record<UserRole, string> = {
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

  useEffect(() => {
    refreshAll();
    const interval = setInterval(() => {
      fetchDevices();
      fetchJobs();
    }, 5000);
    return () => clearInterval(interval);
  }, []);

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
    <div className="min-h-screen bg-[#08090c] text-zinc-100 flex flex-col font-sans selection:bg-cyan-500/30 selection:text-cyan-200">
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        userRole={userRole}
        setUserRole={setUserRole}
        apiHealthy={apiHealthy}
        onOpenSearch={() => setSearchOpen(true)}
        onToggleCopilot={() => setCopilotOpen((o) => !o)}
        copilotOpen={copilotOpen}
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
        <Sidebar activeTab={activeTab === 'device' ? 'devices' : activeTab} setActiveTab={setActiveTab} />
        <main className="flex-1 min-w-0 p-4 md:p-6 space-y-6">
          {activeTab === 'dashboard' && (
            <Dashboard
              devices={devices}
              jobs={jobs}
              onOpenTab={setActiveTab}
              onOpenDevice={openDevice}
              onRunDryRun={openDryRunModal}
              onOpenDiff={(jobId) => {
                if (jobId) setSelectedJobId(jobId);
                setActiveTab('diff');
              }}
            />
          )}

          {activeTab === 'device' && deviceId !== null && (
            <DevicePage
              deviceId={deviceId}
              onBack={() => setActiveTab('devices')}
              onRunDryRun={openDryRunModal}
              onScanDrift={handleScanDrift}
              onAskCopilot={askCopilot}
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
              onRefresh={refreshAll}
              onRunDryRun={openDryRunModal}
              onScanDrift={handleScanDrift}
              onSyncInventory={handleSyncInventory}
              onLintIntent={handleLintIntent}
              onOpenDevice={openDevice}
              onOpenDiff={openDiff}
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
            />
          )}

          {activeTab === 'diff' && (
            <DiffViewer
              jobs={jobs}
              selectedJobId={selectedJobId}
              onSelectJob={(id) => setSelectedJobId(id)}
              onDeploy={handleDeploy}
            />
          )}

          {activeTab === 'drift' && (
            <DriftView
              onRemediate={handleRemediate}
              onScanDrift={() => handleScanDrift()}
            />
          )}

          {activeTab === 'lab' && (
            <ChaosLabView onRefreshAll={refreshAll} />
          )}
        </main>
      </div>

      <CopilotPanel
        open={copilotOpen}
        onClose={() => setCopilotOpen(false)}
        deviceId={activeTab === 'device' ? deviceId : null}
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
      />
    </div>
  );
}

export default App;
