// API client for CROC DREAM NetOps Platform

export type Platform = 'cisco_iosxe' | 'arista_eos' | 'huawei_vrp' | 'juniper_junos' | 'eltex_mes' | 'yadro_kornfe';
export type DeviceRole = 'spine' | 'leaf' | 'border' | 'border_firewall';
export type DeviceStatus = 'UNKNOWN' | 'IN_SYNC' | 'DRIFT_DETECTED' | 'UNREACHABLE' | 'IN_PROGRESS';
export type DriftStatus = 'IN_SYNC' | 'DRIFT_DETECTED' | 'UNREACHABLE';
export type JobType = 'DRY_RUN' | 'DEPLOY' | 'DRIFT_SCAN' | 'DRIFT_REMEDIATE';
export type JobStatus = 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED';
export type TargetStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | 'SKIPPED' | 'ROLLED_BACK';
export type LogLevel = 'INFO' | 'WARNING' | 'ERROR';
export type UserRole = 'viewer' | 'operator' | 'admin';

export type OperStatus = 'UP' | 'DOWN' | 'DEGRADED';

export interface Device {
  id: number;
  hostname: string;
  management_ip: string;
  management_port: number;
  platform: Platform;
  role: DeviceRole;
  auth_profile: string;
  status: DeviceStatus;
  oper_status?: OperStatus;
  sparkline?: number[];
  state_timeline?: string[];
  last_checked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RiskExplanation {
  risk_level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  summary: string;
  key_points: string[];
  recommendations: string[];
  is_safe: boolean;
  provider: string;
}

export interface InterfaceIntent {
  name: string;
  description?: string;
  enabled: boolean;
  mode: 'l2' | 'l3';
  ipv4_address?: string;
  mtu: number;
}

export interface BgpNeighborIntent {
  peer_ip: string;
  remote_asn: number;
  description?: string;
  password?: string;
  announced_prefixes?: string[];
}

export interface BgpIntent {
  asn: number;
  router_id: string;
  neighbors: BgpNeighborIntent[];
}

export interface AclRule {
  sequence: number;
  action: 'permit' | 'deny';
  protocol: 'ip' | 'tcp' | 'udp' | 'icmp';
  source: string;
  destination: string;
}

export interface AclIntent {
  name: string;
  rules: AclRule[];
}

export interface DeviceIntent {
  hostname: string;
  interfaces: InterfaceIntent[];
  bgp?: BgpIntent;
  acls: AclIntent[];
}

export interface DeviceDetail extends Device {
  intent: DeviceIntent | null;
  intent_issues: Array<{ source: string; field: string; message: string }>;
}

export interface JobTarget {
  device_id: number | null;
  hostname: string;
  status: TargetStatus;
  error: string | null;
  has_changes: boolean;
}

export interface JobLog {
  id: number;
  created_at: string;
  level: LogLevel;
  step: string;
  hostname: string | null;
  message: string;
}

export interface JobSummary {
  id: string;
  type: JobType;
  status: JobStatus;
  progress: number;
  intent_source: string | null;
  parent_job_id: string | null;
  created_by: string;
  confirmed_by: string | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface JobDetail extends JobSummary {
  targets: JobTarget[];
  logs: JobLog[];
}

export interface DeviceDiff {
  device_id: number | null;
  hostname: string;
  status: TargetStatus;
  error: string | null;
  running_config: string | null;
  intended_config: string | null;
  remediation_patch: string | null;
  rollback_patch: string | null;
}

export interface JobDiff {
  job_id: string;
  job_type: JobType;
  devices: DeviceDiff[];
}

export interface DriftReportItem {
  device_id: number;
  hostname: string;
  status: DriftStatus;
  checked_at: string;
  job_id: string | null;
  unauthorized_lines: string[];
  missing_lines: string[];
  remediation_patch: string | null;
  error: string | null;
}

export interface ForecastEvent {
  type: 'DEPLOY' | 'DRIFT_DETECTED' | 'REMEDIATE' | 'CHAOS';
  timestamp: string;
  title: string;
  description: string;
  severity: 'info' | 'warning' | 'critical' | 'success';
  relative_index?: number;
}

export interface Forecast {
  device_id: number;
  hostname: string;
  metric: string;
  label: string;
  unit: string;
  threshold: number;
  simulated: boolean;
  step_seconds: number;
  end_ts?: string;
  history: number[];
  median: number[];
  lower: number[];
  upper: number[];
  provider: string;
  breach_in_minutes: number | null;
  events?: ForecastEvent[];
}

export interface ForecastAlert {
  device_id: number;
  hostname: string;
  metric: string;
  label: string;
  threshold: number;
  breach_in_minutes: number;
}

export interface CopilotReply {
  answer: string;
  provider: string;
}

export interface AiGuardResponse {
  hostname: string;
  healthy: boolean;
  metric: string;
  observed_value: number;
  expected_range: [number, number];
  deviation_pct: number;
  problem: string | null;
  message: string;
  provider: string;
  injected_simulation: string | null;
}

export interface FreezeStatus {
  frozen: boolean;
  reason: string;
  timestamp: string | null;
  user: string | null;
}

const API_BASE = '/api/v1';


export class NetOpsApiClient {
  private token: string;

