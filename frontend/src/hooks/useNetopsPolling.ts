import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { allConsolePorts, api, getErrorMessage, isLocalOwnerConsole } from '../api';
import type { Device, JobSummary, UserRole } from '../api';

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

interface UseNetopsPollingParams {
  isDedicatedRolePort: boolean;
  userRole: UserRole;
  locale: 'ru' | 'en';
  setActiveTab: React.Dispatch<React.SetStateAction<string>>;
  setUserRole: React.Dispatch<React.SetStateAction<UserRole>>;
  setWelcomeModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setAccessCodeModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

export function useNetopsPolling({
  isDedicatedRolePort,
  userRole,
  locale,
  setActiveTab,
  setUserRole,
  setWelcomeModalOpen,
  setAccessCodeModalOpen,
  showToast,
}: UseNetopsPollingParams) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [apiHealthy, setApiHealthy] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(true);
  const authFailedRef = useRef<boolean>(false);
  const devicesInFlightRef = useRef<boolean>(false);
  const jobsInFlightRef = useRef<boolean>(false);

  const clearAuthFailed = useCallback(() => {
    authFailedRef.current = false;
  }, []);

  useEffect(() => {
    if (isDedicatedRolePort) return;
    const params = new URLSearchParams(window.location.search);
    const hasInviteToken = Boolean(params.get('token') || params.get('role'));
    const localOwner = isLocalOwnerConsole();
    api
      .getBootstrapStatus()
      .then((st) => {
        if (localOwner && st && st.bootstrap_completed === false) {
          localStorage.removeItem('netops_onboarding_done');
          setWelcomeModalOpen(true);
        } else if (!hasInviteToken && st && st.bootstrap_completed && (st.caller_is_bound_owner || localOwner)) {
          localStorage.setItem('netops_onboarding_done', 'true');
          setWelcomeModalOpen(false);
        }
      })
      .catch(() => {});
  }, [isDedicatedRolePort, setWelcomeModalOpen]);

  const isAuthError = (err: unknown): boolean => {
    const msg = getErrorMessage(err, '').toLowerCase();
    return msg.includes('401') || msg.includes('учетные данные') || msg.includes('unauthorized');
  };

  const fetchDevices = useCallback(async () => {
    if (devicesInFlightRef.current) return;
    devicesInFlightRef.current = true;
    try {
      const data = await api.getDevices();
      authFailedRef.current = false;
      setDevices((prev) => (areDevicesEqual(prev, data) ? prev : data));
      setApiHealthy((prev) => (prev ? prev : true));
    } catch (err: unknown) {
      if (isAuthError(err)) {
        authFailedRef.current = true;
        if (isLocalOwnerConsole()) {
          localStorage.removeItem('netops_onboarding_done');
          setWelcomeModalOpen(true);
        } else {
          setAccessCodeModalOpen(true);
        }
      } else {
        console.error('Failed to load devices', err);
        setApiHealthy(false);
      }
    } finally {
      devicesInFlightRef.current = false;
    }
  }, [setWelcomeModalOpen, setAccessCodeModalOpen]);

