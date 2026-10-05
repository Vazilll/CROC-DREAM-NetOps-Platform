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
  },
};
