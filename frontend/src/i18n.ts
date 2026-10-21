import { en } from './locales/en';
import { ru } from './locales/ru';

export type Locale = 'ru' | 'en';

export interface Translations {
  // Common
  appName: string;
  appSub: string;
  online: string;
  offline: string;
  loading: string;
  save: string;
  cancel: string;
  close: string;
  confirm: string;
  refresh: string;
  search: string;
  status: string;
  role: string;
  cluster: string;
  tokens: string;

  // Header & AI
  aiCopilot: string;
  aiAssistant: string;
  toggleTheme: string;
  themeDark: string;
  themeLight: string;
  langSwitch: string;
  openWelcome: string;
  connectedTo: string;

  // Roles
  roleOwner: string;
  roleAdmin: string;
  roleOperator: string;
  roleViewer: string;

  // Sidebar Groups & Tabs
  groupOverview: string;
  tabDashboard: string;
  tabTopology: string;

  groupInventory: string;
  tabDevices: string;

  groupAutomation: string;
  tabJobs: string;
  tabDiff: string;
  tabDrift: string;

  groupTesting: string;
  tabLab: string;
  tabEmergency: string;

  // Dashboard Metric Cards
  cardDevices: string;
  cardDevicesNormal: string;
  cardInSync: string;
  cardDrift: string;
  cardUnreachable: string;
  cardAiGuard: string;
  cardAiGuardStatus: string;

  // Dashboard Sections
  topologyTitle: string;
  allDevices: string;
  topologyStand: string;
  topologyCrocTier: string;
  nodesCount: string;
  platformsTitle: string;
  rolesTitle: string;
  uplinkUtil: string;
  openBtn: string;
  diffBtn: string;
  dryRunBtn: string;
  automationJobsTitle: string;
  auditLogBtn: string;
  noRunsYet: string;

  // Device Actions & Deletion
  addDeviceBtn: string;
  syncInventoryBtn: string;
  deleteDeviceBtn: string;
  deleteSelectedBtn: string;
  deleteConfirm: string;
  deleteSuccess: string;
  deleteError: string;
  realDataSynced: string;

  // Windows Welcome Modal
  winHello: string;
  winSettingUp: string;
  winJustAMoment: string;
  winWelcomeTitle: string;
  winWelcomeDesc: string;
  winChooseMode: string;

  // Option 1: Become Owner
  optOwnerTitle: string;
  optOwnerBadge: string;
  optOwnerDesc: string;
  optClusterNameLabel: string;
  optClusterNamePlaceholder: string;
  btnBecomeOwner: string;

  // Option 2: Connect to Existing System
  optConnectTitle: string;
  optConnectBadge: string;
  optConnectDesc: string;
  optServerUrlLabel: string;
  optTokenLabel: string;
  optTokenPlaceholder: string;
  optSelectPresetToken: string;
  btnConnect: string;

  // Toast & Notifications
  toastOwnerSuccess: string;
  toastConnectSuccess: string;

  // Jobs View
  jobsHistoryTitle: string;
  noJobsYet: string;
  startedAt: string;
  author: string;
  viewDiffBtn: string;
  applyDeployBtn: string;
  targetDevicesTitle: string;
  liveTelemetryTitle: string;
  emptyLogs: string;
  selectJobHint: string;
  exportAuditReport: string;

  // Diff Viewer
  diffTitle: string;
  modeDiff: string;
  modeRemediation: string;
  modeRollback: string;
  aiSecurityAudit: string;
  btnAnalyzeAI: string;
  riskLow: string;
  riskMedium: string;
  riskHigh: string;
  riskCritical: string;
  noDiffFound: string;

  // Drift View
  complianceTitle: string;
  nodesInStandard: string;
  driftDetectedTitle: string;
  requireRemediation: string;
  scanDriftBtn: string;
  remediateBtn: string;
  exportComplianceAct: string;

  // Chaos Lab
  chaosTitle: string;
  chaosSub: string;
  scenario1Title: string;
  scenario2Title: string;
  scenario3Title: string;
  scenarioResetTitle: string;
  btnInject: string;
  btnResetLab: string;

  // Dry Run Modal
  dryRunTitle: string;
  dryRunDesc: string;
  blastRadiusTitle: string;
  radiusLow: string;
  radiusMedium: string;
  radiusHigh: string;
  affectedNodes: string;
  btnStartDryRun: string;

  // AI Copilot
  copilotTitle: string;
  copilotPlaceholder: string;
  copilotSuggestion1: string;
  copilotSuggestion2: string;
  copilotSuggestion3: string;
}

export const translations: Record<Locale, Translations> = {
  ru,
  en,
};
