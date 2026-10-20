# CROC DREAM — NetOps Platform

**Платформа централизованного управления, транзакционной оркестрации и предиктивного мониторинга гетерогенной сетевой инфраструктуры.**

**Команда:** CROC DREAM  
**Статус:** Полная готовность к защите (сборка `tsc -b` + `vite` зелёная, `oxlint` 0 ошибок, все модульные и интеграционные тесты `pytest` проходят на 100%).

---

## Навигатор по документации модулей (Git Module Guides)

Каждый блок репозитория снабжён собственной подробной инструкцией с описанием архитектуры, файлов и контрактов:

| Модуль / Каталог | Инструкция | За что отвечает блок |
|------------------|------------|----------------------|
| **`backend/`** | [**`backend/README.md`**](backend/README.md) | Серверное ядро FastAPI, PostgreSQL + Alembic, Celery/Redis, транзакционные пайплайны `dry-run` / `deploy` / `drift`, пул сессий `ssh_pool.py` + `table_parsers.py`, `retention.py` (автоочистка логов и кэшей), Statistical Forecast, `AI Guard`, `Emergency Hub` |
| **`frontend/`** | [**`frontend/README.md`**](frontend/README.md) | Клиентское ядро NOC (React 19 + TypeScript 5.9, `0 any`), раскладка по папкам `layout/`, `views/`, `modals/`, `charts/`, темы `Dark`/`Light`, локализация `RU`/`EN`, визард «Матрёшка», хоткеи |
| **`intent/`** | [**`intent/README.md`**](intent/README.md) | Git Source of Truth: реестр устройств `inventory.yaml`, декларативные профили узлов `devices/*.yaml`, профили платформ `platforms/*.yaml` и правила нормализации `diff_filters.yaml` |
| **`templates/`** | [**`templates/README.md`**](templates/README.md) | Мульти-вендорный движок шаблонов Jinja2 (`StrictUndefined`) для 6 сетевых ОС (`Cisco IOS-XE`, `Arista EOS`, `Huawei VRP`, `Eltex MES`, `Juniper Junos`, `YADRO KORNFE`) |
| **`lab/`** | [**`lab/README.md`**](lab/README.md) | Лабораторный стенд CLOS: эталонные конфигурации `golden_configs/`, файловый эмулятор `running/` и скрипт сброса `reset_lab.sh` |
| **`scripts/`** | [**`scripts/README.md`**](scripts/README.md) | CLI-утилиты самодиагностики (`doctor.py`), проверки SSH-стенда (`verify_live_lab.py`), сброса (`reset_lab.py`) и демо-прогона (`automate_netops.py`) |
| **`docs/`** | [**`docs/backend-architecture.md`**](docs/backend-architecture.md) | Глубокое описание внутренней архитектуры бэкенда, единого конвейера телеметрии, пред-очистки логов и правил Post-Check (`docs/templates-integration.md`, `docs/LIVE_LAB_GUIDE.md`) |
| **`mobile/`** | [**`mobile/README.md`**](mobile/README.md) | Мобильный компаньон дежурного инженера NOC |

---

## Содержание

