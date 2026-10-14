/**
 * @file api.ts
 * @module NetOpsApiClient
 * @description Centralized REST API client and type definitions for CROC DREAM NetOps Platform.
 * Provides end-to-end integration with the FastAPI backend for inventory orchestration,
 * GitOps SoT intent validation, hierarchical configuration diffing (hier_config),
 * transaction-safe deployment pipelines (commit confirmed with 180s auto-rollback guard),
 * drift detection/remediation, TimesFM 3.0 ML telemetry forecasting, AI Copilot,
 * and fail-closed emergency SSH out-of-band administration.
 */

// ============================================================================
// Core Domain Types & Enums
// ============================================================================

/**
 * Heterogeneous hardware and network operating systems supported by the platform.
 * Used for vendor-specific template rendering, CLI prompt drivers, and hier_config syntax rules.
 *
 * @example 'cisco_iosxe' | 'arista_eos' | 'huawei_vrp'
 */
export type Platform =
  | 'cisco_iosxe'
  | 'arista_eos'
  | 'huawei_vrp'
  | 'juniper_junos'
  | 'eltex_mes'
  | 'eltex_esr'
  | 'yadro_kornfe'
  | 'linux_server';

/**
 * Architectural tier/role of a node within the CLOS data center or 3-Tier fabric.
 * Influences layer positioning in the 2D topology map, default intent policies, and blast-radius scoring.
 */
export type DeviceRole = 'spine' | 'leaf' | 'border' | 'border_firewall' | 'server';

/**
 * High-level intent compliance and connectivity status of a network device relative to Git SoT.
 * - `UNKNOWN`: Device state has not been verified yet.
 * - `IN_SYNC`: Running configuration strictly matches Git Intent.
 * - `DRIFT_DETECTED`: Out-of-band or unapproved changes detected on the physical device.
 * - `UNREACHABLE`: Management IP or SSH port is offline/unresponsive.
 * - `IN_PROGRESS`: Active automation pipeline currently modifying or scanning the device.
 */
export type DeviceStatus = 'UNKNOWN' | 'IN_SYNC' | 'DRIFT_DETECTED' | 'UNREACHABLE' | 'IN_PROGRESS';

/**
 * State classification for out-of-band configuration drift.
 * - `IN_SYNC`: No unauthorized configuration deviations found.
 * - `DRIFT_DETECTED`: Unauthorized additions or missing intended commands found.
 * - `UNREACHABLE`: Unable to collect running-config for drift analysis.
 */
export type DriftStatus = 'IN_SYNC' | 'DRIFT_DETECTED' | 'UNREACHABLE';

/**
 * Types of asynchronous automation pipeline jobs managed by the platform.
 * - `DRY_RUN`: Non-mutating pre-flight simulation (intent render + hier_config diff).
 * - `DEPLOY`: Transactional commit-confirmed configuration push with 180s rollback safety window.
 * - `DRIFT_SCAN`: Background configuration compliance audit against Git SoT.
 * - `DRIFT_REMEDIATE`: Automated generation and application of compensating configuration patches.
 */
export type JobType = 'DRY_RUN' | 'DEPLOY' | 'DRIFT_SCAN' | 'DRIFT_REMEDIATE';

/**
 * Execution lifecycle state of an asynchronous automation job.
 */
export type JobStatus = 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED';

/**
 * Execution result for an individual target device within a multi-device job.
 */
export type TargetStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | 'SKIPPED' | 'ROLLED_BACK';

/**
 * Severity level for stage-specific pipeline execution logs.
 */
export type LogLevel = 'INFO' | 'WARNING' | 'ERROR';

/**
 * Role-Based Access Control (RBAC) tiers:
 * - `owner`: Unrestricted administrative control + access sharing modal.
 * - `admin`: Full management, topology orchestration, emergency Web CLI, and factory reset.
 * - `operator`: Standard operations (trigger Dry-Run, Deploy, Drift scan, Remediate).
 * - `viewer`: Read-only jury/evaluator mode; mutations and destructive actions are forbidden.
 */
export type UserRole = 'viewer' | 'operator' | 'admin' | 'owner';

/**
 * Physical interface link operational status (Oper Status) distinguishing
 * physical link health from declarative configuration intent compliance.
 */
export type OperStatus = 'UP' | 'DOWN' | 'DEGRADED';

// ============================================================================
// Entity Interfaces
// ============================================================================

/**
 * Represents a managed or monitored network node or compute server in the fabric inventory.
 */
export interface Device {
  /** Unique primary key identifier in PostgreSQL/SQLite database */
  id: number;
  /** Fully qualified hostname or network node label (e.g. `spine-01.croc`) */
  hostname: string;
  /** Management IPv4/IPv6 address used for SSH or Netconf control plane sessions */
  management_ip: string;
  /** Management control plane port (default: 22) */
  management_port: number;
  /** Operating system / vendor platform classification */
  platform: Platform;
  /** Fabric architectural tier/role */
  role: DeviceRole;
  /** Named authentication credentials profile identifier */
  auth_profile: string;
  /** Declarative Git SoT compliance status */
  status: DeviceStatus;
  /** Management mode: `MONITORING_ONLY` blocks mutating CLI commands; `MANAGED` permits GitOps */
  management_mode?: 'MONITORING_ONLY' | 'MANAGED';
  /** Optional bastion / jump host connection string */
  proxy_jump?: string | null;
  /** Human-readable hardware specifications summary string */
  hardware_specs?: string | null;
  /** Physical link and port operational status */
  oper_status?: OperStatus;
  /** Historical CPU/load telemetry series for micro-sparkline rendering */
  sparkline?: number[];
  /** 24-hour hourly operational state history for state timeline bar rendering */
  state_timeline?: string[];
  /** ISO-8601 timestamp of last telemetry probe or configuration audit */
  last_checked_at: string | null;
  /** ISO-8601 creation timestamp */
  created_at: string;
  /** ISO-8601 last update timestamp */
  updated_at: string;
}

/**
 * Request payload for zero-trust SSH hardware and topology discovery probe.
 */
export interface DeviceProbeRequest {
  /** Target IP address to probe */
  management_ip: string;
  /** Target SSH port (default: 22) */
  management_port?: number;
  /** SSH probe username credential */
  username?: string;
  /** SSH probe password credential */
  password?: string;
  /** Optional bastion / jump host proxy string */
  proxy_jump?: string;
}

/**
 * Diagnostic results returned by SSH discovery probe before device onboarding.
 */
