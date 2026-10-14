# CROC DREAM — NetOps Platform

**Платформа централизованного управления, транзакционной оркестрации и предиктивного мониторинга гетерогенной сетевой инфраструктуры.**

**Команда:** CROC DREAM  
**Статус:** Полная готовность к защите (сборка `tsc -b` + `vite` зелёная, `oxlint` 0 ошибок, все модульные и интеграционные тесты `pytest` проходят на 100%).

---

## Навигатор по документации модулей (Git Module Guides)

Каждый блок репозитория снабжён собственной подробной инструкцией с описанием архитектуры, файлов и контрактов:

| Модуль / Каталог | Инструкция | За что отвечает блок |
|------------------|------------|----------------------|
| **`backend/`** | [**`backend/README.md`**](file:///home/tarhes/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/app/CROC-DREAM-NetOps-Platform/backend/README.md) | Серверное ядро FastAPI, PostgreSQL/SQLite + Alembic, Celery/Redis, транзакционные пайплайны `dry-run` / `deploy` / `drift`, драйверы `Scrapli` и `OfflineLab`, Statistical Forecast, `AI Guard`, `Emergency Hub`, `FastMCP` |
| **`frontend/`** | [**`frontend/README.md`**](file:///home/tarhes/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/app/CROC-DREAM-NetOps-Platform/frontend/README.md) | Клиентское ядро NOC (React 19 + TypeScript 5.9, `0 any`), раскладка по папкам `layout/`, `views/`, `modals/`, `charts/`, темы `Dark`/`Light`, локализация `RU`/`EN`, визард «Матрёшка», хоткеи |
| **`intent/`** | [**`intent/README.md`**](file:///home/tarhes/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/app/CROC-DREAM-NetOps-Platform/intent/README.md) | Git Source of Truth: реестр устройств `inventory.yaml`, декларативные профили узлов `devices/*.yaml` и правила нормализации `diff_filters.yaml` |
| **`templates/`** | [**`templates/README.md`**](file:///home/tarhes/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/app/CROC-DREAM-NetOps-Platform/templates/README.md) | Мульти-вендорный движок шаблонов Jinja2 (`StrictUndefined`) для 6 сетевых ОС (`Cisco IOS-XE`, `Arista EOS`, `Huawei VRP`, `Eltex MES`, `Juniper Junos`, `YADRO KORNFE`) |
| **`lab/`** | [**`lab/README.md`**](file:///home/tarhes/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/app/CROC-DREAM-NetOps-Platform/lab/README.md) | Лабораторный стенд CLOS: эталонные конфигурации `golden_configs/`, файловый эмулятор `running/` и скрипт сброса `reset_lab.sh` |
| **`scripts/`** | [**`scripts/README.md`**](file:///home/tarhes/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/app/CROC-DREAM-NetOps-Platform/scripts/README.md) | CLI-утилиты самодиагностики (`doctor.py`), проверки SSH-стенда (`verify_live_lab.py`), сброса (`reset_lab.py`) и демо-прогона (`automate_netops.py`) |
| **`docs/`** | [**`docs/backend-architecture.md`**](file:///home/tarhes/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/app/CROC-DREAM-NetOps-Platform/docs/backend-architecture.md) | Глубокое описание внутренней архитектуры бэкенда, конечного автомата задач и правил Post-Check (`docs/templates-integration.md`, `docs/LIVE_LAB_GUIDE.md`) |
| **`mobile/`** | [**`mobile/README.md`**](file:///home/tarhes/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/app/CROC-DREAM-NetOps-Platform/mobile/README.md) | Мобильный компаньон дежурного инженера NOC |

---

## Содержание

1. [Что это за проект](#1-что-это-за-проект)
2. [Поддерживаемые вендоры (6 платформ)](#2-поддерживаемые-вендоры-6-платформ)
3. [Текущий статус модулей](#3-текущий-статус-модулей)
4. [Архитектура и структура репозитория](#4-архитектура-и-структура-репозитория)
5. [Быстрый старт](#5-быстрый-старт)
6. [Сквозной демо-сценарий (для защиты)](#6-сквозной-демо-сценарий-для-защиты)

---

## 1. Что это за проект

Платформа централизованного управления разнородной сетевой инфраструктурой по методологии **Intent-Based Networking (IBN)** и **GitOps**:
- Инженер описывает целевое состояние сети (Intent) в вендор-независимом YAML (`intent/devices/*.yaml`).
- Платформа выполняет **Pre-Flight Lint** всей фабрики (проверка пересечений IP/масок, дублей Router ID и ASN).
- Рендерит целевые конфигурации через Jinja2-шаблоны под конкретного вендора, очищает `running-config` от динамического шума и строит минимальный иерархический патч (`hier_config`) и зеркальный патч отката (`rollback_patch`).
- Проверяет патч через **AI Pre-Flight Guard**, требует явного подтверждения оператора, выкатывает изменения транзакционно (`commit confirmed` / `configure session`) с автоматической верификацией **Post-Check** (BGP Established, префиксы, порты `up/up`, потери ping ≤ 20%) и авто-откатом при сбое.
- Каждые 15 минут сканирует сеть на конфигурационный дрейф (**Drift Engine**) и прогнозирует исчерпание ресурсов CPU и аплинков с помощью модели временных рядов **Statistical Forecast**.

**Ключевой сквозной конвейер:**

`Git/YAML Intent → Pre-Flight Lint → Jinja2 Render → Dry-Run & Hier-Diff → AI Guard & Approval → Transactional Deploy / Auto-Rollback → Drift & Statistical Forecast Monitoring`

---

## 2. Поддерживаемые вендоры (6 платформ)

Платформа поддерживает **6 сетевых платформ**, включая российских производителей (**Eltex**, **YADRO**):

| Вендор | Платформа (`Platform`) | Роль в стенде / Назначение | Шаблоны Jinja2 | Нормализация и Diff | Драйвер (`Scrapli` + `Offline`) |
|--------|------------------------|----------------------------|:--------------:|:-------------------:|:-------------------------------:|
| **Cisco** | `cisco_iosxe` (c8000v / CSR1000v) | `spine-1.croc.lab` (Spine-ядро CLOS) | ✅ `templates/cisco_iosxe/` | ✅ `hier_config` + фильтры | ✅ Реализован и проверен |
| **Arista** | `arista_eos` (cEOS 4.32) | `spine-2.croc.lab` (Spine-ядро CLOS) | ✅ `templates/arista_eos/` | ✅ `hier_config` + фильтры | ✅ Реализован и проверен |
| **Huawei** | `huawei_vrp` (CloudEngine CE12800) | `leaf-1`, `leaf-2` (Leaf-уровень CLOS) | ✅ `templates/huawei_vrp/` | ✅ `undo`-генератор + фильтры | ✅ Реализован и проверен |
| **Eltex** | `eltex_mes` / `eltex_esr` | Российский вендор (Leaf / Edge) | ✅ `templates/eltex_mes/` | ✅ `hier_config` + фильтры | ✅ Реализован и проверен |
| **YADRO** | `yadro_kornfe` (KORNFE SONiC) | Российский вендор ЦОД (Leaf / Spine) | ✅ `templates/yadro_kornfe/` | ✅ Фильтры секций | ✅ Реализован |
| **Juniper** | `juniper_junos` (vMX / vQFX) | Магистральный Edge / Core | ✅ `templates/juniper_junos/` | ✅ Фильтры секций | ✅ Реализован |

---

## 3. Текущий статус модулей

| Подсистема | Статус | Где реализовано |
|------------|--------|-----------------|
| **Backend Core (FastAPI + SQLAlchemy 2.0 + Alembic + Celery/Redis)** | ✅ Готово (100% тестов проходят) | [`backend/netops/`](file:///home/tarhes/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/app/CROC-DREAM-NetOps-Platform/backend/netops) |
| **Pre-Flight Intent Linter & Pydantic Schema** | ✅ Готово (`inventory.yaml` и `devices/*.yaml` синхронизированы) | [`backend/netops/intent/`](file:///home/tarhes/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/app/CROC-DREAM-NetOps-Platform/backend/netops/intent) |
| **Multi-Vendor Jinja2 Templates (6 платформ)** | ✅ Готово (`base`, `interfaces`, `acls`, `bgp`) | [`templates/`](file:///home/tarhes/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/app/CROC-DREAM-NetOps-Platform/templates) |
| **Иерархический Diff и Нормализация CLI** | ✅ Готово (`hier_config` + `diff_filters.yaml`) | [`backend/netops/network/`](file:///home/tarhes/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/app/CROC-DREAM-NetOps-Platform/backend/netops/network) |
| **Двойной сетевой контур (`Scrapli SSH` + `OfflineLab`)** | ✅ Готово (переключение на лету в UI и API) | [`scrapli_driver.py`](file:///home/tarhes/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/app/CROC-DREAM-NetOps-Platform/backend/netops/network/scrapli_driver.py), [`offline.py`](file:///home/tarhes/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/app/CROC-DREAM-NetOps-Platform/backend/netops/network/offline.py) |
| **Предиктивная аналитика Statistical Forecast + `AI Pre-Flight Guard`** | ✅ Готово (квантили `p10–p90`, ETA пробития SLA, блокировка опасных патчей) | [`forecast.py`](file:///home/tarhes/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/app/CROC-DREAM-NetOps-Platform/backend/netops/services/forecast.py), [`ai_guard.py`](file:///home/tarhes/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/app/CROC-DREAM-NetOps-Platform/backend/netops/services/ai_guard.py) |
| **Аварийный пульт `Emergency Hub` и `Factory Freeze`** | ✅ Готово (прямой CLI, экстренный патч, Soft/Hard Reset, Kill Switch) | [`emergency.py`](file:///home/tarhes/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/app/CROC-DREAM-NetOps-Platform/backend/netops/api/routes/emergency.py), [`EmergencyHub.tsx`](file:///home/tarhes/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/app/CROC-DREAM-NetOps-Platform/frontend/src/components/views/EmergencyHub.tsx) |
| **4-шаговый визард «Матрёшка» (`WelcomeModal`)** | ✅ Готово (Telegram Owner, SSH Probe, матрица паролей, GitHub SoT, `Dark`/`Light`, `RU`/`EN`) | [`system.py`](file:///home/tarhes/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/app/CROC-DREAM-NetOps-Platform/backend/netops/api/routes/system.py), [`WelcomeModal.tsx`](file:///home/tarhes/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/app/CROC-DREAM-NetOps-Platform/frontend/src/components/modals/WelcomeModal.tsx) |
| **Frontend NOC SPA (React 19 + TS Strict, `0 any`)** | ✅ Готово (25 компонентов в 4 доменных папках, 2D/3D топология, RBAC) | [`frontend/src/`](file:///home/tarhes/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/app/CROC-DREAM-NetOps-Platform/frontend/src) |
| **Наблюдаемость (Prometheus `/metrics` + Telegram Bot)** | ✅ Готово | [`backend/netops/telemetry/`](file:///home/tarhes/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/app/CROC-DREAM-NetOps-Platform/backend/netops/telemetry) |

---

## 4. Архитектура и структура репозитория

```text
CROC-DREAM-NetOps-Platform/
├── README.md                  # Главный навигатор по платформе (этот файл)
├── docker-compose.yml         # Полный стек: postgres, redis, api, worker, beat, prometheus, telegram-bot
├── backend/                   # Серверное ядро FastAPI + Celery + Scrapli (см. backend/README.md)
│   ├── netops/                # Пакеты: api/, services/, pipeline/, network/, intent/, models/, schemas/, telemetry/, worker/
│   ├── migrations/            # Миграции схемы БД (Alembic)
│   ├── tests/                 # Модульные, API и интеграционные тесты (pytest)
│   └── run_local.py           # Автономный лаунчер без Docker (SQLite + Eager Celery + авто-сидинг)
├── frontend/                  # Клиентский интерфейс NOC на React 19 + TypeScript (см. frontend/README.md)
│   └── src/
│       ├── api.ts             # Строго типизированный HTTP/WS клиент
│       ├── App.tsx            # Корневой оркестратор состояния и хоткеев
│       └── components/
│           ├── layout/        # Каркас и дизайн-система (Header, Sidebar, MobileNav, CommandPalette, ui)
│           ├── views/         # Рабочие экраны (Dashboard, DeviceList, DevicePage, DiffViewer, DriftView, JobsView, ChaosLabView, EmergencyHub, SlidesPresentation)
│           ├── modals/        # Модальные окна и дроверы (WelcomeModal, ShareModal, DryRunModal, AddDeviceModal, DeviceDrawer, DeviceDetailModal, CopilotPanel, ShortcutsModal)
│           └── charts/        # Визуализация (TopologyMap 2D, Topology3D, ForecastChart)
├── intent/                    # Git Source of Truth: inventory.yaml, devices/*.yaml, diff_filters.yaml (см. intent/README.md)
├── templates/                 # Шаблоны Jinja2 для 6 платформ: cisco_iosxe, arista_eos, huawei_vrp, eltex_mes, juniper_junos, yadro_kornfe (см. templates/README.md)
├── lab/                       # Лабораторный стенд: golden_configs/, running/, reset_lab.sh (см. lab/README.md)
├── scripts/                   # Инженерные CLI-утилиты: doctor.py, verify_live_lab.py, reset_lab.py, automate_netops.py (см. scripts/README.md)
├── tools/                     # MCP-серверы для агентной интеграции (mcp_netops_platform, mcp_server_monitor)
├── monitoring/                # Конфигурация сбора метрик Prometheus (prometheus.yml)
└── docs/                      # Архитектурная документация и гайды (backend-architecture.md, LIVE_LAB_GUIDE.md, templates-integration.md)
```

---

## 5. Быстрый старт

### Вариант A — Локальный запуск без Docker за 30 секунд (рекомендуется для разработки и демо)

```bash
# 1. Запуск Backend (SQLite + синхронный пайплайн, порт 8001)
backend/.venv/bin/python backend/run_local.py
# API: http://127.0.0.1:8001 | Swagger: http://127.0.0.1:8001/docs

# 2. Запуск Frontend (Vite dev server, порт 5173)
npm --prefix frontend run dev
# UI: http://127.0.0.1:5173 | Визард настройки: http://127.0.0.1:5173/?setup=1
```

### Вариант B — Полный продакшн-стек в Docker Compose

```bash
docker compose up --build -d
python3 backend/scripts/smoke_stack.py
```

---

## 6. Сквозной демо-сценарий (для защиты)

1. **Первичная инициализация («Матрёшка»)**: откройте `http://127.0.0.1:5173/?setup=1`, переключите тему (`Dark` / `Light`) или язык (`RU` / `EN`) и пройдите 4 шага проверки контура.
2. **Обзор топологии и прогнозов (`Dashboard`)**: покажите граф CLOS-фабрики (`2 Spine` + `2 Leaf`), статус `AI Pre-Flight Guard` и прогноз загрузки Statistical Forecast.
3. **Инспекция узла и Intent (`DevicePage` / `DeviceDetailModal`)**: кликните на любой узел на карте, откройте YAML-интент или перейдите в диагностику узла с графиками метрик и таблицей BGP-соседей.
4. **Dry-Run и Diff (`DryRunModal` → `DiffViewer`)**: запустите `Dry-Run`, покажите построчное сравнение `running` vs `candidate` и вызовите ИИ-объяснение рисков.
5. **Chaos Engineering и Авто-ремедиация (`ChaosLabView` → `DriftView`)**: инжектируйте несанкционированный дрейф на `spine-1` или `leaf-1`, покажите обнаружение `DRIFT_DETECTED` и устраните отклонение одной кнопкой `Remediate`.
6. **Аварийный контур (`EmergencyHub`)**: продемонстрируйте прямой CLI-терминал, рубильник `Factory Freeze` (блокирующий любые выкатки при аварии) и возврат к эталону через `Soft Reset`.