  constructor(token: string = 'dev-admin-token') {
    this.token = token;
  }

  setToken(token: string) {
    this.token = token;
  }

  getToken(): string {
    return this.token;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.token}`,
      ...((options.headers as Record<string, string>) || {}),
    };

    const res = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }

    return res.json();
  }

  // Devices
  async getDevices(): Promise<Device[]> {
    return this.request<Device[]>('/devices');
  }

  async getDevice(id: number): Promise<DeviceDetail> {
    return this.request<DeviceDetail>(`/devices/${id}`);
  }

  async syncInventory(): Promise<{ created: string[]; updated: string[]; unchanged: string[] }> {
    return this.request('/inventory/sync', { method: 'POST' });
  }

  // Jobs
  async createDryRun(deviceIds: number[]): Promise<{ job_id: string; status: JobStatus }> {
    return this.request('/jobs/dry-run', {
      method: 'POST',
      body: JSON.stringify({ device_ids: deviceIds, intent_source: 'git_main' }),
    });
  }

  async createDeploy(jobId: string, confirmedBy: string = 'operator'): Promise<{ job_id: string; status: JobStatus }> {
    return this.request('/jobs/deploy', {
      method: 'POST',
      body: JSON.stringify({ job_id: jobId, confirmed_by: confirmedBy }),
    });
  }

  async getJobs(limit = 20): Promise<JobSummary[]> {
    return this.request<JobSummary[]>(`/jobs?limit=${limit}`);
  }

  async getJob(id: string): Promise<JobDetail> {
    return this.request<JobDetail>(`/jobs/${id}`);
  }

  async getJobLogs(id: string, afterId?: number): Promise<JobLog[]> {
    const url = afterId !== undefined ? `/jobs/${id}/logs?after_id=${afterId}` : `/jobs/${id}/logs`;
    return this.request<JobLog[]>(url);
  }

  async getJobDiff(id: string): Promise<JobDiff> {
    return this.request<JobDiff>(`/jobs/${id}/diff`);
  }

  // Drift
  async scanDrift(deviceIds?: number[]): Promise<{ job_id: string; status: JobStatus }> {
    const validIds = deviceIds && deviceIds.length > 0 ? deviceIds : null;
    return this.request('/drift/scan', {
      method: 'POST',
      body: JSON.stringify({ device_ids: validIds }),
    });
  }

  async getDriftReport(): Promise<DriftReportItem[]> {
    return this.request<DriftReportItem[]>('/drift/report');
  }

  async remediateDrift(deviceId: number): Promise<{ job_id: string; status: JobStatus }> {
    return this.request('/drift/remediate', {
      method: 'POST',
      body: JSON.stringify({ device_id: deviceId }),
    });
  }

  // Intent Lint
  async lintIntent(): Promise<{ issues: Array<{ source: string; field: string; message: string; severity?: string }> }> {
    return this.request('/intent/lint');
  }

  // Chaos Lab
  async injectChaos(scenario: string): Promise<{ status: string; message: string }> {
    return this.request('/system/chaos', {
      method: 'POST',
      body: JSON.stringify({ scenario }),
    });
  }

  // LLM Risk Explanation
  async explainDiff(jobId: string, hostname?: string): Promise<RiskExplanation> {
    const query = hostname ? `?hostname=${encodeURIComponent(hostname)}` : '';
    return this.request<RiskExplanation>(`/jobs/${jobId}/explain${query}`, {
      method: 'POST',
    });
  }

  async getForecast(deviceId: number, metric: string, horizon = 72): Promise<Forecast> {
    return this.request<Forecast>(`/devices/${deviceId}/forecast?metric=${metric}&horizon=${horizon}`);
  }

  async getForecastAlerts(): Promise<ForecastAlert[]> {
    return this.request<ForecastAlert[]>('/forecast/alerts');
  }

  async askCopilot(message: string, deviceId?: number): Promise<CopilotReply> {
    return this.request<CopilotReply>('/copilot/chat', {
      method: 'POST',
      body: JSON.stringify({ message, device_id: deviceId ?? null }),
    });
  }

  // AI Telemetry Guard (TimesFM 3.0)
  async getAiGuardOverview(): Promise<AiGuardResponse[]> {
    return this.request<AiGuardResponse[]>('/ai-guard/overview');
  }

  async checkAiGuardDevice(deviceId: number): Promise<AiGuardResponse> {
    return this.request<AiGuardResponse>(`/ai-guard/check/${deviceId}`);
  }

  async simulateAiGuardAnomaly(hostname: string, anomalyType: 'blackhole' | 'storm' | 'clear'): Promise<{ status: string; message: string }> {
    return this.request('/ai-guard/simulate', {
      method: 'POST',
      body: JSON.stringify({ hostname, anomaly_type: anomalyType }),
    });
  }

  // Emergency Factory Freeze (Kill Switch)
  async getFreezeStatus(): Promise<FreezeStatus> {
    return this.request<FreezeStatus>('/system/freeze');
  }

  async toggleFreeze(frozen: boolean, reason?: string): Promise<FreezeStatus> {
    return this.request<FreezeStatus>('/system/freeze', {
      method: 'POST',
      body: JSON.stringify({ frozen, reason }),
    });
  }

  // Emergency Hub / Manual Intervention (Admin role)
  async executeEmergencyCommand(device: string, command: string): Promise<{
    status: string;
    device: string;
    command: string;
    output: string;
    failed?: boolean;
  }> {
    return this.request('/emergency/command', {
      method: 'POST',
      body: JSON.stringify({ device, command }),
    });
  }

  async applyEmergencyPatch(device: string, patch: string, reason?: string): Promise<{
    status: string;
    device: string;
    applied_lines: string[];
    output: string;
    reason?: string;
  }> {
    return this.request('/emergency/patch', {
      method: 'POST',
      body: JSON.stringify({ device, patch, reason: reason || 'Manual emergency patch' }),
    });
  }

  async softResetFabric(): Promise<{ status: string; message: string; details: string }> {
    return this.request('/emergency/soft-reset', { method: 'POST' });
  }

  async hardResetFabric(): Promise<{ status: string; message: string; details: string }> {
    return this.request('/emergency/hard-reset', { method: 'POST' });
  }

  async getEmergencyAudit(): Promise<Array<{
    timestamp: string;
    user: string;
    action: string;
    device: string;
    payload: string;
    reason: string;
    success: boolean;
    output_preview: string;
  }>> {
    return this.request('/emergency/audit');
  }

  // Persona / Role helper
  getRole(): 'operator' | 'admin' {
    return localStorage.getItem('netops_user_role') === 'admin' ? 'admin' : 'operator';
  }

  setRole(role: 'operator' | 'admin') {
    localStorage.setItem('netops_user_role', role);
    this.setToken(role === 'admin' ? 'dev-admin-token' : 'dev-operator-token');
  }
}

export const api = new NetOpsApiClient(
  (typeof window !== 'undefined' && localStorage.getItem('netops_user_role') === 'admin')
    ? 'dev-admin-token'
    : 'dev-operator-token'
);

