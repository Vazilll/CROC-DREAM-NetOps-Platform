# NetOps Frontend — документация клиентского ядра

Добро пожаловать в клиентское ядро платформы **CROC DREAM NetOps Platform**. Этот документ написан для разработчиков и сетевых инженеров команды: он объясняет, как устроен фронтенд, за что отвечает каждый каталог и модуль, как работают темы оформления (`Dark` / `Light`), локализация (`RU` / `EN`), ролевая модель (`RBAC`) и потоковая телеметрия.

Стек: **React 19.2 · TypeScript 5.9 (`strict`, `0 any`) · Vite 8 · Tailwind CSS 3.4 · Lucide Icons · Playwright E2E · Oxlint**.

---

## Оглавление

1. [Быстрый старт (за 1 минуту)](#1-быстрый-старт-за-1-минуту)
2. [Общая архитектура и потоки данных](#2-общая-архитектура-и-потоки-данных)
3. [Структура каталогов](#3-структура-каталогов)
4. [Подробное описание каждого модуля](#4-подробное-описание-каждого-модуля)
   - [4.1. Ядро приложения (`src/api.ts`, `src/App.tsx`, `src/i18n.ts`, `src/constants.ts`)](#41-ядро-приложения)
   - [4.2. Каркас и атомарная дизайн-система (`src/components/layout/`)](#42-каркас-и-атомарная-дизайн-система-srccomponentslayout)
   - [4.3. Рабочие экраны и вкладки (`src/components/views/`)](#43-рабочие-экраны-и-вкладки-srccomponentsviews)
   - [4.4. Модальные окна, дроверы и визарды (`src/components/modals/`)](#44-модальные-окна-дроверы-и-визарды-srccomponentsmodals)
   - [4.5. Визуализация графа и прогнозов (`src/components/charts/`)](#45-визуализация-графа-и-прогнозов-srccomponentscharts)
5. [Дизайн-система, темы (`Dark` / `Light`) и локализация (`RU` / `EN`)](#5-дизайн-система-темы-dark--light-и-локализация-ru--en)
6. [Матрица ролевого доступа (RBAC во фронтенде)](#6-матрица-ролевого-доступа-rbac-во-фронтенде)
7. [Горячие клавиши NOC-оператора](#7-горячие-клавиши-noc-оператора)
8. [Проверка качества, сборка и E2E-тесты](#8-проверка-качества-сборка-и-e2e-тесты)

---

## 1. Быстрый старт (за 1 минуту)

### Вариант А — Локальная разработка с хот-релоадом

Убедитесь, что бэкенд запущен на `http://127.0.0.1:8001` (или переопределите `VITE_API_URL`), после чего выполните:

```bash
cd frontend
npm install
npm run dev
```

Откройте в браузере:
- **Основной интерфейс NOC**: http://127.0.0.1:5173
- **Принудительный запуск визарда первичной настройки («Матрёшка»)**: http://127.0.0.1:5173/?setup=1

Vite автоматически проксирует запросы `/api/v1/*` и WebSocket-соединения на локальный бэкенд (`127.0.0.1:8001`).

### Вариант Б — Продакшн-сборка и проверка типов

```bash
npm --prefix frontend run build      # Строгая проверка tsc -b + сборка чанков Vite
npx --prefix frontend oxlint frontend/src/  # Статический анализ (0 warnings, 0 errors)
```

---

## 2. Общая архитектура и потоки данных

Фронтенд спроектирован по принципу **Zero-Page-Reload Single Page Application (SPA)** с агрессивным разделением бандлов (`React.lazy` + `Suspense`) и гибридной синхронизацией состояния:

```
┌───────────────────────────────────────────────────────────────────────────┐
│                         App.tsx (Root Orchestrator)                       │
│  • Тема (dark/light) · Локаль (ru/en) · Роль (viewer/operator/admin/owner)│
│  • Фоновый пуллинг (8s) с глубоким сравнением ссылок (areDevicesEqual)     │
│  • Одноразовые WebSocket-билеты (/ws/ticket -> /ws/stream)                │
└───────────────┬───────────────────────────────┬───────────────────────────┘
                │                               │
                ▼                               ▼
┌───────────────────────────────┐ ┌─────────────────────────────────────────┐
│   Eager Shell (мгновенный)    │ │   Lazy-Loaded Chunks (по требованию)    │
│ • Header / Sidebar / MobileNav│ │ • views/* (DevicePage, DiffViewer, ...) │
│ • Dashboard + TopologyMap (2D)│ │ • modals/* (WelcomeModal, ShareModal)   │
│ • CommandPalette (Ctrl+K)     │ │ • charts/Topology3D (3D Canvas/WebGL)   │
└───────────────┬───────────────┘ └─────────────────────┬───────────────────┘
                │                                       │
                └───────────────────┬───────────────────┘
                                    ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                   src/api.ts (Strict Typed HTTP/WS Client)                │
│  • Единая обёртка request<T>() с таймаутами (AbortSignal.timeout)         │
│  • Автоматическая подстановка Bearer JWT + обработка 401/403/503          │
│  • 100% строгая типизация ответов API (0 типов any во всём проекте)       │
└───────────────────────────────────────────────────────────────────────────┘
```

### Ключевые инженерные решения:
1. **Защита от лишних перерисовок (`Zero-Flicker Polling`)**: функции `areDevicesEqual()` и `areJobsEqual()` в [`App.tsx`](file:///home/tarhes/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/app/CROC-DREAM-NetOps-Platform/frontend/src/App.tsx) проверяют поля объектов при каждом 8-секундном цикле опроса. Если данные не изменились, ссылка на массив сохраняется, и дочерние мемоизированные компоненты (`TopologyMap`, `Dashboard`) не перерисовываются.
2. **Изоляция тяжёлых чанков**: 13 вторичных экранов и модальных окон загружаются лениво через `React.lazy()`. Начальный экран NOC загружает только каркас и `Dashboard`.
3. **Семантические CSS-токены**: переключение темы (`dark` / `light`) мгновенно меняет CSS-переменные на корневом `<html>` без пересоздания дерева компонентов.

---

## 3. Структура каталогов

Все 30 исходных файлов в `frontend/src/` строго распределены по функциональным слоям:

```
frontend/
├── index.html                  # Точка входа HTML, шрифты Inter + JetBrains Mono
├── package.json                # Зависимости и скрипты сборки
├── tailwind.config.js          # Конфигурация Tailwind CSS и кастомных анимаций
├── tsconfig.app.json           # Строгий конфиг TypeScript (strict: true)
├── vite.config.ts              # Конфиг сборщика Vite, manualChunks и dev-proxy
├── README.md                   # Этот документ (руководство по модулям фронтенда)
├── ARCHITECTURE.md             # Диаграммы последовательностей (Mermaid) и матрица хуков
├── tests/
│   └── audit_all_views_e2e.py  # Сквозной Playwright E2E-аудит всех вкладок и модалок
└── src/
    ├── main.tsx                # Монтирование React 19 createRoot в DOM
    ├── App.tsx                 # Корневой оркестратор состояния, роутинга вкладок и хоткеев
    ├── api.ts                  # Типизированный REST/WebSocket клиент и интерфейсы домена
    ├── constants.ts            # Словари платформ, ролей узлов и метаданные навигации
    ├── i18n.ts                 # Словари локализации интерфейса (RU / EN)
    ├── index.css               # Семантические CSS-переменные тем (Dark / Light) и утилиты
    └── components/
        ├── layout/             # Каркас приложения и атомарные UI-примитивы (5 модулей)
        │   ├── Header.tsx
        │   ├── Sidebar.tsx
        │   ├── MobileNav.tsx
        │   ├── CommandPalette.tsx
        │   └── ui.tsx
        ├── views/              # Основные полноэкранные рабочие области (9 модулей)
        │   ├── Dashboard.tsx
        │   ├── DeviceList.tsx
        │   ├── DevicePage.tsx
        │   ├── DiffViewer.tsx
        │   ├── DriftView.tsx
        │   ├── JobsView.tsx
        │   ├── ChaosLabView.tsx
        │   ├── EmergencyHub.tsx
        │   └── SlidesPresentation.tsx
        ├── modals/             # Модальные окна, визарды и боковые панели (8 модулей)
        │   ├── WelcomeModal.tsx
        │   ├── ShareModal.tsx
        │   ├── DryRunModal.tsx
        │   ├── AddDeviceModal.tsx
        │   ├── DeviceDrawer.tsx
        │   ├── DeviceDetailModal.tsx
        │   ├── CopilotPanel.tsx
        │   └── ShortcutsModal.tsx
        └── charts/             # Графы топологии и графики временных рядов (3 модуля)
            ├── TopologyMap.tsx
            ├── Topology3D.tsx
            └── ForecastChart.tsx
```

---

## 4. Подробное описание каждого модуля

### 4.1. Ядро приложения

| Файл | За что отвечает и как работает |
|------|--------------------------------|
| [`src/main.tsx`](file:///home/tarhes/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/app/CROC-DREAM-NetOps-Platform/frontend/src/main.tsx) | Точка инициализации React 19 (`createRoot`). Оборачивает `<App />` в `<StrictMode>` и подключает глобальную таблицу стилей `index.css`. |
| [`src/App.tsx`](file:///home/tarhes/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/app/CROC-DREAM-NetOps-Platform/frontend/src/App.tsx) | Главный контроллер состояния: хранит активную вкладку (`activeTab`), список устройств (`devices`), задач (`jobs`), режим контура (`online` SSH vs `offline` эмуляция), статус аварийной заморозки (`Factory Freeze`), тему (`dark`/`light`), язык (`ru`/`en`) и текущую роль пользователя (`viewer`/`operator`/`admin`/`owner`). Управляет WebSocket-подпиской, глобальными хоткеями (`Ctrl+K`, `?`, `g+d`, `g+n`, `g+j`, `g+c`, `g+f`, `g+s`, `g+e`) и системой всплывающих уведомлений (toasts). |
| [`src/api.ts`](file:///home/tarhes/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/app/CROC-DREAM-NetOps-Platform/frontend/src/api.ts) | Единый слой взаимодействия с бэкендом (`/api/v1/*`). Содержит строго типизированные интерфейсы всех сущностей (`Device`, `DeviceDetail`, `JobSummary`, `JobDiff`, `DriftReportItem`, `Forecast`, `AiGuardResponse`, `BootstrapStatusResponse`, `AccessRegistryResponse` и др.), хелпер извлечения ошибок `getErrorMessage(err: unknown)` и методы API с таймаутами `AbortSignal.timeout`. |
| [`src/constants.ts`](file:///home/tarhes/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/app/CROC-DREAM-NetOps-Platform/frontend/src/constants.ts) | Единый источник констант отображения: человекочитаемые названия платформ (`PLATFORM_NAMES`: Cisco IOS-XE, Arista EOS, Huawei VRP, Juniper Junos, Eltex MES, YADRO KORNFE), ролей устройств (`ROLE_NAMES`: Spine, Leaf, Edge, Core) и конфигурация вкладок сайдбара (`TAB_DEFINITIONS`). |
| [`src/i18n.ts`](file:///home/tarhes/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/app/CROC-DREAM-NetOps-Platform/frontend/src/i18n.ts) | Полный двуязычный словарь интерфейса (`translations.ru` и `translations.en`). Обеспечивает мгновенное переключение языка во всех компонентах без перезагрузки страницы. |
| [`src/index.css`](file:///home/tarhes/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/app/CROC-DREAM-NetOps-Platform/frontend/src/index.css) | Определяет CSS-переменные цветовой палитры для `:root` (Dark Mode по умолчанию) и `html.theme-light` (Light Mode), а также переопределения контрастности по стандартам Vercel Geist и Yandex Gravity UI. |

---

### 4.2. Каркас и атомарная дизайн-система (`src/components/layout/`)

Модули этого каталога формируют постоянную оболочку интерфейса и предоставляют переиспользуемые визуальные блоки.

| Модуль | За что отвечает | Ключевые возможности |
|--------|-----------------|----------------------|
| [`Header.tsx`](file:///home/tarhes/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/app/CROC-DREAM-NetOps-Platform/frontend/src/components/layout/Header.tsx) | Верхняя панель управления NOC | Отображает пульс фабрики (онлайн/всего узлов, сфокусированные алерты), переключатель контура (`ONLINE SSH` / `OFFLINE LAB`), переключатель аварийной заморозки (`Factory Freeze`), кнопки вызова `Dry-Run`, `Share/Access`, `AI Copilot`, переключатель языка (`RU`/`EN`), темы (`Dark`/`Light`) и текущей роли оператора. |
| [`Sidebar.tsx`](file:///home/tarhes/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/app/CROC-DREAM-NetOps-Platform/frontend/src/components/layout/Sidebar.tsx) | Левая панель навигации | Группирует экраны по доменам («Мониторинг», «Автоматизация», «Надёжность», «Презентация»), показывает счётчики активных дрейфов и задач, скрывает или блокирует вкладки в соответствии с ролью (`RBAC`) и позволяет сворачивать панель в компактный режим. |
| [`MobileNav.tsx`](file:///home/tarhes/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/app/CROC-DREAM-NetOps-Platform/frontend/src/components/layout/MobileNav.tsx) | Мобильная навигация | Обеспечивает адаптивную работу на планшетах и смартфонах дежурных инженеров: нижний док быстрых вкладок и выдвижное бургер-меню с переключателями темы, языка и контура. |
| [`CommandPalette.tsx`](file:///home/tarhes/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/app/CROC-DREAM-NetOps-Platform/frontend/src/components/layout/CommandPalette.tsx) | Глобальная палитра команд (`Ctrl+K`) | Мгновенный поиск по узлам фабрики (по hostname, IP, платформе, роли), быстрый переход между экранами и запуск операций (`Dry-Run`, синхронизация инвентаря, переключение темы) с клавиатуры. |
| [`ui.tsx`](file:///home/tarhes/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/app/CROC-DREAM-NetOps-Platform/frontend/src/components/layout/ui.tsx) | Атомарная библиотека компонентов | Содержит `BentoCard` (карточка с подсветкой границ), `StatusBadge` (бейджи `in_sync`/`drifted`/`unreachable` + `up`/`degraded`/`down`), `JobStatusBadge`, `Sparkline` (SVG-микрографик телеметрии), `Modal`, `EmptyState`, `Skeleton` и `CopyButton`. |

---

### 4.3. Рабочие экраны и вкладки (`src/components/views/`)

Каждый файл в `views/` представляет собой самостоятельную рабочую область, открываемую при выборе соответствующего раздела в `Sidebar` или `CommandPalette`.

| Модуль | Вкладка | За что отвечает и как работает |
|--------|---------|--------------------------------|
| [`Dashboard.tsx`](file:///home/tarhes/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/app/CROC-DREAM-NetOps-Platform/frontend/src/components/views/Dashboard.tsx) | `dashboard` | Главный экран NOC в стиле Bento Grid. Объединяет: (1) KPI-карточки здоровья фабрики, (2) интерактивную карту топологии `TopologyMap`, (3) панель `AI Pre-Flight Guard` (проверка безопасности изменений), (4) радар прогнозов Statistical Forecast по аномалиям CPU и трафика, (5) ленту последних пайплайнов и быстрый запуск `Golden Baseline` / `Remediate All`. |
| [`DeviceList.tsx`](file:///home/tarhes/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/app/CROC-DREAM-NetOps-Platform/frontend/src/components/views/DeviceList.tsx) | `devices` | Табличный реестр всех сетевых устройств фабрики. Поддерживает фильтрацию по статусу/платформе/роли, поиск, инлайн-редактирование IP и учётных профилей, точечный `Ping/SSH Probe`, синхронизацию `inventory.yaml` и переход в глубокую диагностику узла. |
| [`DevicePage.tsx`](file:///home/tarhes/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/app/CROC-DREAM-NetOps-Platform/frontend/src/components/views/DevicePage.tsx) | `device-detail` | Полноэкранный диагностический центр конкретного маршрутизатора/коммутатора. Включает 5 суб-вкладок: **Overview & Telemetry** (живые графики CPU/RAM/Uplink + прогноз Statistical Forecast), **Running Config & Snapshots** (просмотр и сравнение снапшотов), **BGP & Interfaces** (таблицы пиров и портов), **Intent YAML** (декларативный профиль узла) и **Audit & Quick CLI** (выполнение диагностических команд). |
| [`DiffViewer.tsx`](file:///home/tarhes/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/app/CROC-DREAM-NetOps-Platform/frontend/src/components/views/DiffViewer.tsx) | `diff` | Инспектор конфигурационных различий (`running` vs `candidate`). Подсвечивает добавленные (`+`) и удалённые (`-`) строки CLI, фильтрует шум (`diff_filters.yaml`) и вызывает LLM-анализатор (`POST /jobs/{id}/explain`) для оценки blast radius и рисков перед выкаткой. |
| [`DriftView.tsx`](file:///home/tarhes/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/app/CROC-DREAM-NetOps-Platform/frontend/src/components/views/DriftView.tsx) | `drift` | Центр контроля конфигурационного дрейфа. Показывает какие узлы отклонились от эталонного Git Source of Truth (`intent/network_intent.yaml`), визуализирует diff-сниппеты каждого отклонения и позволяет запустить точечное или массовое авто-восстановление (`Remediate`). |
| [`JobsView.tsx`](file:///home/tarhes/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/app/CROC-DREAM-NetOps-Platform/frontend/src/components/views/JobsView.tsx) | `jobs` | Журнал оркестрации пайплайнов (`plan`, `apply`, `rollback`, `remediate`). Отображает пошаговый прогресс выполнения задачи по каждому устройству (`validate` → `render` → `diff` → `push` → `verify`), тайминги и кнопку мгновенного отката (`Rollback`) к предыдущему снапшоту. |
| [`ChaosLabView.tsx`](file:///home/tarhes/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/app/CROC-DREAM-NetOps-Platform/frontend/src/components/views/ChaosLabView.tsx) | `chaos` | Стенд Chaos Engineering для проверки устойчивости сети. Позволяет безопасно инжектировать сценарии сбоев (несанкционированный CLI-дрейф, падение BGP-сессии на Spine, перегрузка аплинка Leaf) и наблюдать, как платформа детектирует и автоматически устраняет аварию. |
| [`EmergencyHub.tsx`](file:///home/tarhes/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/app/CROC-DREAM-NetOps-Platform/frontend/src/components/views/EmergencyHub.tsx) | `emergency` | Аварийный пульт управления (`Out-of-Band Console`), доступный только ролям `admin` и `owner`. Содержит: прямой мульти-вендорный CLI-терминал (`show`/`display`), экстренный патч в обход пайплайна, двухступенчатый сброс стенда (**Soft Reset** через Golden Intent и **Hard Reset** через пересборку Containerlab) и неизменяемый журнал аудита (`emergency_audit.jsonl`). |
| [`SlidesPresentation.tsx`](file:///home/tarhes/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/app/CROC-DREAM-NetOps-Platform/frontend/src/components/views/SlidesPresentation.tsx) | `slides` | Встроенная интерактивная презентация архитектуры платформы CROC DREAM NetOps для демонстрации жюри и заказчикам прямо из интерфейса NOC. |

---

### 4.4. Модальные окна, дроверы и визарды (`src/components/modals/`)

Модули из `modals/` открываются поверх текущего экрана для выполнения целевых сценариев настройки, проверки и управления доступом.

| Модуль | За что отвечает и как работает |
|--------|--------------------------------|
| [`WelcomeModal.tsx`](file:///home/tarhes/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/app/CROC-DREAM-NetOps-Platform/frontend/src/components/modals/WelcomeModal.tsx) | **4-шаговый визард первичной инициализации («Матрёшка»)**. Состоит из стартового сплэш-экрана (`Boot Splash`) и 4 шагов настройки: (1) подключение Telegram-бота и привязка владельца (`Owner`), (2) выбор режима (`ONLINE SSH` с проверкой сокетов до Containerlab или `OFFLINE` эмуляция), (3) валидация и авто-заполнение учётных данных узлов (`Credentials Matrix`), (4) привязка GitHub Source of Truth (`PAT` + `Webhook Secret`). Полностью поддерживает переключение тем (`Dark`/`Light`) и языков (`RU`/`EN`) прямо внутри визарда. |
| [`ShareModal.tsx`](file:///home/tarhes/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/app/CROC-DREAM-NetOps-Platform/frontend/src/components/modals/ShareModal.tsx) | **Центр управления доступом (RBAC & IAM) и интеграциями**. Позволяет просматривать реестр участников, выпускать именные JWT-токены с ограничением времени жизни (`TTL`) и области видимости (`Allowed Scopes`), управлять привязками Telegram-аккаунтов, просматривать журнал событий безопасности и синхронизировать Git Source of Truth (`Pull` / `Push`). |
| [`DryRunModal.tsx`](file:///home/tarhes/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/app/CROC-DREAM-NetOps-Platform/frontend/src/components/modals/DryRunModal.tsx) | **Модальное окно Pre-Flight Dry-Run (`Plan`) и выкатки (`Apply`)**. Позволяет выбрать целевые устройства (или всю фабрику), сгенерировать план изменений без записи в сеть, просмотреть сводку затронутых узлов и при отсутствии блокировок запустить боевой деплой. |
| [`AddDeviceModal.tsx`](file:///home/tarhes/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/app/CROC-DREAM-NetOps-Platform/frontend/src/components/modals/AddDeviceModal.tsx) | **Визард регистрации нового сетевого устройства**. Поддерживает живое зондирование (`POST /devices/probe`) IP-адреса и SSH-порта перед добавлением, выбор вендора (`Cisco IOS-XE`, `Arista EOS`, `Huawei VRP`, `Juniper Junos`, `Eltex MES`, `YADRO KORNFE`), роли (`Spine`, `Leaf`, `Edge`) и автоматическую запись в `inventory.yaml`. |
| [`DeviceDrawer.tsx`](file:///home/tarhes/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/app/CROC-DREAM-NetOps-Platform/frontend/src/components/modals/DeviceDrawer.tsx) | **Боковая шторка быстрой инспекции узла**. Открывается при клике по узлу на дашборде без ухода с главного экрана: показывает текущие метрики CPU/RAM/Uplink, статус синхронизации, последний снапшот и кнопки быстрого перехода в `DevicePage` или запуска `Dry-Run`. |
| [`DeviceDetailModal.tsx`](file:///home/tarhes/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/app/CROC-DREAM-NetOps-Platform/frontend/src/components/modals/DeviceDetailModal.tsx) | **Инспектор декларативного YAML-интента узла**. Вызывается с карты топологии (`TopologyMap`) по кнопке «Инспектор Intent (YAML)»: отображает BGP ASN, Router ID, список L3-интерфейсов, таблицу BGP-соседей и сгенерированный целевой YAML-профиль устройства. |
| [`CopilotPanel.tsx`](file:///home/tarhes/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/app/CROC-DREAM-NetOps-Platform/frontend/src/components/modals/CopilotPanel.tsx) | **Боковая панель ИИ-ассистента (`NetOps Copilot`)**. Ведёт диалог с инженером на естественном языке с учётом живого состояния фабрики (`POST /copilot`), предлагает готовые кнопки действий (`Action Chips` для перехода к проблемному узлу, открытия diff или запуска проверки) и объясняет причины аварий. |
| [`ShortcutsModal.tsx`](file:///home/tarhes/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/app/CROC-DREAM-NetOps-Platform/frontend/src/components/modals/ShortcutsModal.tsx) | **Справочник горячих клавиш (`?`)**. Наглядная шпаргалка по всем клавиатурным сокращениям платформы для быстрой навигации без мыши. |

---

### 4.5. Визуализация графа и прогнозов (`src/components/charts/`)

Модули визуализации отвечают за рендеринг топологии фабрики CLOS и предиктивной аналитики временных рядов.

| Модуль | За что отвечает и как работает |
|--------|--------------------------------|
| [`TopologyMap.tsx`](file:///home/tarhes/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/app/CROC-DREAM-NetOps-Platform/frontend/src/components/charts/TopologyMap.tsx) | **Интерактивная 2D/3D карта топологии CLOS-фабрики**. Строит иерархический SVG-граф (`Spine` ↔ `Leaf` ↔ `Edge`), анимирует пакетные потоки по линкам, подсвечивает узлы с дрейфом (`amber`), недоступностью (`rose`) или прогнозируемым исчерпанием SLA по Statistical Forecast (`purple`), содержит всплывающий поповер быстрых действий (`Ping`, `Dry-Run`, `Инспектор Intent`) и переключатель в 3D-режим. |
| [`Topology3D.tsx`](file:///home/tarhes/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/app/CROC-DREAM-NetOps-Platform/frontend/src/components/charts/Topology3D.tsx) | **Трёхмерная изометрическая визуализация фабрики (3D Canvas)**. Отрисовывает разнесённые по высоте плоскости `Spine Tier`, `Leaf Tier` и `Edge Tier` с вращением камеры, пульсацией трафика по межъ.ярусным линкам и интерактивным выбором узлов. Загружается лениво только при включении режима `3D View`. |
| [`ForecastChart.tsx`](file:///home/tarhes/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/app/CROC-DREAM-NetOps-Platform/frontend/src/components/charts/ForecastChart.tsx) | **График предиктивной аналитики Statistical Forecast**. Отрисовывает исторический ряд метрики (`cpu_pct` или `uplink_util_pct`), горизонт прогноза ИИ, закрашенный коридор доверительного интервала (`p10`–`p90`), линию порога SLA (`threshold`) и вертикальные маркеры сетевых событий (`deploy`, `rollback`, `drift`). |

---

## 5. Дизайн-система, темы (`Dark` / `Light`) и локализация (`RU` / `EN`)

Платформа построена по стандартам корпоративных систем мониторинга (**Vercel Geist / Datadog / Yandex Gravity UI**):

1. **Две полноценные темы оформления (`Dark` и `Light`)**:
   - **Dark Mode (`:root`)**: глубокий обсидиановый фон `#050507`, карточки `#0c0d12`, приподнятые поверхности `#12141c`, текст `#f4f4f5`, акценты `cyan-400` / `emerald-400`.
   - **Light Mode (`html.theme-light`)**: чистый инженерный светлый фон `#f8fafc`, карточки `#ffffff`, поверхности `#f1f5f9`, высококонтрастный текст `#0f172a` (Slate-900).
   - Выбранная тема сохраняется в `localStorage['netops_theme']` и доступна для переключения как в `Header`, так и на всех шагах начального визарда `WelcomeModal`.
2. **Мгновенная двуязычность (`RU` / `EN`)**:
   - Переключатель языка в `Header` и в `WelcomeModal` сохраняет выбор в `localStorage['netops_locale']` и реактивно переводит все подписи, статусы и подсказки.

---

## 6. Матрица ролевого доступа (RBAC во фронтенде)

Фронтенд синхронизирует текущую роль из JWT-токена (`GET /api/v1/users/me`) и адаптирует доступные действия:

| Действие / Экран | `viewer` (Наблюдатель) | `operator` (Инженер NOC) | `admin` (Администратор) | `owner` (Владелец платформы) |
|------------------|:----------------------:|:------------------------:|:-----------------------:|:----------------------------:|
| Просмотр дашборда, топологии, Diff, задач и прогнозов | ✅ | ✅ | ✅ | ✅ |
| Запуск `Dry-Run (Plan)` и ИИ-объяснения рисков | ✅ | ✅ | ✅ | ✅ |
| Выкатка изменений (`Apply`), `Rollback`, `Remediate` | ❌ | ✅ | ✅ | ✅ |
| Добавление и редактирование узлов (`AddDeviceModal`) | ❌ | ✅ | ✅ | ✅ |
| Инъекция сбоев в `Chaos Lab` | ❌ | ✅ | ✅ | ✅ |
| Аварийный пульт `Emergency Hub` (прямой CLI, Soft/Hard Reset, Freeze) | ❌ | ❌ | ✅ | ✅ |
| Управление ролями, выпуск токенов и визард «Матрёшка» (`ShareModal`, `WelcomeModal`) | ❌ | ❌ | ✅ (чтение/токены) | ✅ (полный контроль) |

---

## 7. Горячие клавиши NOC-оператора

Для скоростной работы дежурной смены без использования мыши в [`App.tsx`](file:///home/tarhes/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/app/CROC-DREAM-NetOps-Platform/frontend/src/App.tsx) реализованы глобальные хоткеи (отключаются, когда фокус находится в `<input>` или `<textarea>`):

| Комбинация | Действие |
|------------|----------|
| `Ctrl + K` / `Cmd + K` | Открыть глобальную палитру команд (`CommandPalette`) |
| `?` | Открыть шпаргалку по горячим клавишам (`ShortcutsModal`) |
| `Esc` | Закрыть активное модальное окно, дровер или палитру |
| `g` затем `d` | Перейти на **Главный дашборд (`Dashboard`)** |
| `g` затем `n` | Перейти в **Реестр устройств (`DeviceList`)** |
| `g` затем `j` | Перейти в **Историю задач (`JobsView`)** |
| `g` затем `c` | Перейти в **Инспектор изменений (`DiffViewer`)** |
| `g` затем `f` | Перейти в **Контроль дрейфа (`DriftView`)** |
| `g` затем `s` | Перейти в **Chaos Lab (`ChaosLabView`)** |
| `g` затем `e` | Перейти в **Аварийный пульт (`EmergencyHub`)** |

---

## 8. Проверка качества, сборка и E2E-тесты

Перед каждым коммитом во фронтенд выполняйте три быстрые проверки:

```bash
# 1. Строгая проверка типов TypeScript (0 any) и продакшн-сборка чанков
npm --prefix frontend run build

# 2. Сверхбыстрый линтер Oxlint (проверка правил React Hooks, неиспользуемых переменных и типизации)
npx --prefix frontend oxlint frontend/src/

# 3. Сквозной E2E-аудит всех вкладок и модальных окон через Playwright (при запущенных серверах)
backend/.venv/bin/python frontend/tests/audit_all_views_e2e.py
```