export interface DeviceProbeResult {
  /** Whether the device responded successfully over SSH */
  reachable: boolean;
  /** Platform detected via banner/prompt heuristics */
  detected_platform: Platform;
  /** Inferred CLOS tier based on hostname or LLDP topology */
  detected_role: DeviceRole;
  /** Hostname extracted from device prompt */
  hostname: string;
  /** Vendor OS version reported by device */
  os_version?: string;
  /** Detected CPU core count */
  cpu_cores?: number;
  /** Detected RAM in gigabytes */
  ram_gb?: number;
  /** Detected root disk size in gigabytes */
  disk_gb?: number;
  /** List of physical and logical interface identifiers */
  interfaces?: string[];
  /** Discovered Link Layer Discovery Protocol (LLDP) neighbors */
  lldp_neighbors?: Array<{ local_port: string; remote_chassis: string; remote_port: string }>;
  /** Informational message or probe failure explanation */
  message: string;
}

/**
 * Payload for out-of-band emergency remediation actions on a single device.
 */
export interface DeviceEmergencyAction {
  /** Target emergency intervention action type */
  action: 'rollback_last_commit' | 'reset_bgp_sessions' | 'restart_services' | 'reboot';
  /** Whether to bypass safety verification prompts */
  force?: boolean;
  /** Audit reason required for emergency intervention */
  reason?: string;
}

/**
 * LLM Guard evaluation explaining blast radius and semantic risks of a configuration diff.
 */
export interface RiskExplanation {
  /** Overall risk level determined by LLM analysis */
  risk_level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  /** Human-readable executive summary of the changes */
  summary: string;
  /** Bullet points highlighting specific operational risks (e.g. BGP teardown, ACL lockout) */
  key_points: string[];
  /** Actionable mitigation recommendations for the operator */
  recommendations: string[];
  /** Flag indicating whether the configuration change is considered safe for automatic deployment */
  is_safe: boolean;
  /** LLM provider identifier (e.g., Groq Llama 3.3, Google Gemini, local heuristic fallback) */
  provider: string;
}

/**
 * Declarative intent definition for a network interface.
 */
export interface InterfaceIntent {
  /** Interface identifier (e.g., `Ethernet1/1`, `GigabitEthernet0/0/1`) */
  name: string;
  /** Optional interface description string */
  description?: string;
  /** Administrative state (true: enabled/no shutdown, false: shutdown) */
  enabled: boolean;
  /** Switching mode: `l2` (switchport) or `l3` (routed IP interface) */
  mode: 'l2' | 'l3';
  /** Configured IPv4 CIDR address for L3 mode (e.g. `10.0.0.1/30`) */
  ipv4_address?: string;
  /** Maximum Transmission Unit size in bytes (e.g. 1500 or 9216) */
  mtu: number;
}

/**
 * Declarative intent for a single BGP neighbor peer.
 */
export interface BgpNeighborIntent {
  /** Peer IPv4 address */
  peer_ip: string;
  /** Remote Autonomous System Number (ASN) */
  remote_asn: number;
  /** Optional peering session description */
  description?: string;
  /** Optional MD5 peering authentication password */
  password?: string;
  /** List of network prefix CIDRs announced to this peer */
  announced_prefixes?: string[];
}

/**
 * Declarative intent for Border Gateway Protocol (BGP) routing engine.
 */
export interface BgpIntent {
  /** Local Autonomous System Number (ASN) */
  asn: number;
  /** Router ID (typically loopback0 IPv4 address) */
  router_id: string;
  /** Configured BGP neighbors list */
  neighbors: BgpNeighborIntent[];
}

/**
 * Access Control List (ACL) rule intent specification.
 */
export interface AclRule {
  /** Evaluation sequence number */
  sequence: number;
  /** Filtering action: `permit` or `deny` */
  action: 'permit' | 'deny';
  /** Transport or network protocol match */
  protocol: 'ip' | 'tcp' | 'udp' | 'icmp';
  /** Source IP prefix CIDR or `any` */
  source: string;
  /** Destination IP prefix CIDR or `any` */
  destination: string;
}

/**
 * Named Access Control List intent group.
 */
export interface AclIntent {
  /** ACL identifier name (e.g., `PROTECT-MANAGEMENT`) */
  name: string;
  /** Ordered list of filtering rules */
  rules: AclRule[];
}

/**
 * Composite GitOps Source of Truth declarative configuration intent model for a device.
 */
export interface DeviceIntent {
  /** Target device hostname matching inventory */
  hostname: string;
  /** Interface configuration intent items */
  interfaces: InterfaceIntent[];
  /** Optional BGP routing configuration intent */
  bgp?: BgpIntent;
  /** ACL security filtering rules */
  acls: AclIntent[];
}

/**
 * Comprehensive device entity with attached GitOps intent model and validation issues.
 */
export interface DeviceDetail extends Device {
  /** Declarative intent loaded from Git SoT repository, or null if unassigned */
  intent: DeviceIntent | null;
  /** Static schema and relational lint issues found in the device intent */
  intent_issues: Array<{ source: string; field: string; message: string }>;
}

/**
 * Execution status and change flags for a specific device in a pipeline job.
 */
export interface JobTarget {
  /** Device ID in database, or null if resolved purely by hostname */
  device_id: number | null;
  /** Target device hostname */
  hostname: string;
  /** Individual device execution outcome */
  status: TargetStatus;
  /** Error message if execution on this device failed */
  error: string | null;
  /** Whether this device requires configuration alterations */
  has_changes: boolean;
}

/**
 * Immutable audit log record for an automation pipeline step.
 */
export interface JobLog {
  /** Monotonic log sequence identifier */
  id: number;
  /** ISO-8601 timestamp when log was emitted */
  created_at: string;
  /** Log severity level */
  level: LogLevel;
  /** Pipeline step name (e.g., `preflight`, `render`, `diff`, `apply`, `rollback`) */
  step: string;
  /** Target device hostname if log relates to a specific node, or null for global steps */
  hostname: string | null;
  /** Verbatim log message text */
  message: string;
}

/**
 * High-level summary of an automation pipeline job.
 */
export interface JobSummary {
  /** UUID identifier of the job */
  id: string;
  /** Pipeline type (`DRY_RUN`, `DEPLOY`, `DRIFT_SCAN`, `DRIFT_REMEDIATE`) */
  type: JobType;
  /** Current execution status */
  status: JobStatus;
  /** Execution progress percentage (0 - 100) */
  progress: number;
  /** Source repository branch or commit identifier */
  intent_source: string | null;
  /** Associated pre-flight Dry-Run job UUID if this job is a Deploy */
  parent_job_id: string | null;
  /** Username or role that created the job */
  created_by: string;
  /** Username or role that confirmed deployment execution */
  confirmed_by: string | null;
  /** High-level error summary if job failed */
  error: string | null;
  /** ISO-8601 creation timestamp */
  created_at: string;
  /** ISO-8601 execution start timestamp */
  started_at: string | null;
  /** ISO-8601 completion timestamp */
  finished_at: string | null;
}

