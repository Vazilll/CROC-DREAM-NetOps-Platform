import { useEffect, useState, useRef } from 'react';
import {
  Activity,
  CheckCircle2,
  AlertTriangle,
  Clock,
  RotateCw,
  Terminal,
  Play,
  Server,
  RefreshCw,
  FileDown,
} from 'lucide-react';
import { api } from '../api';
import type { JobDetail, JobSummary, JobStatus } from '../api';
import { translations, type Locale } from '../i18n';

interface JobsViewProps {
  jobs: JobSummary[];
  loading?: boolean;
  selectedJobId: string | null;
  locale?: Locale;
  onSelectJob: (jobId: string) => void;
  onDeploy: (jobId: string) => void;
  onOpenDiff: (jobId: string) => void;
  onRefresh: () => void;
}

export const JobsView: React.FC<JobsViewProps> = ({
  jobs,
  selectedJobId,
  locale = 'ru',
  onSelectJob,
  onDeploy,
  onOpenDiff,
  onRefresh,
}) => {
  const t = translations[locale];
  const [activeJobDetail, setActiveJobDetail] = useState<JobDetail | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [logFilter, setLogFilter] = useState<'ALL' | 'INFO' | 'WARNING' | 'ERROR'>('ALL');
  const logContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selectedJobId) return;

    let timer: any = null;
    let isMounted = true;

    const fetchDetail = async () => {
      try {
        const detail = await api.getJob(selectedJobId);
        if (isMounted) {
          setActiveJobDetail(detail);
          if (detail.status === 'RUNNING' || detail.status === 'PENDING') {
            timer = setTimeout(fetchDetail, 1500);
          }
        }
      } catch (err) {
        console.error('Failed to load job detail', err);
      }
    };

    fetchDetail();

    return () => {
      isMounted = false;
      if (timer) clearTimeout(timer);
    };
  }, [selectedJobId]);

  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [activeJobDetail?.logs, autoScroll]);

  const getStatusBadge = (status: JobStatus) => {
    switch (status) {
      case 'SUCCESS':
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[11px] font-mono font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/25">
            <CheckCircle2 className="w-3 h-3" />
            <span>SUCCESS</span>
          </span>
        );
      case 'FAILED':
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[11px] font-mono font-medium bg-rose-500/10 text-rose-400 border border-rose-500/25">
            <AlertTriangle className="w-3 h-3" />
            <span>FAILED</span>
          </span>
        );
      case 'RUNNING':
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[11px] font-mono font-medium bg-cyan-500/10 text-cyan-400 border border-cyan-500/25 animate-pulse">
            <RotateCw className="w-3 h-3 animate-spin" />
            <span>RUNNING</span>
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[11px] font-mono font-medium bg-zinc-800 text-zinc-400 border border-white/[0.08]">
            <Clock className="w-3 h-3" />
            <span>PENDING</span>
          </span>
        );
    }
  };

  const getLogStepColor = (step: string) => {
    switch (step) {
      case 'preflight':
        return 'text-cyan-400 bg-cyan-950/40 border-cyan-800/40';
      case 'render':
        return 'text-purple-400 bg-purple-950/40 border-purple-800/40';
      case 'diff':
        return 'text-indigo-400 bg-indigo-950/40 border-indigo-800/40';
      case 'apply':
        return 'text-amber-400 bg-amber-950/40 border-amber-800/40';
      case 'post_check':
        return 'text-emerald-400 bg-emerald-950/40 border-emerald-800/40';
      case 'rollback':
        return 'text-rose-400 bg-rose-950/40 border-rose-800/40';
      default:
        return 'text-zinc-400 bg-zinc-900 border-white/[0.06]';
    }
  };

  const filteredLogs = activeJobDetail?.logs.filter((log) => {
    if (logFilter === 'ALL') return true;
    return log.level === logFilter;
  }) || [];

  const handleExportAuditReport = () => {
    if (!activeJobDetail) return;
    const targetsText = activeJobDetail.targets
      .map((t) => `- **${t.hostname}**: ${t.status}`)
      .join('\n');
    const logsText = activeJobDetail.logs
      .map((l) => `[${new Date(l.created_at).toISOString()}] [${l.level}] [${l.step}] ${l.hostname ? `[${l.hostname}] ` : ''}${l.message}`)
      .join('\n');

    const content = `# CROC DREAM NetOps Platform — Audit & Compliance Report
**Job ID**: ${activeJobDetail.id}
**Type**: ${activeJobDetail.type}
**Status**: ${activeJobDetail.status}
**Author**: ${activeJobDetail.created_by}
**Timestamp**: ${new Date(activeJobDetail.created_at).toISOString()}
**Source**: ${activeJobDetail.intent_source || 'git_main'}

---

## Target Devices (${activeJobDetail.targets.length})
${targetsText || 'None'}

---

## Execution Logs (${activeJobDetail.logs.length} entries)
\`\`\`
${logsText || 'No logs recorded.'}
\`\`\`

---
*Generated by CROC DREAM NetOps Platform • Continuous Compliance Verification System*
`;
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `NetOps_Audit_${activeJobDetail.type}_${activeJobDetail.id.slice(0, 8)}.md`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      <div className="lg:col-span-4 p-4 rounded-2xl bg-[#0c0e14] border border-white/[0.08] space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-white/[0.06]">
          <div className="flex items-center space-x-2">
            <Activity className="w-4 h-4 text-cyan-400" />
            <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-white">
              {t.jobsHistoryTitle} ({jobs.length})
            </h3>
          </div>
          <button
            onClick={onRefresh}
            className="p-1 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white border border-white/[0.06] transition cursor-pointer"
            title={t.refresh}
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="space-y-2 max-h-[640px] overflow-y-auto pr-1">
          {jobs.length === 0 ? (
            <div className="p-8 text-center text-zinc-500 font-mono text-xs">
              {t.noJobsYet}
            </div>
          ) : (
            jobs.map((j) => {
              const isSelected = j.id === selectedJobId;
              return (
                <div
                  key={j.id}
                  onClick={() => onSelectJob(j.id)}
                  className={`p-3 rounded-xl border text-xs font-mono transition cursor-pointer ${
                    isSelected
                      ? 'bg-cyan-500/10 border-cyan-500/40 shadow-sm'
                      : 'bg-zinc-950/40 border-white/[0.04] hover:border-white/[0.1]'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-white tracking-wide">{j.type}</span>
                    {getStatusBadge(j.status)}
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[11px] text-zinc-400">
                    <span className="truncate">{j.id.slice(0, 13)}...</span>
                    <span>{new Date(j.created_at).toLocaleTimeString()}</span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="lg:col-span-8 p-4 rounded-2xl bg-[#0c0e14] border border-white/[0.08] space-y-4">
        {activeJobDetail ? (
          <>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-white/[0.06]">
              <div>
                <div className="flex items-center space-x-2">
                  <span className="text-sm font-bold font-mono text-white">{activeJobDetail.type}</span>
                  <span className="text-xs text-zinc-500 font-mono">#{activeJobDetail.id.slice(0, 8)}</span>
                  {getStatusBadge(activeJobDetail.status)}
                </div>
                <div className="text-[11px] font-mono text-zinc-400 mt-1">
                  {t.startedAt}: {new Date(activeJobDetail.created_at).toLocaleString()} • {t.author}: {activeJobDetail.created_by}
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  onClick={handleExportAuditReport}
                  className="px-2.5 py-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-white/[0.08] text-xs font-mono flex items-center gap-1.5 transition cursor-pointer"
                  title={t.exportAuditReport}
                >
                  <FileDown className="w-3.5 h-3.5 text-cyan-400" />
                  <span className="hidden sm:inline">{t.exportAuditReport}</span>
                </button>

                <button
                  onClick={() => onOpenDiff(activeJobDetail.id)}
                  className="px-3 py-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-white/[0.08] text-xs font-mono transition cursor-pointer"
                >
                  {t.viewDiffBtn}
                </button>

                {activeJobDetail.type === 'DRY_RUN' && activeJobDetail.status === 'SUCCESS' && (
                  <button
                    onClick={() => onDeploy(activeJobDetail.id)}
                    className="px-3.5 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold text-xs font-mono flex items-center space-x-1.5 transition shadow-lg shadow-emerald-500/20 cursor-pointer"
                  >
                    <Play className="w-3 h-3 fill-current" />
                    <span>{t.applyDeployBtn}</span>
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <span className="text-[11px] font-mono uppercase tracking-wider text-zinc-400">
                {t.targetDevicesTitle} ({activeJobDetail.targets.length})
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {activeJobDetail.targets.map((t) => (
                  <div
                    key={t.hostname}
                    className="p-2.5 rounded-xl bg-zinc-950/60 border border-white/[0.06] flex items-center justify-between text-xs font-mono"
                  >
                    <div className="flex items-center space-x-2 truncate">
                      <Server className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                      <span className="text-zinc-200 truncate">{t.hostname}</span>
                    </div>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded ${
                        t.status === 'SUCCESS'
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                          : t.status === 'FAILED'
                          ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                          : t.status === 'PENDING'
                          ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 animate-pulse'
                          : 'bg-zinc-800 text-zinc-400'
                      }`}
                    >
                      {t.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-mono">
                <div className="flex items-center space-x-2 text-zinc-400">
                  <Terminal className="w-3.5 h-3.5 text-cyan-400" />
                  <span>{t.liveTelemetryTitle}</span>
                </div>
                <div className="flex items-center space-x-3 text-[11px]">
                  <div className="flex items-center space-x-1 bg-zinc-950 p-0.5 rounded-lg border border-white/[0.06]">
                    {(['ALL', 'INFO', 'WARNING', 'ERROR'] as const).map((lvl) => (
                      <button
                        key={lvl}
                        onClick={() => setLogFilter(lvl)}
                        className={`px-2 py-0.5 rounded text-[10px] transition cursor-pointer ${
                          logFilter === lvl
                            ? 'bg-zinc-800 text-white font-bold'
                            : 'text-zinc-500 hover:text-zinc-300'
                        }`}
                      >
                        {lvl}
                      </button>
                    ))}
                  </div>

                  <label className="flex items-center space-x-1.5 cursor-pointer text-zinc-400 hover:text-zinc-200">
                    <input
                      type="checkbox"
                      checked={autoScroll}
                      onChange={(e) => setAutoScroll(e.target.checked)}
                      className="rounded bg-zinc-900 border-white/[0.2] text-cyan-500 focus:ring-0"
                    />
                    <span>Auto-scroll</span>
                  </label>
                </div>
              </div>

              <div
                ref={logContainerRef}
                className="h-[360px] p-3.5 rounded-xl bg-zinc-950 font-mono text-[11px] leading-relaxed text-zinc-300 overflow-y-auto space-y-1.5 border border-white/[0.06]"
              >
                {filteredLogs.length === 0 ? (
                  <div className="text-zinc-600 italic">{t.emptyLogs}</div>
                ) : (
                  filteredLogs.map((log) => (
                    <div key={log.id} className="flex items-start space-x-2 hover:bg-white/[0.02] py-0.5 px-1 rounded">
                      <span className="text-zinc-600 shrink-0">
                        {new Date(log.created_at).toLocaleTimeString()}
                      </span>
                      <span
                        className={`px-1.5 py-0.2 rounded text-[10px] uppercase font-bold shrink-0 ${
                          log.level === 'ERROR'
                            ? 'bg-rose-500/20 text-rose-400'
                            : log.level === 'WARNING'
                            ? 'bg-amber-500/20 text-amber-400'
                            : 'bg-zinc-800 text-zinc-400'
                        }`}
                      >
                        {log.level}
                      </span>
                      <span
                        className={`px-1.5 py-0.2 rounded text-[10px] border shrink-0 ${getLogStepColor(
                          log.step
                        )}`}
                      >
                        {log.step}
                      </span>
                      {log.hostname && (
                        <span className="text-cyan-400 shrink-0">[{log.hostname}]</span>
                      )}
                      <span className="text-zinc-200 break-all">{log.message}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="p-16 text-center text-zinc-500 font-mono text-xs">
            {t.selectJobHint}
          </div>
        )}
      </div>
    </div>
  );
};