  const fetchJobs = useCallback(async () => {
    if (jobsInFlightRef.current) return;
    jobsInFlightRef.current = true;
    try {
      const data = await api.getJobs();
      authFailedRef.current = false;
      setJobs((prev) => (areJobsEqual(prev, data) ? prev : data));
      setSelectedJobId((current) => {
        if (current && data.some((j) => j.id === current)) return current;
        const diffJob = data.find((j) => j.type === 'DRY_RUN' || j.type === 'DEPLOY');
        return diffJob?.id ?? data[0]?.id ?? null;
      });
    } catch (err: unknown) {
      if (isAuthError(err)) {
        authFailedRef.current = true;
      } else {
        console.error('Failed to load jobs', err);
      }
    } finally {
      jobsInFlightRef.current = false;
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

  useEffect(() => {
    let active = true;
    (async () => {
      const localOwner = isLocalOwnerConsole();
      try {
        try {
          const me = await api.getMe();
          if (active && me.role) {
            authFailedRef.current = false;
            setAccessCodeModalOpen(false);
            const resolvedRole: UserRole =
              localOwner && me.role === 'viewer' ? 'owner' : (me.role as UserRole);
            setUserRole(resolvedRole);
            localStorage.setItem('netops_user_role', resolvedRole);
          }
        } catch (authErr: unknown) {
          if (active) {
            if (localOwner) {
              api.setRole('owner');
              setUserRole('owner');
            } else {
              authFailedRef.current = true;
              setAccessCodeModalOpen(true);
              const params = new URLSearchParams(window.location.search);
              if (params.get('token') || params.get('code')) {
                showToast(getErrorMessage(authErr, 'Ошибка авторизации кода/токена'), 'error');
              }
              return;
            }
          }
        }

        const [devs, jbs] = await Promise.all([api.getDevices(), api.getJobs()]);
        if (!active) return;
        authFailedRef.current = false;
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
        const msg = getErrorMessage(err, '');
        const isAuthErr =
          msg.includes('401') ||
          msg.toLowerCase().includes('учетные данные') ||
          msg.toLowerCase().includes('unauthorized');
        if (isAuthErr && localOwner) {
          authFailedRef.current = true;
          localStorage.removeItem('netops_onboarding_done');
          setWelcomeModalOpen(true);
        } else if (isAuthErr) {
          authFailedRef.current = true;
          setAccessCodeModalOpen(true);
        } else {
          console.error('Failed initial load', err);
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [showToast, setAccessCodeModalOpen, setUserRole, setWelcomeModalOpen]);

  useEffect(() => {
    const canPoll = () =>
      !authFailedRef.current &&
      Boolean(
        localStorage.getItem('netops_onboarding_done') === 'true' ||
          localStorage.getItem('netops_auth_token') ||
          localStorage.getItem('netops_personal_token') ||
          document.cookie.includes('netops_csrf=') ||
          allConsolePorts().includes(window.location.port)
      );

    const onFocusOrVisible = () => {
      if (document.visibilityState === 'visible' && canPoll()) {
        fetchDevices();
        fetchJobs();
      }
    };
    window.addEventListener('focus', onFocusOrVisible);
    document.addEventListener('visibilitychange', onFocusOrVisible);

    // Idle: 10-15с (база 12.5с ±20% jitter против синхронных волн от 100+ клиентов);
    // активный job: быстрый тик. Перекрытие запросов исключено in-flight guard в fetch*.
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const base = hasActiveJob ? 1500 : 12500;
      const delay = base * (0.8 + Math.random() * 0.4);
      timer = setTimeout(async () => {
        if (stopped) return;
        if (document.visibilityState !== 'hidden' && canPoll()) {
          await Promise.all([fetchJobs(), fetchDevices()]);
        }
        if (!stopped) schedule();
      }, delay);
    };
    schedule();

    return () => {
      window.removeEventListener('focus', onFocusOrVisible);
      document.removeEventListener('visibilitychange', onFocusOrVisible);
      stopped = true;
      clearTimeout(timer);
    };
  }, [hasActiveJob, fetchDevices, fetchJobs]);

  const handleExecuteDryRun = useCallback(
    async (deviceIds: number[]) => {
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
    },
    [fetchJobs, setActiveTab, showToast]
  );

  const handleDeploy = useCallback(
    async (jobId: string) => {
      try {
        const targetJob = jobs.find((j) => j.id === jobId);
        if (targetJob && targetJob.type !== 'DRY_RUN') {
          showToast('Синхронизация с эталонным конфигом (Remediation / Deploy)...', 'info');
          const diff = await api.getJobDiff(jobId);
          const changed = diff.devices.filter((d) => Boolean(d.remediation_patch?.trim()));
          for (const dev of changed) {
            const patch = dev.remediation_patch || '';
            if (dev.device_id) {
              try {
                const rem = await api.remediateDrift(dev.device_id);
                setSelectedJobId(rem.job_id);
              } catch {
                await api.applyEmergencyPatch(
                  dev.hostname,
                  patch,
                  'Деплой эталонного конфига из Diff & Config'
                );
              }
            } else {
              await api.applyEmergencyPatch(
                dev.hostname,
                patch,
                'Деплой эталонного конфига из Diff & Config'
              );
            }
          }
          const scan = await api.scanDrift(
            changed.map((d) => d.device_id).filter((id): id is number => typeof id === 'number')
          );
          setSelectedJobId(scan.job_id);
          setActiveTab('jobs');
          showToast(`Эталонная конфигурация применена (${changed.length} узл.)!`, 'success');
          await Promise.all([fetchJobs(), fetchDevices()]);
          return;
        }
        showToast('Запуск транзакционного деплоя (commit confirmed)...', 'info');
        const res = await api.createDeploy(jobId, userRole);
        setSelectedJobId(res.job_id);
        setActiveTab('jobs');
        showToast(`Деплой ${res.job_id.slice(0, 8)} запущен!`, 'success');
        await fetchJobs();
      } catch (err: unknown) {
        showToast(`Ошибка деплоя: ${getErrorMessage(err)}`, 'error');
      }
    },
    [fetchDevices, fetchJobs, jobs, setActiveTab, showToast, userRole]
  );

  const handleScanDrift = useCallback(
    async (deviceIds?: number[]) => {
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
    },
    [fetchJobs, setActiveTab, showToast]
  );

  const handleRemediate = useCallback(
    async (targetDeviceId: number) => {
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
    },
    [fetchJobs, setActiveTab, showToast]
  );

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

  const handleDeleteDevice = useCallback(
    async (id: number, returnToList = false) => {
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
    },
    [fetchDevices, fetchJobs, locale, setActiveTab, showToast]
  );

  return {
    devices,
    jobs,
    selectedJobId,
    setSelectedJobId,
    apiHealthy,
    loading,
    fetchDevices,
    fetchJobs,
    refreshAll,
    clearAuthFailed,
    handleExecuteDryRun,
    handleDeploy,
    handleScanDrift,
    handleRemediate,
    handleSyncInventory,
    handleLintIntent,
    handleDeleteDevice,
  };
}