1. [Что это за проект](#1-что-это-за-проект)
2. [Поддерживаемые вендоры (6 платформ)](#2-поддерживаемые-вендоры-6-платформ)
3. [Текущий статус модулей](#3-текущий-статус-модулей)
4. [Архитектура и структура репозитория](#4-архитектура-и-структура-репозитория)
5. [Быстрый старт (Docker)](#5-быстрый-старт-docker)
6. [Сквозной демо-сценарий (для защиты)](#6-сквозной-демо-сценарий-для-защиты)

---

## 1. Что это за проект

Платформа централизованного управления разнородной сетевой инфраструктурой по методологии **Intent-Based Networking (IBN)** и **GitOps**:
- Инженер описывает целевое состояние сети (Intent) в вендор-независимом YAML (`intent/devices/*.yaml`).
- Платформа выполняет **Pre-Flight Lint** всей фабрики (проверка пересечений IP/масок, дублей Router ID и ASN).
- Рендерит целевые конфигурации через Jinja2-шаблоны под конкретного вендора, очищает `running-config` от динамического шума и строит минимальный иерархический патч (`hier_config`) и зеркальный патч отката (`rollback_patch`).
- Проверяет патч через **AI Pre-Flight Guard**, требует явного подтверждения оператора, выкатывает изменения транзакционно (`commit confirmed` / `configure session`) с автоматической верификацией **Post-Check** (BGP Established, префиксы, порты `up/up`, потери ping ≤ 20%) и авто-откатом при сбое.
- Каждые 15 минут сканирует сеть на конфигурационный дрейф (**Drift Engine**), выполняет пред-очистку логов/снапшотов (`retention.pre_collect_cleanup`), собирает телеметрию через каскад `gNMI → Node Exporter → SNMP → SSH Pool` в **VictoriaMetrics / Prometheus** и прогнозирует исчерпание ресурсов с помощью модели временных рядов **Statistical Forecast**.

**Ключевой сквозной конвейер:**

`Git/YAML Intent → Pre-Flight Lint → Jinja2 Render → Dry-Run & Hier-Diff → AI Guard & Approval → Transactional Deploy / Auto-Rollback → Unified Telemetry & Statistical Forecast`

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
| **Backend Core (FastAPI + SQLAlchemy 2.0 + Alembic + Celery/Redis)** | ✅ Готово (626 тестов проходят, все модули < 500 строк) | [`backend/netops/`](backend/netops) |
| **Pre-Flight Intent Linter & Pydantic Schema** | ✅ Готово (`inventory.yaml` и `devices/*.yaml` синхронизированы) | [`backend/netops/intent/`](backend/netops/intent) |
| **Multi-Vendor Jinja2 Templates (6 платформ)** | ✅ Готово (`base`, `interfaces`, `acls`, `bgp`) | [`templates/`](templates) |
| **Иерархический Diff и Нормализация CLI** | ✅ Готово (`hier_config` + `diff_filters.yaml`) | [`backend/netops/network/`](backend/netops/network) |
| **Двойной сетевой контур (`ssh_pool.py` + `table_parsers.py` + `OfflineLab`)** | ✅ Готово (переключение на лету в UI и API, 1 VTY-сессия на узел, мультиплексирование `direct-tcpip` через единый SSH Jump-туннель, проверка `SSH-` баннера) | [`ssh_pool.py`](backend/netops/network/ssh_pool.py), [`table_parsers.py`](backend/netops/network/table_parsers.py), [`scrapli_driver.py`](backend/netops/network/scrapli_driver.py) |
| **Предиктивная аналитика Statistical Forecast + `AI Pre-Flight Guard`** | ✅ Готово (квантили `p10–p90`, ETA пробития SLA, блокировка опасных патчей) | [`forecast.py`](backend/netops/services/forecast.py), [`ai_guard.py`](backend/netops/services/ai_guard.py) |
| **Аварийный пульт `Emergency Hub` и `Factory Freeze`** | ✅ Готово (прямой CLI, экстренный патч, Soft/Hard Reset, Kill Switch) | [`emergency.py`](backend/netops/api/routes/emergency.py), [`emergency_reset.py`](backend/netops/api/routes/emergency_reset.py) |
| **5-слойный визард «Матрёшка» (`WelcomeModal`)** | ✅ Готово (1. Владелец, 2. Сеть и ИИ, 3. Пароли, 4. Git и Интеграции, 5. Сервер — Live Jump Host & Containerlab Auto-Bootstrap) | [`system.py`](backend/netops/api/routes/system.py), [`system_git_integrations.py`](backend/netops/api/routes/system_git_integrations.py), [`bootstrap_discovery.py`](backend/netops/services/bootstrap_discovery.py) |
| **Frontend NOC SPA (React 19 + TS Strict, `0 any`)** | ✅ Готово (2D/3D топология, RBAC, изоляция `allowed_system`) | [`frontend/src/`](frontend/src) |
| **Единый конвейер наблюдаемости и очистки (`retention.py` + `collector.py` + `VictoriaMetrics`)** | ✅ Готово (автоочистка логов/БД перед сбором, gNMI/SNMP/Exporter/SSH) | [`retention.py`](backend/netops/services/retention.py), [`backend/netops/telemetry/`](backend/netops/telemetry) |

---

## 4. Архитектура и структура репозитория

```text
CROC-DREAM-NetOps-Platform/
├── README.md                  # Главный навигатор по платформе (этот файл)
├── Dockerfile                 # All-in-One контейнерный образ платформы (docker/entrypoint.sh)
├── docker-compose.yml         # Полный микросервисный стек: postgres, redis, api, worker, beat, victoriametrics, prometheus, gnmic, snmp-exporter, node-exporter, grafana, telegram-bot, frontend
├── backend/                   # Серверное ядро FastAPI + Celery + Scrapli (см. backend/README.md)
│   ├── Dockerfile             # Контейнерный образ бэкенда и воркеров (offline-resilient uv sync)
│   ├── netops/                # Доменные модули (все файлы < 500 строк): api/, services/, pipeline/, network/, intent/, models/, schemas/, telemetry/, worker/
│   ├── migrations/            # Миграции схемы БД (Alembic)
│   └── tests/                 # 626 модульных, API и интеграционных тестов (pytest)
├── frontend/                  # Клиентский интерфейс NOC на React 19 + TypeScript (см. frontend/README.md)
│   └── src/
│       ├── api/               # Строго типизированный HTTP-клиент API
│       ├── App.tsx            # Корневой оркестратор состояния и хоткеев
│       └── components/
│           ├── layout/        # Каркас и дизайн-система (Header, Sidebar, MobileNav, CommandPalette, ui)
│           ├── views/         # Рабочие экраны (Dashboard, DeviceList, DevicePage, DiffViewer, DriftView, JobsView, ChaosLabView, EmergencyHub, SlidesPresentation)
│           ├── modals/        # Модальные окна и дроверы (WelcomeModal, ShareModal, DryRunModal, AddDeviceModal, DeviceDrawer, DeviceDetailModal, CopilotPanel, ShortcutsModal)
│           └── charts/        # Визуализация (TopologyMap 2D, Topology3D, ForecastChart)
├── intent/                    # Git Source of Truth: inventory.yaml, platforms/*.yaml, devices/*.yaml (см. intent/README.md)
├── templates/                 # Шаблоны Jinja2 для 6 платформ: cisco_iosxe, arista_eos, huawei_vrp, eltex_mes, juniper_junos, yadro_kornfe (см. templates/README.md)
├── lab/                       # Лабораторный стенд: golden_configs/, running/, reset_lab.sh (см. lab/README.md)
├── scripts/                   # Инженерные CLI-утилиты: doctor.py, verify_live_lab.py, reset_lab.py, automate_netops.py (см. scripts/README.md)
├── monitoring/                # Конфигурация Prometheus, SNMP Exporter, gNMIc и дашборды Grafana
└── docs/                      # Архитектурная документация и гайды (backend-architecture.md, LIVE_LAB_GUIDE.md, templates-integration.md)
```

---

## 5. Быстрый старт (Docker)

Единая точка входа в платформу — собранный Docker-стек:

```bash
docker compose up --build -d
python3 backend/scripts/smoke_stack.py
```

- **Консоль Владельца (Owner)**: `http://localhost:5173`
- **Ролевые консоли (Admin / Operator / Jury)**: `http://localhost:5174`, `:5175`, `:5176`
- **Swagger / OpenAPI**: `http://localhost:8001/docs`
- **Grafana / Prometheus / VictoriaMetrics**: `http://localhost:3000`, `:9090`, `:8428/vmui`

### Как дать гостю потыкать стенд

1. Владелец открывает `http://localhost:5173` → **«Поделиться»** → выбирает роль (Jury / Operator / Admin), срок жизни и (опционально) `allowed_system` → **«Создать»**. Токен `crk_*` показывается один раз.
2. Гость открывает ссылку вида `http://<хост>:5176/?token=crk_...` (Jury — `:5176`, Operator — `:5175`, Admin — `:5174`) или вводит токен на экране входа. Для внешних гостей используйте публичный туннель из «Поделиться».
3. Токен привязывается к первому устройству; сбросить привязку, перевыпустить или отозвать можно там же в списке «Участники».
4. Сессия Владельца на ролевых портах (`:5174–:5176`) не действует — гость всегда видит ровно свою роль.
5. Проверка стенда: `NETOPS_SMOKE_TOKEN=<токен admin> python3 backend/scripts/smoke_stack.py`.



---

## 6. Сквозной демо-сценарий (для защиты)

1. **Первичная инициализация («Матрёшка»)**: откройте `http://127.0.0.1:5173/?setup=1`, переключите тему (`Dark` / `Light`) или язык (`RU` / `EN`) и пройдите 4 шага проверки контура.
2. **Обзор топологии и прогнозов (`Dashboard`)**: покажите граф CLOS-фабрики (`2 Spine` + `2 Leaf`), статус `AI Pre-Flight Guard` и прогноз загрузки Statistical Forecast.
3. **Инспекция узла и Intent (`DevicePage` / `DeviceDetailModal`)**: кликните на любой узел на карте, откройте YAML-интент или перейдите в диагностику узла с графиками метрик и таблицей BGP-соседей.
4. **Dry-Run и Diff (`DryRunModal` → `DiffViewer`)**: запустите `Dry-Run`, покажите построчное сравнение `running` vs `candidate` и вызовите ИИ-объяснение рисков.
5. **Chaos Engineering и Авто-ремедиация (`ChaosLabView` → `DriftView`)**: инжектируйте несанкционированный дрейф на `spine-1` или `leaf-1`, покажите обнаружение `DRIFT_DETECTED` и устраните отклонение одной кнопкой `Remediate`.
6. **Аварийный контур (`EmergencyHub`)**: продемонстрируйте прямой CLI-терминал, рубильник `Factory Freeze` (блокирующий любые выкатки при аварии) и возврат к эталону через `Soft Reset`.
