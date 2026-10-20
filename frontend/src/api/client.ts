/**
 * @file api/client.ts
 * @description Domain REST API client methods for CROC DREAM NetOps Platform.
 */

import {
  bootstrapAuthSession,
  getPublicConsoleUrls,
  isLocalOwnerConsole,
  isLoopbackUrl,
  resolveCurrentRole,
  resolveShareBaseUrl,
  type PublicConsoleUrls,
} from './auth';
import { NetOpsHttpClient } from './http';
import type {
  AiGuardResponse,
  BootstrapConfigureRequest,
  BootstrapConfigureResponse,
  BootstrapExposureInfo,
  BootstrapStatusResponse,
  CollectorPlanResponse,
  CopilotReplyWithAction,
  Device,
  DeviceDetail,
  DeviceEmergencyAction,
  DeviceProbeRequest,
  DeviceProbeResult,
  DriftReportItem,
  EmergencyAuditLog,
  Forecast,
  ForecastAlert,
  GitStatusInfo,
  IntentSaveResult,
  IntentSource,
  IntegrationsStatus,
  JobDetail,
  JobDiff,
  JobLog,
  JobStatus,
  JobSummary,
  RecoverOwnerResponse,
  RiskExplanation,
  ServerDiscoveryResponse,
  UserAccount,
  UserInviteCreated,
  UserRole,
} from './types';

export class NetOpsApiClient extends NetOpsHttpClient {

  async getDevices(): Promise<Device[]> {
    return this.request<Device[]>('/devices');
  }

  async getTopology(): Promise<Device[]> {
    return this.getDevices();
  }

  async getDevice(id: number): Promise<DeviceDetail> {
    return this.request<DeviceDetail>(`/devices/${id}`);
  }