/**
 * Comprehensive job details including target device states and stage log stream.
 */
export interface JobDetail extends JobSummary {
  /** List of devices evaluated or modified by this job */
  targets: JobTarget[];
  /** Ordered stage execution logs */
  logs: JobLog[];
}

/**
 * Hierarchical configuration diff and generated remediation/rollback patches for a device.
 */
export interface DeviceDiff {
  /** Database device ID, or null */
  device_id: number | null;
  /** Target device hostname */
  hostname: string;
  /** Per-target execution status */
  status: TargetStatus;
  /** Error message if diff computation failed */
  error: string | null;
  /** Current live running configuration collected from physical device */
  running_config: string | null;
  /** Intended target configuration rendered from Git SoT templates */
  intended_config: string | null;
  /** Minimal hier_config patch required to bring device into compliance */
  remediation_patch: string | null;
  /** Compensating reverse patch to roll back changes in case of failure */
  rollback_patch: string | null;
}

/**
 * Aggregate configuration diff across all devices evaluated in a job.
 */
export interface JobDiff {
  /** Parent job UUID */
  job_id: string;
  /** Job automation type */
  job_type: JobType;
  /** Array of device-level configuration diffs */
  devices: DeviceDiff[];
}

/**
 * Configuration drift audit entry for a device.
 */
export interface DriftReportItem {
  /** Device ID */
  device_id: number;
  /** Device hostname */
  hostname: string;
  /** Compliance status */
  status: DriftStatus;
  /** ISO-8601 timestamp of last drift check */
  checked_at: string;
  /** Drift scan job UUID */
  job_id: string | null;
  /** Out-of-band commands present in running-config but unauthorized by Git SoT */
  unauthorized_lines: string[];
  /** Mandated Git SoT configuration commands missing from running-config */
  missing_lines: string[];
  /** Automated compensating patch to restore compliance */
  remediation_patch: string | null;
  /** Error details if drift calculation failed */
  error: string | null;
  /** Syntactically safe non-destructive drift lines */
  safe_lines?: string[];
  /** High-risk drift lines affecting routing, ACLs, or interfaces */
  risky_lines?: string[];
  /** Overall risk level of detected drift */
  risk_level?: 'LOW' | 'HIGH';
}

/**
 * Lifecycle event annotation marker displayed on TimesFM predictive telemetry charts (Grafana pattern).
 */
export interface ForecastEvent {
  /** Event classification type */
  type: 'DEPLOY' | 'DRIFT_DETECTED' | 'REMEDIATE' | 'CHAOS';
  /** ISO-8601 timestamp of the event */
  timestamp: string;
  /** Short event title */
  title: string;
  /** Detailed event narrative or impacted configuration */
  description: string;
  /** Ergonomic visual severity tone */
  severity: 'info' | 'warning' | 'critical' | 'success';
  /** Relative sample step index on the chart time axis */
  relative_index?: number;
}

/**
 * TimesFM 3.0 ML predictive telemetry time series with confidence interval bands and event markers.
 */
export interface Forecast {
  /** Device ID */
  device_id: number;
  /** Device hostname */
  hostname: string;
  /** Telemetry metric identifier (e.g., `cpu_utilization`, `memory_used`, `traffic_in`) */
  metric: string;
  /** Human-readable metric display name */
  label: string;
  /** Unit of measurement (e.g., `%`, `MB`, `Gbps`) */
  unit: string;
  /** Critical threshold level triggering proactive alerts */
  threshold: number;
  /** Whether the forecast was synthesized via local mock/heuristic fallback */
  simulated: boolean;
  /** Step interval between telemetry samples in seconds */
  step_seconds: number;
  /** ISO-8601 timestamp corresponding to the last sample point */
  end_ts?: string;
  /** Historical telemetry values */
  history: number[];
  /** TimesFM median prediction trajectory */
  median: number[];
  /** 10th percentile lower confidence bound */
  lower: number[];
  /** 90th percentile upper confidence bound */
  upper: number[];
  /** ML model provider string (e.g. `google/timesfm-1.0-200m`) */
  provider: string;
  /** Predicted time in minutes until threshold breach, or null if safe */
  breach_in_minutes: number | null;
  /** Correlated lifecycle event annotations to render on the forecast graph */
  events?: ForecastEvent[];
}

/**
 * Predictive breach warning generated by TimesFM telemetry extrapolation.
 */
export interface ForecastAlert {
  /** Target device ID */
  device_id: number;
  /** Target device hostname */
  hostname: string;
  /** Metric exceeding threshold */
  metric: string;
  /** Human-readable metric title */
  label: string;
  /** Threshold value that will be breached */
  threshold: number;
  /** Estimated time remaining in minutes before breach occurs */
  breach_in_minutes: number;
}

/**
 * One-Click Resolution action proposal embedded within an AI Copilot response.
 */
export interface CopilotAction {
  /** Action type executable directly by UI handlers */
  type: 'dry_run' | 'remediate' | 'open_device' | 'scan_drift' | 'open_diff';
  /** Button label presented to the operator */
  label: string;
  /** Target device ID if action applies to a single node */
  device_id?: number | null;
  /** Array of target device IDs if action applies to multiple nodes */
  device_ids?: number[];
  /** Additional action metadata or parameters */
  payload?: Record<string, unknown>;
}

/**
 * Response payload from contextual AI Copilot assistant.
 */
export interface CopilotReplyWithAction {
  /** Markdown-formatted reasoning and guidance text */
  answer: string;
  /** Active LLM provider or fallback descriptor */
  provider: string;
  /** Optional 1-Click Action Resolution proposal */
  action?: CopilotAction | null;
}

/**
 * Type alias for Copilot reply.
 */
export type CopilotReply = CopilotReplyWithAction;

/**
 * Immutable audit log record capturing out-of-band emergency Web CLI sessions.
 */
export interface EmergencyAuditLog {
  /** ISO-8601 execution timestamp */
  timestamp: string;
  /** Username or operator token that authorized the intervention */
  user: string;
  /** Action performed (`command`, `hot_patch`, `soft_reset`, `hard_reset`) */
  action: string;
  /** Target device identifier or `fabric` */
  device: string;
  /** Executed CLI command or applied patch content */
  payload: string;
  /** Operator-provided justification for audit compliance */
  reason: string;
  /** Whether the emergency execution succeeded */
  success: boolean;
  /** Output preview returned by device shell */
  output_preview: string;
}

