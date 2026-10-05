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

  groupInventory: string;
  tabDevices: string;

  groupAutomation: string;
  tabJobs: string;
  tabDiff: string;
  tabDrift: string;

  groupTesting: string;
  tabLab: string;

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
  riskRadarTitle: string;
  radarAnomCount: string;
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
  ru: {
    appName: 'NetOps Platform',
    appSub: 'CROC DREAM · Сетевая фабрика',
    online: 'В сети',
    offline: 'Нет связи',
    loading: 'Загрузка...',
    save: 'Сохранить',
    cancel: 'Отмена',
    close: 'Закрыть',
    confirm: 'Подтвердить',
    refresh: 'Обновить',
    search: 'Поиск по платформе...',
    status: 'Статус',
    role: 'Роль',
    cluster: 'Кластер',
    tokens: 'Токены',

    aiCopilot: 'ИИ',
    aiAssistant: 'ИИ Ассистент',
    toggleTheme: 'Сменить тему (Тёмная / Светлая)',
    themeDark: 'Тёмная',
    themeLight: 'Светлая',
    langSwitch: 'Язык',
    openWelcome: 'Подключение / Роли',
    connectedTo: 'Подключено к',

    roleOwner: 'Владелец (Owner)',
    roleAdmin: 'Администратор',
    roleOperator: 'Оператор',
    roleViewer: 'Аудитор (Viewer)',

    groupOverview: 'ОБЗОР',
    tabDashboard: 'Дашборд',

    groupInventory: 'ИНВЕНТАРЬ',
    tabDevices: 'Устройства',

    groupAutomation: 'АВТОМАТИЗАЦИЯ',
    tabJobs: 'Пайплайны',
    tabDiff: 'Diff & AI Guard',
    tabDrift: 'Контроль дрейфа',

    groupTesting: 'ТЕСТИРОВАНИЕ',
    tabLab: 'Chaos Lab',

    cardDevices: 'Оборудование',
    cardDevicesNormal: 'норма',
    cardInSync: 'В синхроне (SoT)',
    cardDrift: 'Дрейф конфигураций',
    cardUnreachable: 'Недоступные узлы',
    cardAiGuard: 'TimesFM 3.0 Guard',
    cardAiGuardStatus: 'ACTIVE Shield OK',

    topologyTitle: 'Топология CLOS фабрики',
    allDevices: 'Все устройства',
    topologyStand: 'CLOS Дата-центр (Стенд)',
    topologyCrocTier: 'Иерархия КРОК (Enterprise 3-Tier)',
    nodesCount: 'узлов',
    platformsTitle: 'Платформы оборудования',
    rolesTitle: 'Роли в фабрике',
    riskRadarTitle: 'Предиктивный радар рисков (TimesFM, 6ч)',
    radarAnomCount: 'аномал.',
    uplinkUtil: 'Загрузка аплинка',
    openBtn: 'Открыть',
    diffBtn: 'Diff',
    dryRunBtn: 'Dry-run',
    automationJobsTitle: 'Задачи автоматизации',
    auditLogBtn: 'Журнал',
    noRunsYet: 'Запусков пока нет',

    addDeviceBtn: 'Добавить сервер / устройство',
    syncInventoryBtn: 'Синхронизировать инвентарь',
    deleteDeviceBtn: 'Удалить',
    deleteSelectedBtn: 'Удалить выбранные',
    deleteConfirm: 'Удалить устройство из фабрики?',
    deleteSuccess: 'Устройство успешно удалено!',
    deleteError: 'Ошибка удаления устройства',
    realDataSynced: 'Настоящие данные сетевого стенда КРОК успешно загружены!',

    winHello: 'Привет',
    winSettingUp: 'Подготовка среды NetOps Platform...',
    winJustAMoment: 'Секундочку...',
    winWelcomeTitle: 'Добро пожаловать в NetOps Platform',
    winWelcomeDesc: 'Платформа централизованного управления разнородной сетевой инфраструктурой CROC DREAM.',
    winChooseMode: 'Выберите способ запуска:',

    optOwnerTitle: 'Стать владельцем',
    optOwnerBadge: 'Root Authority',
    optOwnerDesc: 'Инициализация новой сетевой фабрики с нуля. Вы получаете полные права Root Owner для управления кластером и выпуска ключей.',
    optClusterNameLabel: 'Имя сетевой фабрики / кластера',
    optClusterNamePlaceholder: 'например, CROC-FABRIC-PROD-01',
    btnBecomeOwner: 'Инициализировать как Владелец',

    optConnectTitle: 'Подключиться к готовой системе',
    optConnectBadge: 'Существующий кластер',
    optConnectDesc: 'Подключение к уже развернутой сетевой фабрике по адресу сервера и выданному токену доступа.',
    optServerUrlLabel: 'Адрес сервера API',
    optTokenLabel: 'Токен доступа (Bearer Token)',
    optTokenPlaceholder: 'вставьте выданный токен...',
    optSelectPresetToken: 'Или выберите тестовую роль:',
    btnConnect: 'Подключиться к системе',

    toastOwnerSuccess: 'Вы вошли как Владелец сетевой фабрики!',
    toastConnectSuccess: 'Успешное подключение к фабрике!',

    // Jobs View
    jobsHistoryTitle: 'История Пайплайнов',
    noJobsYet: 'Задачи еще не запускались',
    startedAt: 'Запуск',
    author: 'Автор',
    viewDiffBtn: 'Просмотр Diff →',
    applyDeployBtn: 'Применить Деплой',
    targetDevicesTitle: 'Целевые Устройства',
    liveTelemetryTitle: 'Журнал Выполнения (Live Telemetry)',
    emptyLogs: 'Логи отсутствуют или отфильтрованы',
    selectJobHint: 'Выберите задачу для просмотра телеметрии и деталей выполнения',
    exportAuditReport: 'Экспорт протокола аудита (MD)',

    // Diff Viewer
    diffTitle: 'Сверка конфигураций (Hierarchical Diff)',
    modeDiff: 'Сравнение (Diff)',
    modeRemediation: 'Патч наката (Remediation)',
    modeRollback: 'Откат (Rollback)',
    aiSecurityAudit: 'ИИ Аудит Безопасности (TimesFM 3.0)',
    btnAnalyzeAI: 'Анализировать через ИИ',
    riskLow: 'Низкий риск',
    riskMedium: 'Средний риск',
    riskHigh: 'Высокий риск',
    riskCritical: 'Критический риск',
    noDiffFound: 'Расхождений не обнаружено (In Sync)',

    // Drift View
    complianceTitle: 'Комплаенс Фабрики',
    nodesInStandard: 'узлов в эталоне',
    driftDetectedTitle: 'Дрейф Конфигураций',
    requireRemediation: 'требуют компенсации',
    scanDriftBtn: 'Запустить полный скан дрейфа',
    remediateBtn: 'Устранить дрейф',
    exportComplianceAct: 'Скачать Акт Комплаенса',

    // Chaos Lab
    chaosTitle: 'Chaos Lab: Симулятор Аварийных Сценариев',
    chaosSub: 'Проверка устойчивости сети, мульти-вендорности и отката через TimesFM 3.0',
    scenario1Title: 'Внепроцессный Дрейф ACL (Cisco)',
    scenario2Title: 'Дрейф на Huawei VRP',
    scenario3Title: 'Падение межузлового линка (Port Down)',
    scenarioResetTitle: 'Сброс стенда к чистому Git SoT',
    btnInject: 'Внедрить',
    btnResetLab: 'Сбросить к Git SoT',

    // Dry Run Modal
    dryRunTitle: 'Префлайт Прогон (Dry-Run)',
    dryRunDesc: 'Моделирование изменений без прямого воздействия на сеть',
    blastRadiusTitle: 'Оценка радиуса поражения (Blast Radius)',
    radiusLow: 'Низкий (Локальный)',
    radiusMedium: 'Средний (Группа узлов)',
    radiusHigh: 'Высокий (Фабричный транзит)',
    affectedNodes: 'Затронутые узлы',
    btnStartDryRun: 'Запустить Dry-Run',

    // AI Copilot
    copilotTitle: 'Сетевой Ассистент (AI Copilot)',
    copilotPlaceholder: 'Спросите о состоянии сети, дрейфе или рисках...',
    copilotSuggestion1: 'Что с дрейфом в фабрике?',
    copilotSuggestion2: 'Какие риски прогнозируются по TimesFM?',
    copilotSuggestion3: 'Запустить проверку готовности к деплою',
  },
  en: {
    appName: 'NetOps Platform',
    appSub: 'CROC DREAM · Network Fabric',
    online: 'Online',
    offline: 'Offline',
    loading: 'Loading...',
    save: 'Save',
    cancel: 'Cancel',
    close: 'Close',
    confirm: 'Confirm',
    refresh: 'Refresh',
    search: 'Search platform...',
    status: 'Status',
    role: 'Role',
    cluster: 'Cluster',
    tokens: 'Tokens',

    aiCopilot: 'AI',
    aiAssistant: 'AI Assistant',
    toggleTheme: 'Toggle Theme (Dark / Light)',
    themeDark: 'Dark',
    themeLight: 'Light',
    langSwitch: 'Language',
    openWelcome: 'Connection / Roles',
    connectedTo: 'Connected to',

    roleOwner: 'Owner (Root)',
    roleAdmin: 'Administrator',
    roleOperator: 'Operator',
    roleViewer: 'Auditor (Viewer)',

    groupOverview: 'OVERVIEW',
    tabDashboard: 'Dashboard',

    groupInventory: 'INVENTORY',
    tabDevices: 'Devices',

    groupAutomation: 'AUTOMATION',
    tabJobs: 'Pipelines',
    tabDiff: 'Diff & AI Guard',
    tabDrift: 'Drift Control',

    groupTesting: 'TESTING',
    tabLab: 'Chaos Lab',

    cardDevices: 'Hardware Devices',
    cardDevicesNormal: 'healthy',
    cardInSync: 'In Sync (SoT)',
    cardDrift: 'Config Drift',
    cardUnreachable: 'Unreachable Nodes',
    cardAiGuard: 'TimesFM 3.0 Guard',
    cardAiGuardStatus: 'ACTIVE Shield OK',

    topologyTitle: 'CLOS Fabric Topology',
    allDevices: 'All Devices',
    topologyStand: 'CLOS Datacenter (Lab)',
    topologyCrocTier: 'CROC Hierarchy (Enterprise 3-Tier)',
    nodesCount: 'nodes',
    platformsTitle: 'Hardware Platforms',
    rolesTitle: 'Fabric Roles',
    riskRadarTitle: 'Predictive Risk Radar (TimesFM, 6h)',
    radarAnomCount: 'anom.',
    uplinkUtil: 'Uplink utilization',
    openBtn: 'Open',
    diffBtn: 'Diff',
    dryRunBtn: 'Dry-run',
    automationJobsTitle: 'Automation Pipelines',
    auditLogBtn: 'Audit Log',
    noRunsYet: 'No execution records yet',

    addDeviceBtn: 'Add Server / Switch',
    syncInventoryBtn: 'Sync Inventory',
    deleteDeviceBtn: 'Delete',
    deleteSelectedBtn: 'Delete Selected',
    deleteConfirm: 'Delete device from fabric?',
    deleteSuccess: 'Device deleted successfully!',
    deleteError: 'Failed to delete device',
    realDataSynced: 'Real CROC network lab devices synchronized successfully!',

    winHello: 'Hello',
    winSettingUp: 'Preparing your NetOps Platform environment...',
    winJustAMoment: 'Just a moment...',
    winWelcomeTitle: 'Welcome to NetOps Platform',
    winWelcomeDesc: 'Centralized intent-driven control plane for heterogeneous networks by CROC DREAM.',
    winChooseMode: 'Choose setup method:',

    optOwnerTitle: 'Become Owner',
    optOwnerBadge: 'Root Authority',
    optOwnerDesc: 'Initialize a new network fabric from scratch. You receive full Root Owner authority to manage the cluster and issue access keys.',
    optClusterNameLabel: 'Network Fabric / Cluster Identifier',
    optClusterNamePlaceholder: 'e.g. CROC-FABRIC-PROD-01',
    btnBecomeOwner: 'Initialize as Owner',

    optConnectTitle: 'Connect to Existing System',
    optConnectBadge: 'Existing Cluster',
    optConnectDesc: 'Connect to an already running network fabric using server URL and delegated access token.',
    optServerUrlLabel: 'API Server Endpoint',
    optTokenLabel: 'Access Token (Bearer Token)',
    optTokenPlaceholder: 'enter your bearer token...',
    optSelectPresetToken: 'Or select a quick profile:',
    btnConnect: 'Connect to Cluster',

    toastOwnerSuccess: 'Initialized and connected as Root Owner!',
    toastConnectSuccess: 'Connected to existing network fabric!',

    // Jobs View
    jobsHistoryTitle: 'Pipeline History',
    noJobsYet: 'No pipelines executed yet',
    startedAt: 'Started',
    author: 'Author',
    viewDiffBtn: 'View Diff →',
    applyDeployBtn: 'Apply Deployment',
    targetDevicesTitle: 'Target Devices',
    liveTelemetryTitle: 'Execution Log (Live Telemetry)',
    emptyLogs: 'No logs found or filtered',
    selectJobHint: 'Select a pipeline to inspect live telemetry and execution details',
    exportAuditReport: 'Export Audit Log (MD)',

    // Diff Viewer
    diffTitle: 'Hierarchical Diff Inspection',
    modeDiff: 'Side-by-Side Diff',
    modeRemediation: 'Remediation Patch',
    modeRollback: 'Rollback Patch',
    aiSecurityAudit: 'AI Security Audit (TimesFM 3.0)',
    btnAnalyzeAI: 'Analyze with AI',
    riskLow: 'Low Risk',
    riskMedium: 'Medium Risk',
    riskHigh: 'High Risk',
    riskCritical: 'Critical Risk',
    noDiffFound: 'No discrepancies detected (In Sync)',

    // Drift View
    complianceTitle: 'Fabric Compliance',
    nodesInStandard: 'nodes matching intent',
    driftDetectedTitle: 'Configuration Drift',
    requireRemediation: 'require remediation',
    scanDriftBtn: 'Run Full Drift Scan',
    remediateBtn: 'Remediate Drift',
    exportComplianceAct: 'Download Compliance Act',

    // Chaos Lab
    chaosTitle: 'Chaos Lab: Fault Injection Simulator',
    chaosSub: 'Resilience, multi-vendor compliance & auto-rollback verification with TimesFM 3.0',
    scenario1Title: 'Out-of-band ACL Drift (Cisco)',
    scenario2Title: 'Huawei VRP ACL Drift',
    scenario3Title: 'Inter-switch Port Down',
    scenarioResetTitle: 'Reset Fabric to Clean Git SoT',
    btnInject: 'Inject',
    btnResetLab: 'Reset to Git SoT',

    // Dry Run Modal
    dryRunTitle: 'Pre-flight Verification (Dry-Run)',
    dryRunDesc: 'Simulating configuration changes without impacting live network',
    blastRadiusTitle: 'Blast Radius Assessment',
    radiusLow: 'Low (Local scope)',
    radiusMedium: 'Medium (Multi-node)',
    radiusHigh: 'High (Core transit)',
    affectedNodes: 'Affected Nodes',
    btnStartDryRun: 'Execute Dry-Run',

    // AI Copilot
    copilotTitle: 'Network Copilot (AI)',
    copilotPlaceholder: 'Ask about network health, drift, or risk forecast...',
    copilotSuggestion1: 'What is the current fabric drift status?',
    copilotSuggestion2: 'What risks are forecasted by TimesFM?',
    copilotSuggestion3: 'Run pre-flight deployment readiness check',
  },
};
