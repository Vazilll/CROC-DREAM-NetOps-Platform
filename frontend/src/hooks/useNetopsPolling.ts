import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { allConsolePorts, api, getErrorMessage, isLocalOwnerConsole } from '../api';
import type { Device, JobSummary, StandRead, UserRole } from '../api';

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
      da.fabric_id !== db.fabric_id ||
      da.site !== db.site ||
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

function alignDevicesWithStands(list: Device[], stands: StandRead[]): Device[] {
  if (list.length === 0 || stands.length !== 1) return list;
  const slug = stands[0].slug;
  if (!slug || list.some((d) => d.fabric_id === slug || d.site === slug)) return list;
  return list.map((d) => ({ ...d, site: slug }));
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
  activeStand?: string;
  setActiveStand?: React.Dispatch<React.SetStateAction<string>>;
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
  activeStand,
  setActiveStand,
}: UseNetopsPollingParams) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [stands, setStands] = useState<StandRead[]>([]);
  const [activeStandSlug, setActiveStandSlug] = useState<string>(activeStand || 'all');
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [apiHealthy, setApiHealthy] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(true);
  const authFailedRef = useRef<boolean>(false);
  const devicesInFlightRef = useRef<boolean>(false);
  const jobsInFlightRef = useRef<boolean>(false);
  const standsRef = useRef<StandRead[]>([]);

  const clearAuthFailed = useCallback(() => {
    authFailedRef.current = false;
  }, []);

  useEffect(() => {
    if (activeStand && activeStand !== activeStandSlug) {
      setActiveStandSlug(activeStand);
    }
  }, [activeStand, activeStandSlug]);

  useEffect(() => {
    if (devices.length === 0 || activeStandSlug === 'all') return;
    const matched = devices.filter(
      (d) => d.fabric_id === activeStandSlug || d.site === activeStandSlug
    );
    if (matched.length === 0) {
      const fabrics = Array.from(new Set(devices.map((d) => d.fabric_id).filter(Boolean)));
      const fallbackSlug = fabrics.length === 1 && fabrics[0] ? fabrics[0] : 'all';
      setActiveStandSlug(fallbackSlug);
      setActiveStand?.(fallbackSlug);
    }
  }, [devices, activeStandSlug, setActiveStand]);

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

  const applyDevicesAndStands = useCallback(
    (data: Device[] | unknown, standData: StandRead[] | null) => {
      if (Array.isArray(standData) && standData.length > 0) {
        standsRef.current = standData;
        setStands(standData);
      }
      if (Array.isArray(data)) {
        const aligned = alignDevicesWithStands(data, standsRef.current);
        setDevices((prev) => {
          if (aligned.length === 0 && prev.length > 0) return prev;
          return areDevicesEqual(prev, aligned) ? prev : aligned;
        });
      }
    },
    []
  );

  const applyJobsList = useCallback((data: JobSummary[] | unknown) => {
    if (!Array.isArray(data)) return;
    setJobs((prev) => {
      if (data.length === 0 && prev.length > 0) return prev;
      return areJobsEqual(prev, data) ? prev : data;
    });
    setSelectedJobId((current) => {
      if (current && data.some((j) => j.id === current)) return current;
      const diffJob = data.find(
        (j) => j.type === 'DRY_RUN' || j.type === 'DRIFT_SCAN' || j.type === 'DEPLOY'
      );
      return diffJob?.id ?? data[0]?.id ?? current;
    });
  }, []);

  const fetchDevices = useCallback(async (forceStands = false) => {
    if (devicesInFlightRef.current) return;
    devicesInFlightRef.current = true;
    try {
      const needStands = forceStands || standsRef.current.length === 0;
      const [data, standData] = await Promise.all([
        api.getDevices(),
        needStands ? api.getStands().catch(() => null) : Promise.resolve(null),
      ]);
      authFailedRef.current = false;
      applyDevicesAndStands(data, standData);
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
        setApiHealthy(false);
      }
    } finally {
      devicesInFlightRef.current = false;
    }
  }, [applyDevicesAndStands, setWelcomeModalOpen, setAccessCodeModalOpen]);

  const fetchJobs = useCallback(async () => {
    if (jobsInFlightRef.current) return;
    jobsInFlightRef.current = true;
    try {
      const data = await api.getJobs();
      authFailedRef.current = false;
      applyJobsList(data);
    } catch (err: unknown) {
      if (isAuthError(err)) {
        authFailedRef.current = true;
      }
    } finally {
      jobsInFlightRef.current = false;
    }
  }, [applyJobsList]);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([fetchDevices(true), fetchJobs()]);
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

        const [devs, jbs, standList] = await Promise.all([
          api.getDevices(),
          api.getJobs(),
          api.getStands().catch(() => null),
        ]);
        if (!active) return;
        authFailedRef.current = false;
        applyDevicesAndStands(devs, standList);
        applyJobsList(jbs);
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

    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const base = hasActiveJob ? 1500 : 20000;
      const delay = base * (0.85 + Math.random() * 0.3);
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
        if (targetJob && targetJob.type !== 'DRY_RUN' && targetJob.type !== 'DRIFT_SCAN') {
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
        setDevices((prev) => prev.filter((d) => d.id !== id));
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
    stands,
    setStands,
    activeStandSlug,
    setActiveStandSlug,
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