/**
 * Telemetry anomaly detection verdict emitted by TimesFM AI Guard.
 */
export interface AiGuardResponse {
  /** Device hostname */
  hostname: string;
  /** Whether telemetry stream conforms to expected distribution */
  healthy: boolean;
  /** Evaluated metric name */
  metric: string;
  /** Currently observed live metric value */
  observed_value: number;
  /** Normal expected range `[min, max]` derived from TimesFM */
  expected_range: [number, number];
  /** Percentage deviation from expected normal baseline */
  deviation_pct: number;
  /** Inferred problem type (e.g. `SILENT_BLACKHOLE`, `TRAFFIC_STORM`), or null */
  problem: string | null;
  /** Human-readable diagnostic explanation */
  message: string;
  /** Anomaly detection provider */
  provider: string;
  /** Injected simulation tag if generated in Chaos Lab */
  injected_simulation: string | null;
}

/**
 * Fabric global mutation freeze state (Emergency Kill Switch).
 */
export interface FreezeStatus {
  /** Whether all mutating operations on the fabric are blocked */
  frozen: boolean;
  /** Operator justification or reason for freezing the fabric */
  reason?: string;
  /** ISO-8601 timestamp when freeze was engaged */
  frozen_at?: string;
  /** User or token that engaged the freeze */
  frozen_by?: string;
}

/**
 * RBAC User / Personal Invite account stored in PostgreSQL/SQLite (`users` table)
 * with single-device binding state (`1 link = 1 device`) and optional target system restriction.
 */
export interface UserAccount {
  id: number | null;
  username: string;
  role: 'viewer' | 'operator' | 'admin';
  is_active: boolean;
  active?: boolean;
  allowed_system: string | null;
  bound_client_id: string | null;
  bound_ip: string | null;
  bound_user_agent: string | null;
  bound_at: string | null;
  last_seen_at: string | null;
  expires_at?: string | null;
  telegram_chat_id?: string | null;
  telegram_username?: string | null;
  telegram_verified_at?: string | null;
  verification_code?: string | null;
  verification_expires_at?: string | null;
  created_at: string | null;
  updated_at?: string | null;
}

/**
 * Newly minted or rotated invite link credentials (token is returned once).
 */
export interface UserInviteCreated extends UserAccount {
  token: string;
}

/**
 * Git Source of Truth (SoT) repository & GitHub synchronization state.
 */
export interface GitStatusInfo {
  repo_path: string;
  github_repo_url: string;
  is_git_repo: boolean;
  branch?: string;
  commit_sha?: string;
  commit_short?: string;
  last_commit_message?: string;
  last_commit_at?: string;
  remote_url?: string;
  working_tree_clean?: boolean;
  modified_files?: string[];
  webhook_configured: boolean;
  auto_sync_on_push: boolean;
}

/**
 * Unified external integrations & database connectivity status.
 */
export interface TelegramBindingInfo {
  chat_id: number;
  username: string;
  tg_username?: string;
  first_name?: string;
  role: string;
  token?: string;
}

export interface SecurityEventEntry {
  timestamp: string;
  type: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
  message: string;
  username?: string | null;
  client_id?: string | null;
  client_ip?: string | null;
  telegram_chat_id?: string | null;
}

export interface IntegrationsStatus {
  sessions?: UserAccount[];
  user_tokens?: Record<string, string>;
  security_events?: SecurityEventEntry[];
  access_registry?: Record<string, unknown>;
  database: {
    engine: 'postgresql' | 'sqlite';
    status: string;
    counts: {
      devices: number;
      jobs: number;
      users: number;
      bound_sessions: number;
      metric_samples: number;
    };
  };
  github_sot: GitStatusInfo;
  netbox: {
    configured: boolean;
    url: string | null;
    mode: string;
  };
  prometheus: {
    configured: boolean;
    url: string | null;
    scrape_endpoint: string;
    collector_interval_sec: number;
  };
  telegram: {
    configured: boolean;
    bot_token_set: boolean;
    chat_ids: number[];
    bindings?: TelegramBindingInfo[];
    commands: string[];
  };
}

// ============================================================================
// API Client Implementation
// ============================================================================

const API_BASE = '/api/v1';

/**
 * Enterprise REST API client for CROC DREAM NetOps Platform.
 * Encapsulates authentication headers, error normalization, adaptive polling endpoints,
 * and high-reliability network operations.
 */
export class NetOpsApiClient {
  /** Active Bearer authentication token passed in `Authorization: Bearer <token>` header */
  private token: string;

  /**
   * Initializes a new instance of the NetOps API client.
   *
   * @param token - Initial Bearer authorization token (defaults to `'dev-admin-token'`)
   */
  constructor(token: string = 'dev-admin-token') {
    this.token = token;
  }

  /**
   * Sets or rotates the active authorization token.
   * Called dynamically when switching RBAC roles in the Header or Welcome modal.
   *
   * @param token - New Bearer token string
   */
  setToken(token: string): void {
    this.token = token;
    if (typeof window !== 'undefined') {
      localStorage.setItem('netops_token', token);
    }
  }

  /**
   * Retrieves the currently active authorization token.
   *
   * @returns Current Bearer token string
   */
  getToken(): string {
    return this.token;
  }

  /**
   * Returns a persistent unique client device fingerprint stored in localStorage.
   * Sent via `X-Client-ID` header to enforce `1 link = 1 device` session binding.
   */
  getClientId(): string {
    if (typeof window === 'undefined') return 'ssr-client';
    let clientId = localStorage.getItem('netops_client_id');
    if (!clientId) {
      const rand =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID().slice(0, 12)
          : Math.random().toString(36).slice(2, 10) + '-' + Date.now().toString(36);
      clientId = `dev-${rand}`;
      localStorage.setItem('netops_client_id', clientId);
    }
    return clientId;
  }