  async probeDevice(data: DeviceProbeRequest): Promise<DeviceProbeResult> {
    return this.request<DeviceProbeResult>('/devices/probe', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async createDevice(
    data: Partial<Device> & {
      auth_profile?: string;
      username?: string;
      password?: string;
      proxy_jump?: string | null;
      hardware_specs?: string | null;
    }
  ): Promise<Device> {
    return this.request<Device>('/devices', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async promoteDevice(id: number): Promise<Device> {
    return this.request<Device>(`/devices/${id}/promote`, {
      method: 'POST',
    });
  }

  async deviceEmergencyAction(id: number, data: DeviceEmergencyAction): Promise<{ status: string; message: string }> {
    return this.request<{ status: string; message: string }>(`/devices/${id}/emergency-action`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async deleteDevice(id: number): Promise<void> {
    return this.request<void>(`/devices/${id}`, {
      method: 'DELETE',
    });
  }

  async syncInventory(): Promise<{ created: string[]; updated: string[]; unchanged: string[] }> {
    return this.request('/inventory/sync', { method: 'POST' });
  }

  async createDryRun(deviceIds: number[]): Promise<{ job_id: string; status: JobStatus }> {
    return this.request('/jobs/dry-run', {
      method: 'POST',
      body: JSON.stringify({ device_ids: deviceIds, intent_source: 'git_main' }),
    });
  }

  async runDryRun(deviceIds: number[]): Promise<{ job_id: string; status: JobStatus }> {
    return this.createDryRun(deviceIds);
  }

  async createDeploy(jobId: string, confirmedBy: string = 'operator'): Promise<{ job_id: string; status: JobStatus }> {
    return this.request('/jobs/deploy', {
      method: 'POST',
      body: JSON.stringify({ job_id: jobId, confirmed_by: confirmedBy }),
    });
  }

  async deployConfig(jobId: string, confirmedBy: string = 'operator'): Promise<{ job_id: string; status: JobStatus }> {
    return this.createDeploy(jobId, confirmedBy);
  }

  async getJobs(limit = 20): Promise<JobSummary[]> {
    return this.request<JobSummary[]>(`/jobs?limit=${limit}`);
  }

  async getJob(id: string): Promise<JobDetail> {
    return this.request<JobDetail>(`/jobs/${id}`);
  }

  async getJobLogs(id: string, afterId = 0): Promise<JobLog[]> {
    return this.request<JobLog[]>(`/jobs/${id}/logs?after_id=${afterId}`);
  }

  async getJobDiff(id: string): Promise<JobDiff> {
    return this.request<JobDiff>(`/jobs/${id}/diff`);
  }

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

  // --------------------------------------------------------------------------
  // Intent Linting & Chaos Simulation
  // --------------------------------------------------------------------------

  async lintIntent(): Promise<{ issues: Array<{ source: string; field: string; message: string; severity?: string }> }> {
    return this.request('/intent/lint');
  }

  async injectChaos(scenario: string): Promise<{ status: string; message: string }> {
    return this.request('/system/chaos', {
      method: 'POST',
      body: JSON.stringify({ scenario }),
    });
  }

  // --------------------------------------------------------------------------
  // AI Copilot & Risk Assessment
  // --------------------------------------------------------------------------

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

  async askCopilot(message: string, deviceId?: number | null, screen?: string | null): Promise<CopilotReplyWithAction> {
    return this.request<CopilotReplyWithAction>('/copilot/chat', {
      method: 'POST',
      body: JSON.stringify({
        message,
        device_id: deviceId ?? null,
        screen: screen ?? null,
      }),
    });
  }

  async getAiGuardOverview(): Promise<AiGuardResponse[]> {
    return this.request<AiGuardResponse[]>('/ai-guard/overview');
  }

  // --------------------------------------------------------------------------
  // Emergency Hub / Manual Intervention (Zero-Trust RBAC)
  // --------------------------------------------------------------------------

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

  async getEmergencyAudit(): Promise<EmergencyAuditLog[]> {
    return this.request<EmergencyAuditLog[]>('/emergency/audit');
  }

  // --------------------------------------------------------------------------
  // Session, Sharing, Git SoT & Integrations Utilities
  // --------------------------------------------------------------------------

  async getMe(): Promise<UserAccount> {
    return this.request<UserAccount>('/users/me');
  }

  async getUsers(): Promise<UserAccount[]> {
    return this.request<UserAccount[]>('/users');
  }

  async createUserInvite(
    username: string,
    role: 'viewer' | 'operator' | 'admin',
    allowedSystem?: string | null,
    expiresInMinutes?: number | null
  ): Promise<UserInviteCreated> {
    return this.request<UserInviteCreated>('/users', {
      method: 'POST',
      body: JSON.stringify({
        username,
        role,
        allowed_system: allowedSystem || null,
        expires_in_minutes: expiresInMinutes && expiresInMinutes > 0 ? expiresInMinutes : null,
      }),
    });
  }

  async createBatchInvites(
    prefix: string,
    role: 'viewer' | 'operator' | 'admin',
    count: number,
    allowedSystem?: string | null,
    expiresInMinutes?: number | null
  ): Promise<UserInviteCreated[]> {
    return this.request<UserInviteCreated[]>('/users/batch', {
      method: 'POST',
      body: JSON.stringify({
        prefix,
        role,
        count,
        allowed_system: allowedSystem || null,
        expires_in_minutes: expiresInMinutes && expiresInMinutes > 0 ? expiresInMinutes : null,
      }),
    });
  }

  async updateUserInvite(
    userId: number,
    patch: {
      role?: 'viewer' | 'operator' | 'admin';
      is_active?: boolean;
      allowed_system?: string | null;
      expires_in_minutes?: number | null;
    }
  ): Promise<UserAccount> {
    return this.request<UserAccount>(`/users/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  }

  async generateUserVerifyCode(userId: number): Promise<UserAccount> {
    return this.request<UserAccount>(`/users/${userId}/verify-code`, {
      method: 'POST',
    });
  }

  async rotateUserToken(userId: number): Promise<UserInviteCreated> {
    return this.request<UserInviteCreated>(`/users/${userId}/token`, {
      method: 'POST',
    });
  }

  async unbindUserDevice(userId: number): Promise<UserAccount> {
    return this.request<UserAccount>(`/users/${userId}/unbind`, {
      method: 'POST',
    });
  }

  async deleteUserInvite(userId: number): Promise<void> {
    return this.request<void>(`/users/${userId}`, {
      method: 'DELETE',
    });
  }

  async getGitStatus(): Promise<GitStatusInfo> {
    return this.request<GitStatusInfo>('/git/status');
  }

  async syncGitSot(): Promise<{
    status: string;
    pull_output: string;
    sync: { created: string[]; updated: string[]; unchanged: string[] };
    git: GitStatusInfo;
  }> {
    return this.request('/git/sync', { method: 'POST' });
  }

  async getIntegrationsStatus(): Promise<IntegrationsStatus> {
    return this.request<IntegrationsStatus>('/system/integrations');
  }

  async sendTelegramSummary(customNote?: string): Promise<{
    status: string;
    sent: boolean;
    chat_ids: number[];
    message_preview: string;
    hint?: string;
  }> {
    return this.request('/system/telegram/test', {
      method: 'POST',
      body: JSON.stringify({ custom_note: customNote || null }),
    });
  }

  /**
   * Builds a direct share URL for any personal or preset token using the public internet URL.
   */
  buildInviteUrl(token: string, baseOverride?: string): string {
    const base = resolveShareBaseUrl(baseOverride);
    return `${base}/?token=${encodeURIComponent(token)}`;
  }

  /**
   * Returns ready-to-share public URLs for Jury (5176), Operator (5175), Admin (5174), and single-port links.
   */
  getPublicConsoles(exposure?: BootstrapExposureInfo | null): PublicConsoleUrls {
    return getPublicConsoleUrls(exposure);
  }

  getCanvasName(): string {
    return localStorage.getItem('netops_canvas_name') || 'Фабрика КРОК CLOS (Пром-кластер)';
  }

  setCanvasName(name: string): void {
    localStorage.setItem('netops_canvas_name', name);
  }

  getRole(): UserRole {
    return resolveCurrentRole();
  }

  setRole(role: UserRole): void {
    if (isLocalOwnerConsole() && role === 'viewer') {
      localStorage.setItem('netops_user_role', 'owner');
      return;
    }
    localStorage.setItem('netops_user_role', role);
  }

  async getBootstrapStatus(): Promise<BootstrapStatusResponse> {
    const res = await this.request<BootstrapStatusResponse>('/system/bootstrap/status');
    if (typeof window !== 'undefined' && res?.exposure?.public_url && !isLoopbackUrl(res.exposure.public_url)) {
      localStorage.setItem('netops_share_base_url', res.exposure.public_url);
    }
    return res;
  }

  async claimOwnerBootstrap(data: {
    cluster_name: string;
    owner_username?: string;
    recovery_key?: string;
  }): Promise<{
    status: string;
    username: string;
    role: UserRole;
    token: string;
    recovery_key: string;
    bound_client_id: string;
    bound_ip: string;
    cluster_name: string;
  }> {
    return this.request('/system/bootstrap/claim-owner', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async unlinkOwnerTelegram(): Promise<{ unlinked: boolean }> {
    return this.request<{ unlinked: boolean }>('/system/owner/telegram/unlink', { method: 'POST' });
  }

  async recoverOwnerAccess(data: {
    action: 'request_telegram_code' | 'verify';
    recovery_key?: string;
    telegram_code?: string;
  }): Promise<RecoverOwnerResponse> {
    return this.request<RecoverOwnerResponse>('/system/bootstrap/recover-owner', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async configureBootstrapLayers(data: BootstrapConfigureRequest): Promise<BootstrapConfigureResponse> {
    const res = await this.request<BootstrapConfigureResponse>('/system/bootstrap/configure', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    if (typeof window !== 'undefined' && res?.exposure?.public_url && !isLoopbackUrl(res.exposure.public_url)) {
      localStorage.setItem('netops_share_base_url', res.exposure.public_url);
    }
    return res;
  }

  async commitDiffToGit(jobId: string): Promise<{
    status: string;
    committed: boolean;
    pushed: boolean;
    commit_short: string;
    commit_message?: string;
    branch: string;
    push_output?: string;
  }> {
    return this.request('/git/commit-diff', {
      method: 'POST',
      body: JSON.stringify({ job_id: jobId }),
    });
  }

  async discoverAndAttachServer(data: {
    mode: 'ssh' | 'offline';
    host?: string;
    port?: number;
    username?: string;
    password?: string;
    switch_password_huawei?: string;
    switch_password_arista?: string;
    switch_password_cisco?: string;
  }): Promise<ServerDiscoveryResponse> {
    return this.request<ServerDiscoveryResponse>('/system/bootstrap/discover-server', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getFreezeStatus(): Promise<{
    frozen: boolean;
    reason?: string;
    frozen_by?: string;
    frozen_at?: string;
  }> {
    return this.request('/emergency/freeze', { method: 'GET' });
  }

  async setFreezeStatus(
    frozen: boolean,
    reason = 'Аварийная заморозка фабрики (Change Freeze)'
  ): Promise<{
    frozen: boolean;
    reason?: string;
    frozen_by?: string;
    frozen_at?: string;
  }> {
    return this.request('/emergency/freeze', {
      method: 'POST',
      body: JSON.stringify({ frozen, reason }),
    });
  }

  async getIntentSource(deviceId: number): Promise<IntentSource> {
    return this.request<IntentSource>(`/devices/${deviceId}/intent-source`);
  }

  async saveIntentSource(deviceId: number, yaml: string): Promise<IntentSaveResult> {
    return this.request<IntentSaveResult>(`/devices/${deviceId}/intent-source`, {
      method: 'PUT',
      body: JSON.stringify({ yaml }),
    });
  }

  async getCollectorPlan(): Promise<CollectorPlanResponse> {
    return this.request<CollectorPlanResponse>('/telemetry/collectors');
  }

  async setDeviceCollectorProtocol(
    hostname: string,
    protocol: 'auto' | 'gnmi' | 'snmp' | 'prometheus_exporter' | 'ssh_cli'
  ): Promise<CollectorPlanResponse> {
    return this.request<CollectorPlanResponse>(`/telemetry/collectors/${encodeURIComponent(hostname)}`, {
      method: 'PUT',
      body: JSON.stringify({ protocol }),
    });
  }

  async refreshCollectorPlan(): Promise<{ status: string }> {
    return this.request<{ status: string }>('/telemetry/collectors/refresh', {
      method: 'POST',
    });
  }
}

export const api = new NetOpsApiClient();
/** Вызывать только после loadConsoleConfig() (см. main.tsx). */
export function startApiSession(): void {
  api.setReady(bootstrapAuthSession((token) => api.login(token)));
}