  /**
   * Internal generic HTTP request dispatcher.
   * Injects JSON headers, Bearer authorization, X-Client-ID device fingerprint, and standardizes error responses.
   *
   * @template T - Expected JSON response shape
   * @param endpoint - Relative endpoint path under `/api/v1`
   * @param options - Standard Fetch RequestInit options
   * @returns Promise resolving to deserialized response of type `T`
   * @throws {Error} When response status is non-2xx with parsed server detail message
   */
  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.token}`,
      'X-Client-ID': this.getClientId(),
      ...((options.headers as Record<string, string>) || {}),
    };

    const res = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      let message = res.statusText || `HTTP ${res.status}`;
      if (typeof err.detail === 'string') {
        message = err.detail;
      } else if (Array.isArray(err.detail)) {
        message = err.detail
          .map((d: { loc?: string[]; msg?: string }) => `${d.loc ? d.loc.slice(1).join('.') + ': ' : ''}${d.msg || d}`)
          .join('; ');
      } else if (err.detail) {
        message = JSON.stringify(err.detail);
      }
      throw new Error(message);
    }

    if (res.status === 204) {
      return undefined as T;
    }

    return res.json();
  }

  // --------------------------------------------------------------------------
  // Device & Topology Management
  // --------------------------------------------------------------------------

  /**
   * Retrieves the complete inventory of network devices and servers.
   * Used for dashboard KPI computation, device list tables, and 2D topology generation.
   *
   * @returns Promise resolving to an array of Device entities
   * @throws {Error} If network request fails or API is unreachable
   *
   * @example
   * ```ts
   * const devices = await api.getDevices();
   * console.log(`Loaded ${devices.length} fabric nodes`);
   * ```
   */
  async getDevices(): Promise<Device[]> {
    return this.request<Device[]>('/devices');
  }

  /**
   * Retrieves nodes and links for rendering the 2D network topology map.
   * Convenience alias synthesizing topology node data from device inventory.
   *
   * @returns Promise resolving to an array of Device entities representing topology nodes
   * @throws {Error} If network request fails or API is unreachable
   *
   * @example
   * ```ts
   * const topologyNodes = await api.getTopology();
   * ```
   */
  async getTopology(): Promise<Device[]> {
    return this.getDevices();
  }

  /**
   * Fetches detailed device profile including GitOps SoT Intent model,
   * interfaces, BGP routing configuration, and validation issues.
   *
   * @param id - Unique database ID of the device
   * @returns Promise resolving to comprehensive DeviceDetail entity
   * @throws {Error} If device is not found or request fails
   *
   * @example
   * ```ts
   * const device = await api.getDevice(1);
   * console.log(device.intent?.interfaces);
   * ```
   */
  async getDevice(id: number): Promise<DeviceDetail> {
    return this.request<DeviceDetail>(`/devices/${id}`);
  }

  /**
   * Executes a non-destructive SSH discovery probe against a target IP/port.
   * Gathers vendor OS, CPU/RAM/Disk resources, and LLDP neighbors prior to onboarding.
   *
   * @param data - Connection credentials and network coordinates
   * @returns Promise resolving to DeviceProbeResult
   * @throws {Error} If probe fails or SSH credentials are rejected
   *
   * @example
   * ```ts
   * const probe = await api.probeDevice({ management_ip: '5.228.243.54', management_port: 2201 });
   * if (probe.reachable) console.log(probe.detected_platform);
   * ```
   */
  async probeDevice(data: DeviceProbeRequest): Promise<DeviceProbeResult> {
    return this.request<DeviceProbeResult>('/devices/probe', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /**
   * Registers a newly onboarded device into the fabric inventory.
   * Devices default to `MONITORING_ONLY` mode for zero-trust safety until promoted.
   *
   * @param data - Device attributes including hostname, platform, role, and IP coordinates
   * @returns Promise resolving to created Device entity
   * @throws {Error} If validation fails or hostname already exists
   */
  async createDevice(data: Partial<Device> & { auth_profile?: string }): Promise<Device> {
    return this.request<Device>('/devices', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /**
   * Promotes a device from `MONITORING_ONLY` to `MANAGED` mode.
   * Unlocks GitOps configuration mutations, automated dry-runs, and transactional deployments.
   *
   * @param id - Unique device ID to promote
   * @returns Promise resolving to updated Device entity
   * @throws {Error} If device cannot be promoted or user lacks operator/admin privileges
   */
  async promoteDevice(id: number): Promise<Device> {
    return this.request<Device>(`/devices/${id}/promote`, {
      method: 'POST',
    });
  }

  /**
   * Dispatches an out-of-band emergency remediation command to a specific device.
   * Actions include rolling back the last commit, restarting BGP sessions, or rebooting.
   *
   * @param id - Unique device ID
   * @param data - Action specification and mandatory reason for audit
   * @returns Promise resolving to action execution status
   * @throws {Error} If action fails or device is unreachable
   */
  async deviceEmergencyAction(id: number, data: DeviceEmergencyAction): Promise<{ status: string; message: string }> {
    return this.request<{ status: string; message: string }>(`/devices/${id}/emergency-action`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /**
   * Deletes a device from the fabric inventory.
   *
   * @param id - Device ID to delete
   * @returns Promise resolving upon successful deletion
   * @throws {Error} If device does not exist or user lacks admin privileges
   */
  async deleteDevice(id: number): Promise<void> {
    return this.request<void>(`/devices/${id}`, {
      method: 'DELETE',
    });
  }

  /**
   * Synchronizes inventory from Git repository `inventory.yaml` Source of Truth.
   *
   * @returns Promise resolving to lists of created, updated, and unchanged device hostnames
   * @throws {Error} If Git synchronization fails or inventory schema is invalid
   */
  async syncInventory(): Promise<{ created: string[]; updated: string[]; unchanged: string[] }> {
    return this.request('/inventory/sync', { method: 'POST' });
  }

  // --------------------------------------------------------------------------
  // Automation Pipelines (Dry-Run & Deploy)
  // --------------------------------------------------------------------------

  /**
   * Initiates an asynchronous pre-flight Dry-Run pipeline for specified devices.
   * Pulls Git SoT intent, fetches current running-config, calculates hierarchical diff (hier_config),
   * and runs safety linter without modifying device state.
   *
   * @param deviceIds - Array of target device IDs to simulate
   * @returns Promise resolving to job ID and initial status
   * @throws {Error} If job creation fails or target device IDs are invalid
   *
   * @example
   * ```ts
   * const { job_id } = await api.createDryRun([1, 2]);
   * ```
   */
  async createDryRun(deviceIds: number[]): Promise<{ job_id: string; status: JobStatus }> {
    return this.request('/jobs/dry-run', {
      method: 'POST',
      body: JSON.stringify({ device_ids: deviceIds, intent_source: 'git_main' }),
    });
  }

  /**
   * Semantic alias for {@link createDryRun}.
   * Triggers pre-flight dry-run simulation for target devices.
   *
   * @param deviceIds - Array of target device IDs to simulate
   * @returns Promise resolving to job ID and initial status
   * @throws {Error} If job creation fails
   */
  async runDryRun(deviceIds: number[]): Promise<{ job_id: string; status: JobStatus }> {
    return this.createDryRun(deviceIds);
  }

  /**
   * Initiates transactional configuration deployment for a verified Dry-Run job.
   * Executes vendor-specific `commit confirmed 180` pattern with automatic health check
   * and automated 180s rollback guard in case of telemetry or connectivity loss.
   *
   * @param jobId - UUID of the preceding DRY_RUN job to apply
   * @param confirmedBy - Username or role confirming deployment execution (defaults to `'operator'`)
   * @returns Promise resolving to deployment job ID and status
   * @throws {Error} If job is invalid, already deployed, or lacks approval
   *
   * @example
   * ```ts
   * const deployJob = await api.createDeploy('job-uuid-123', 'admin');
   * ```
   */
  async createDeploy(jobId: string, confirmedBy: string = 'operator'): Promise<{ job_id: string; status: JobStatus }> {
    return this.request('/jobs/deploy', {
      method: 'POST',
      body: JSON.stringify({ job_id: jobId, confirmed_by: confirmedBy }),
    });
  }

  /**
   * Semantic alias for {@link createDeploy}.
   * Executes transactional deployment for a verified dry-run job.
   *
   * @param jobId - UUID of the dry-run job to apply
   * @param confirmedBy - Role authorizing deployment
   * @returns Promise resolving to deployment job ID and status
   * @throws {Error} If deployment cannot be initiated
   */
  async deployConfig(jobId: string, confirmedBy: string = 'operator'): Promise<{ job_id: string; status: JobStatus }> {
    return this.createDeploy(jobId, confirmedBy);
  }

  /**
   * Retrieves summary history of automation pipeline jobs.
   *
   * @param limit - Maximum number of jobs to return (defaults to 20)
   * @returns Promise resolving to an array of JobSummary items
   * @throws {Error} If job retrieval fails
   */
  async getJobs(limit = 20): Promise<JobSummary[]> {
    return this.request<JobSummary[]>(`/jobs?limit=${limit}`);
  }

  /**
   * Retrieves full details for an automation pipeline job including device targets and stage logs.
   *
   * @param id - Job UUID
   * @returns Promise resolving to detailed JobDetail entity
   * @throws {Error} If job is not found
   */
  async getJob(id: string): Promise<JobDetail> {
    return this.request<JobDetail>(`/jobs/${id}`);
  }

  /**
   * Retrieves incremental execution logs for a job after a specified log ID.
   * Used for terminal log polling and live stage tracing.
   *
   * @param id - Job UUID
   * @param afterId - Fetch logs strictly after this log ID (defaults to 0)
   * @returns Promise resolving to array of JobLog entries
   * @throws {Error} If job is not found
   */
  async getJobLogs(id: string, afterId = 0): Promise<JobLog[]> {
    return this.request<JobLog[]>(`/jobs/${id}/logs?after_id=${afterId}`);
  }

  /**
   * Retrieves hierarchical configuration diffs, remediation patches, and rollback commands for a job.
   * Rendered in Monaco Editor side-by-side or unified view in DiffViewer.
   *
   * @param id - Job UUID
   * @returns Promise resolving to JobDiff entity
   * @throws {Error} If diff data is not ready or job is not found
   */
  async getJobDiff(id: string): Promise<JobDiff> {
    return this.request<JobDiff>(`/jobs/${id}/diff`);
  }

  // --------------------------------------------------------------------------
  // Drift Detection & Remediation
  // --------------------------------------------------------------------------

  /**
   * Enqueues an asynchronous background job to scan devices for out-of-band configuration drift.
   *
   * @param deviceIds - Optional subset of device IDs to audit. If omitted, scans entire fabric.
   * @returns Promise resolving to drift scan job UUID and status
   * @throws {Error} If scan cannot be scheduled
   */
  async scanDrift(deviceIds?: number[]): Promise<{ job_id: string; status: JobStatus }> {
    const validIds = deviceIds && deviceIds.length > 0 ? deviceIds : null;
    return this.request('/drift/scan', {
      method: 'POST',
      body: JSON.stringify({ device_ids: validIds }),
    });
  }

  /**
   * Retrieves the current configuration compliance report across all devices in the fabric.
   * Highlights unauthorized extra lines and missing mandatory intent configuration.
   *
   * @returns Promise resolving to array of DriftReportItem entries
   * @throws {Error} If report retrieval fails
   */
  async getDriftReport(): Promise<DriftReportItem[]> {
    return this.request<DriftReportItem[]>('/drift/report');
  }

  /**
   * Triggers automated remediation of configuration drift on a specific device.
   * Generates a compensating hier_config patch to remove unauthorized lines and restore missing statements.
   *
   * @param deviceId - Device ID requiring drift correction
   * @returns Promise resolving to remediation job UUID and status
   * @throws {Error} If remediation cannot be scheduled
   */
  async remediateDrift(deviceId: number): Promise<{ job_id: string; status: JobStatus }> {
    return this.request('/drift/remediate', {
      method: 'POST',
      body: JSON.stringify({ device_id: deviceId }),
    });
  }

  // --------------------------------------------------------------------------
  // Intent Linting & Validation
  // --------------------------------------------------------------------------

  /**
   * Executes static schema and topological semantic linting on Git SoT intent files.
   * Validates IP subnet overlaps, BGP peer ASN symmetry, and interface MTU consistency.
   *
   * @returns Promise resolving to list of identified intent issues
   * @throws {Error} If intent parsing encounters a fatal syntax error
   */
  async lintIntent(): Promise<{ issues: Array<{ source: string; field: string; message: string; severity?: string }> }> {
    return this.request('/intent/lint');
  }

  // --------------------------------------------------------------------------
  // Chaos Engineering & Incident Simulation
  // --------------------------------------------------------------------------

  /**
   * Injects an incident or failure scenario in Chaos Lab to test operator response and automated guards.
   * Supported scenarios:
   * - `acl_drift`: Simulates rogue ACL modification on Cisco IOS-XE
   * - `huawei_drift`: Simulates out-of-band BGP peer change on Huawei VRP
   * - `port_down`: Drops an inter-switch spine-leaf link
   * - `ai_blackhole`: Causes silent drop of telemetry without link flapping
   * - `ai_storm`: Triggers artificial telemetry traffic load spike
   * - `reset_lab`: Resets fabric configurations back to Git SoT baseline
   *
   * @param scenario - Incident scenario key
   * @returns Promise resolving to operation status and confirmation message
   * @throws {Error} If chaos injection fails
   */
  async injectChaos(scenario: string): Promise<{ status: string; message: string }> {
    return this.request('/system/chaos', {
      method: 'POST',
      body: JSON.stringify({ scenario }),
    });
  }

  // --------------------------------------------------------------------------
  // AI Copilot & Risk Assessment
  // --------------------------------------------------------------------------

  /**
   * Invokes LLM Guard to analyze semantic risk and blast radius of planned configuration changes.
   *
   * @param jobId - Job UUID containing diffs to evaluate
   * @param hostname - Optional target hostname to isolate assessment to a single node
   * @returns Promise resolving to RiskExplanation with risk level and key mitigation points
   * @throws {Error} If LLM explanation fails or times out
   */
  async explainDiff(jobId: string, hostname?: string): Promise<RiskExplanation> {
    const query = hostname ? `?hostname=${encodeURIComponent(hostname)}` : '';
    return this.request<RiskExplanation>(`/jobs/${jobId}/explain${query}`, {
      method: 'POST',
    });
  }

  /**
   * Queries TimesFM 3.0 ML predictive telemetry model for a device metric.
   * Returns historical samples, median trajectory, upper/lower quantile bounds, and event annotations.
   *
   * @param deviceId - Target device ID
   * @param metric - Telemetry metric identifier (e.g. `cpu_utilization`, `memory_used`, `traffic_in`)
   * @param horizon - Forecast horizon in hours (defaults to 72)
   * @returns Promise resolving to Forecast series data
   * @throws {Error} If forecasting service is unavailable
   */
  async getForecast(deviceId: number, metric: string, horizon = 72): Promise<Forecast> {
    return this.request<Forecast>(`/devices/${deviceId}/forecast?metric=${metric}&horizon=${horizon}`);
  }

  /**
   * Retrieves active predictive breach warnings across the fabric (impending threshold crossings within 6h).
   *
   * @returns Promise resolving to list of ForecastAlert warnings
   * @throws {Error} If alert check fails
   */
  async getForecastAlerts(): Promise<ForecastAlert[]> {
    return this.request<ForecastAlert[]>('/forecast/alerts');
  }

  /**
   * Dispatches a message to the contextual AI Copilot assistant.
   * Automatically passes the active screen and selected device context to ensure concise, relevant answers.
   *
   * @param message - User inquiry or operational question
   * @param deviceId - Optional active device ID context
   * @param screen - Optional active screen identifier context (`dashboard`, `devices`, `diff`, etc.)
   * @returns Promise resolving to CopilotReplyWithAction containing text response and 1-Click Action proposal
   * @throws {Error} If copilot request fails
   */
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

  /**
   * Retrieves telemetry guard status overview from TimesFM AI Guard.
   * Detects silent packet blackholes, microloops, and telemetry anomalies.
   *
   * @returns Promise resolving to array of AiGuardResponse verdicts
   * @throws {Error} If guard status retrieval fails
   */
  async getAiGuardOverview(): Promise<AiGuardResponse[]> {
    return this.request<AiGuardResponse[]>('/ai-guard/overview');
  }

  // --------------------------------------------------------------------------
  // Emergency Hub / Manual Intervention (Zero-Trust RBAC)
  // --------------------------------------------------------------------------

  /**
   * Executes an out-of-band direct CLI diagnostic command over SSH on a device.
   * Restricted to Admin role; all executions are captured in immutable audit logs.
   *
   * @param device - Target device hostname
   * @param command - CLI command string to execute
   * @returns Promise resolving to CLI execution stdout/stderr and status
   * @throws {Error} If command fails or execution is rejected by RBAC
   */
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

  /**
   * Applies an emergency hot-patch configuration snippet directly to a device in bypass of GitOps.
   * Requires mandatory justification string for compliance audit.
   *
   * @param device - Target device hostname
   * @param patch - Raw CLI configuration statements to apply
   * @param reason - Mandatory justification for out-of-band intervention
   * @returns Promise resolving to patch application status and applied lines
   * @throws {Error} If patch application fails or is blocked
   */
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

  /**
   * Executes a Soft Reset of the fabric: reapplies Git SoT intended configurations to all nodes.
   * Eliminates all accumulated drift without destroying network virtual machines or container topologies.
   *
   * @returns Promise resolving to reset operation status and details
   * @throws {Error} If reset operation fails
   */
  async softResetFabric(): Promise<{ status: string; message: string; details: string }> {
    return this.request('/emergency/soft-reset', { method: 'POST' });
  }

  /**
   * Executes a Hard Reset of the fabric: destroys and redeploys Containerlab topology on server.
   * Factory restores the CLOS lab testbed to initial clean state.
   *
   * @returns Promise resolving to hard reset status and details
   * @throws {Error} If Containerlab redeployment fails
   */
  async hardResetFabric(): Promise<{ status: string; message: string; details: string }> {
    return this.request('/emergency/hard-reset', { method: 'POST' });
  }

  /**
   * Retrieves the immutable audit log of emergency Web CLI sessions and hot-patches.
   *
   * @returns Promise resolving to list of EmergencyAuditLog records
   * @throws {Error} If audit log retrieval fails
   */
  async getEmergencyAudit(): Promise<EmergencyAuditLog[]> {
    return this.request<EmergencyAuditLog[]>('/emergency/audit');
  }

  // --------------------------------------------------------------------------
  // Session, Sharing, Git SoT & Integrations Utilities
  // --------------------------------------------------------------------------

  /**
   * Returns current authenticated user profile and device binding status.
   */
  async getMe(): Promise<UserAccount> {
    return this.request<UserAccount>('/users/me');
  }

  /**
   * Lists all database-backed personal invite accounts and their device bindings.
   */
  async getUsers(): Promise<UserAccount[]> {
    return this.request<UserAccount[]>('/users');
  }

  /**
   * Creates a single personal invite token in the database.
   */
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

  /**
   * Generates a batch of N individual personal invite tokens at once (1 link = 1 device).
   */
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

  /**
   * Updates user role, active status (restrict/unrestrict), bound system scope, or token TTL.
   */
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

  /**
   * Generates a 6-digit verification code for linking a Telegram user to this participant and system.
   */
  async generateUserVerifyCode(userId: number): Promise<UserAccount> {
    return this.request<UserAccount>(`/users/${userId}/verify-code`, {
      method: 'POST',
    });
  }

  /**
   * Rotates a user's personal token and resets its device binding.
   */
  async rotateUserToken(userId: number): Promise<UserInviteCreated> {
    return this.request<UserInviteCreated>(`/users/${userId}/token`, {
      method: 'POST',
    });
  }

  /**
   * Unbinds the client device from a personal invite token so it can be used on another device.
   */
  async unbindUserDevice(userId: number): Promise<UserAccount> {
    return this.request<UserAccount>(`/users/${userId}/unbind`, {
      method: 'POST',
    });
  }

  /**
   * Revokes and deletes a personal invite token from the database.
   */
  async deleteUserInvite(userId: number): Promise<void> {
    return this.request<void>(`/users/${userId}`, {
      method: 'DELETE',
    });
  }

  /**
   * Retrieves Git Source of Truth (SoT) repository status and GitHub webhook configuration.
   */
  async getGitStatus(): Promise<GitStatusInfo> {
    return this.request<GitStatusInfo>('/git/status');
  }

  /**
   * Pulls latest changes from Git SoT remote (if configured) and syncs inventory.yaml into the database.
   */
  async syncGitSot(): Promise<{
    status: string;
    pull_output: string;
    sync: { created: string[]; updated: string[]; unchanged: string[] };
    git: GitStatusInfo;
  }> {
    return this.request('/git/sync', { method: 'POST' });
  }

  /**
   * Retrieves unified connectivity & metrics status for PostgreSQL/SQLite, GitHub SoT, NetBox, Prometheus, and Telegram Bot.
   */
  async getIntegrationsStatus(): Promise<IntegrationsStatus> {
    return this.request<IntegrationsStatus>('/system/integrations');
  }

  /**
   * Dispatches an executive fabric health & compliance report to Telegram Bot chats and returns a preview.
   */
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
   * Builds a direct share URL for any personal or preset token.
   * Defaults to public stand address (`http://5.228.243.54:5173`) when opened on localhost
   * so links shared with external teammates (e.g. Timofey / jury) work out-of-the-box.
   */
  buildInviteUrl(token: string, baseOverride?: string): string {
    if (baseOverride) {
      return `${baseOverride.replace(/\/$/, '')}/?token=${encodeURIComponent(token)}`;
    }
    if (typeof window !== 'undefined') {
      const savedBase = localStorage.getItem('netops_share_base_url');
      if (savedBase) {
        return `${savedBase.replace(/\/$/, '')}/?token=${encodeURIComponent(token)}`;
      }
      if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        return `http://5.228.243.54:5173/?token=${encodeURIComponent(token)}`;
      }
      return `${window.location.origin}${window.location.pathname}?token=${encodeURIComponent(token)}`;
    }
    return `http://5.228.243.54:5173/?token=${encodeURIComponent(token)}`;
  }

  /**
   * Generates a sharable URL pre-authenticated with the specified role token.
   * Enables one-click evaluation links for jury (`viewer`) or operations engineers (`admin`).
   *
   * @param role - Target authorization role (`viewer` or `admin`, defaults to `'viewer'`)
   * @returns Formatted URL string with embedded `?token=` parameter
   */
  getShareUrl(role: 'admin' | 'viewer' = 'viewer'): string {
    return this.buildInviteUrl(role === 'admin' ? 'dev-admin-token' : 'dev-jury-token');
  }

  /**
   * Retrieves the customized human-readable canvas/fabric name from local storage.
   *
   * @returns Fabric name string
   */
  getCanvasName(): string {
    return localStorage.getItem('netops_canvas_name') || 'Фабрика КРОК CLOS (Пром-кластер)';
  }

  /**
   * Saves the customized fabric canvas name into local storage.
   *
   * @param name - New canvas name
   */
  setCanvasName(name: string): void {
    localStorage.setItem('netops_canvas_name', name);
  }

  /**
   * Reads current user RBAC role from persistent storage.
   *
   * @returns UserRole currently configured
   */
  getRole(): UserRole {
    return (localStorage.getItem('netops_user_role') as UserRole) || 'owner';
  }

  /**
   * Updates user RBAC role in persistent storage and synchronizes the active Bearer token.
   *
   * @param role - New UserRole to assume
   */
  setRole(role: UserRole): void {
    localStorage.setItem('netops_user_role', role);
    this.setToken(ROLE_TOKENS[role]);
  }

  async getBootstrapStatus(): Promise<any> {
    return this.request<any>('/system/bootstrap/status');
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

  async recoverOwnerAccess(data: {
    action: 'request_telegram_code' | 'verify';
    recovery_key?: string;
    telegram_code?: string;
  }): Promise<any> {
    return this.request('/system/bootstrap/recover-owner', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async configureBootstrapLayers(data: {
    cluster_name?: string;
    github_repo_url?: string;
    github_pat?: string;
    webhook_public_url?: string;
    telegram_bot_token?: string;
    telegram_chat_id?: string;
    groq_api_key?: string;
    gemini_api_key?: string;
    ollama_url?: string;
    bootstrap_completed?: boolean;
  }): Promise<any> {
    return this.request('/system/bootstrap/configure', {
      method: 'POST',
      body: JSON.stringify(data),
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
  }): Promise<any> {
    return this.request('/system/bootstrap/discover-server', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }
}

// ============================================================================
// Authentication & Singleton Initialization
// ============================================================================

/**
 * Predefined development and evaluation Bearer tokens mapped by RBAC role.
 */
export const ROLE_TOKENS: Record<UserRole, string> = {
  owner: 'dev-owner-token',
  admin: 'dev-admin-token',
  operator: 'dev-operator-token',
  viewer: 'dev-viewer-token',
};

/**
 * Resolves initial Bearer authentication token and RBAC role from URL parameters or persistent storage.
 * URL parameter `?token=...` takes precedence and automatically completes onboarding.
 *
 * @returns Object containing active Bearer token and resolved UserRole
 */
function resolveInitialAuth(): { token: string; role: UserRole } {
  if (typeof window === 'undefined') {
    return { token: 'dev-owner-token', role: 'owner' };
  }

  const params = new URLSearchParams(window.location.search);
  const urlToken = params.get('token');

  if (urlToken) {
    let role: UserRole = 'viewer';
    if (urlToken.includes('owner')) role = 'owner';
    else if (urlToken.includes('admin')) role = 'admin';
    else if (urlToken.includes('operator')) role = 'operator';
    else if (urlToken.includes('jury') || urlToken.includes('viewer')) role = 'viewer';

    localStorage.setItem('netops_token', urlToken);
    localStorage.setItem('netops_user_role', role);
    localStorage.setItem('netops_onboarding_done', 'true');
    return { token: urlToken, role };
  }

  const savedRole = (localStorage.getItem('netops_user_role') as UserRole) || 'owner';
  const savedToken = localStorage.getItem('netops_token');

  return {
    token: savedToken || ROLE_TOKENS[savedRole] || 'dev-owner-token',
    role: savedRole,
  };
}

const initialAuth = resolveInitialAuth();

/**
 * Global singleton instance of {@link NetOpsApiClient} pre-configured with active session credentials.
 */
export const api = new NetOpsApiClient(initialAuth.token);
