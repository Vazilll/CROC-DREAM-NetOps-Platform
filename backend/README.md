# NetOps Platform — бэкенд

Серверная часть платформы CROC DREAM (зона ответственности Лёши, раздел 3.4 ТЗ): REST API на
FastAPI, PostgreSQL + Alembic, фоновые задачи Celery/Redis, конечный автомат задач, пайплайн
dry-run → deploy с откатом и движок дрейфа по расписанию Celery Beat.

Структура пакета и логика работы — в [`docs/backend-architecture.md`](../docs/backend-architecture.md).

## Что готово

| Требование ТЗ | Где в коде |
|---|---|
| Таблицы PostgreSQL (устройства, задачи, снимки конфигураций, история дрейфа) и миграции Alembic | `netops/models/`, `migrations/versions/` |
| REST API из раздела 2.3 + CRUD устройств, история задач, импорт инвентаря | `netops/api/routes/` |
| Валидация intent через Pydantic (IP и маски, пересечения подсетей, ASN 1..4294967295, уникальность Router ID и IP по фабрике) со структурированными ошибками | `netops/intent/` |
| Celery + Redis: деплой и опрос идут в воркере, API не блокируется | `netops/worker/` |
| Конечный автомат `PENDING → RUNNING → SUCCESS / FAILED` с логом каждого шага | `netops/models/job.py`, `netops/pipeline/recorder.py` |
| Пайплайн: pre-flight lint → dry-run → ручное подтверждение → pre-check → apply (commit confirmed) → post-check → confirm/rollback | `netops/pipeline/` |
| Drift Engine: Celery Beat каждые 15 минут, классификация `IN_SYNC / DRIFT_DETECTED / UNREACHABLE`, устранение дрейфа | `netops/pipeline/pipelines.py`, `netops/services/jobs.py` |
| Нормализация конфигов по правилам Ани: сравниваются только управляемые секции, служебные строки и хэши паролей отбрасываются | `netops/network/normalization.py`, `netops/network/diff_filters.yaml` |
| Post-check по правилам Health-Check: заявленные BGP-соседи в Established с префиксами, порты up/up, потери ping ≤ 20 %, ожидание сходимости BGP | `netops/network/health.py`, `netops/pipeline/deployment.py` |
| Живой SSH-драйвер (`Scrapli` + `Paramiko` fallback, мультиплексирование `direct-tcpip` через единый SSH Jump-туннель) и файловый эмулятор (`OfflineLab`) | `netops/network/scrapli_driver.py`, `netops/network/ssh_pool.py`, `netops/network/offline.py` |
| Предиктивная аналитика временных рядов (Statistical Forecast), `AI Pre-Flight Guard`, `Chaos Lab` и `NetOps Copilot` | `netops/api/routes/insights.py`, `netops/services/forecast.py`, `netops/services/ai_guard.py`, `netops/services/llm.py` |
| Аварийный пульт (`Emergency Hub`: прямой CLI, экстренный патч, Soft/Hard Reset, `Factory Freeze`) | `netops/api/routes/emergency.py`, `netops/services/freeze.py` |
| 5-слойный визард инициализации «Матрёшка» (вкл. `5. Сервер` — авто-импорт Containerlab по SSH), GitHub SoT (`Pull`/`Push`/Webhook) и WebSocket-стриминг с одноразовыми билетами | `netops/api/routes/system.py`, `netops/services/bootstrap_discovery.py`, `netops/services/notifier.py` |
| RBAC: `viewer` / `operator` / `admin` / `owner`, управление пользователями, TTL-токенами и областями доступа (`allowed_scopes`) | `netops/api/deps.py`, `netops/services/users.py` |
| Общий docker-compose: бэкенд, фронтенд, PostgreSQL, Redis, миграции, воркер, Beat, Prometheus, Telegram-бот | `../docker-compose.yml` |
| CI/CD: линтеры и тесты, сборка образа, smoke-тест всего стека, публикация образа в GHCR | `../.github/workflows/ci-cd.yml`, `scripts/smoke_stack.py` |
| OpenAPI/Swagger | `/docs`, `/openapi.json` |

---

## Структура каталогов и модулей `backend/`

Ниже приведена полная карта серверных пакетов с объяснением ответственности каждого модуля:

```
backend/
├── Dockerfile                       # Контейнерный образ бэкенда и воркеров (uvicorn / celery, offline-resilient)
├── pyproject.toml                   # Зависимости проекта и настройки ruff / black / mypy / pytest
├── alembic.ini                      # Конфигурация миграций БД
├── migrations/                      # Версии схемы базы данных Alembic
├── scripts/
│   └── smoke_stack.py               # Сквозной smoke-тест Docker-стека
├── tools/
│   └── Statistical Forecast_server.py            # Микросервер инференса временных рядов Statistical Forecast
├── tests/                           # 626 модульных и интеграционных тестов (unit / integration / api)
└── netops/
    ├── main.py                      # Точка входа ASGI (uvicorn netops.main:app)
    ├── settings.py                  # Типизированная конфигурация Pydantic Settings (NETOPS_*) + Runtime Overlay
    ├── constants.py                 # Чтение единых констант и портов из config/constants.yaml
    ├── enums.py                     # Перечисления домена (Platform, DeviceRole, DeviceStatus, JobType, JobStatus, UserRole)
    ├── errors.py                    # Иерархия доменных исключений
    ├── security.py                  # Хэширование токенов (SHA-256) и криптографические утилиты
    ├── toolchain.py                 # Фабрика сетевого драйвера: собирает OfflineLab или Scrapli по NETOPS_NETWORK_DRIVER
    ├── api/                         # Слой HTTP / WebSocket контроллеров FastAPI
    │   ├── app.py                   # Фабрика create_app(), CORS, роутеры, /healthz, /readyz, /metrics
    │   ├── deps.py                  # DI-контейнер, аутентификация Bearer/Session, RBAC-гарды и изоляция allowed_system
    │   ├── errors.py                # Глобальные обработчики исключений → JSON (404, 409, 422, 503)
    │   └── routes/
    │       ├── auth.py              # Вход по сессиям, инвайтам, 6-значным кодам и local-owner-console
    │       ├── config.py            # Публичная конфигурация ролевых портов консолей
    │       ├── devices.py           # CRUD узлов, /devices/probe, снапшоты, quick-action, reset-golden
    │       ├── jobs.py              # Запуск dry-run и deploy, лог шагов, вычисление diff
    │       ├── drift.py             # Внеочередной скан дрейфа, отчёт и авто-ремедиация (remediate)
    │       ├── telemetry.py         # Единое API телеметрии (/telemetry/series, /collect, /collectors, HTTP SD /sd/snmp и /sd/exporter)
    │       ├── insights.py          # Прогноз Statistical Forecast (/forecast), гибридный RRF-поиск и сводка по фабрике
    │       ├── insights_copilot.py  # AI Pre-Flight Guard (/ai-guard), NetOps Copilot (/copilot/chat) и Telegram-сводка
    │       ├── emergency.py         # Аварийный пульт: диагностический CLI (/emergency/command) и журнал аудита (/emergency/audit)
    │       ├── emergency_reset.py   # Экстренный патч (/emergency/patch), Soft Reset и Hard Reset
    │       ├── system.py            # Визард «Матрёшка» (/system/bootstrap/*), /healthz, /readyz, /metrics, /system/freeze
    │       ├── system_git_integrations.py # GitHub SoT (/git/status, /git/sync, /git/commit-diff, /git/webhook) и статус интеграций
    │       └── users.py             # Управление пользователями, ролями, TTL-токенами и областями allowed_system
    ├── db/                          # Слой подключения к СУБД
    │   ├── base.py                  # Декларативная база SQLAlchemy 2.0
    │   └── session.py               # Движок и фабрика транзакционных сессий
    ├── models/                      # ORM-таблицы базы данных
    │   ├── device.py                # Устройство фабрики (Device)
    │   ├── job.py                   # Задача (Job), цели (JobTarget) и лог шагов (JobLog)
    │   ├── snapshot.py              # Снимок конфигурации (ConfigSnapshot)
    │   ├── drift.py                 # Запись обнаруженного дрейфа (DriftRecord)
    │   ├── user.py                  # Пользователь, роль, allowed_system и срок действия токена (User)
    │   └── system_state.py          # Таблица ключ-значение SystemState для Runtime Overlay и аудита
    ├── schemas/                     # Контракты запросов и ответов Pydantic v2
    │   ├── common.py, devices.py, drift.py, intent.py, jobs.py, users.py
    ├── intent/                      # Работа с Git Source of Truth и валидация YAML
    │   ├── models.py                # Строгие схемы инвентаря, интерфейсов, BGP и ACL (Pydantic)
    │   ├── repository.py            # Чтение и запись файлов в каталоге intent/
    │   ├── lint.py                  # Межузловая проверка фабрики (пересечения IP/подсетей, дубли Router ID и ASN)
    │   └── netbox.py                # Экспорт/импорт топологии в формат NetBox
    ├── network/                     # Сетевые драйверы, пул SSH-сессий, парсеры таблиц и нормализация CLI
    │   ├── base.py                  # Протоколы ConfigCollector, ConfigDeployer, HealthProbe
    │   ├── ssh_pool.py              # Пул постоянных SSH-сессий (_SESSION_POOL), мьютексы (_DEVICE_LOCKS) и опциональный Jump-канал
    │   ├── table_parsers.py         # Единый парсер таблиц BGP, интерфейсов и потерь ping по платформам
    │   ├── scrapli_driver.py        # Транзакционный драйвер (Cisco IOS-XE, Arista EOS, Huawei VRP, Eltex, Linux)
    │   ├── offline.py               # Файловый эмулятор сети (OfflineLab) поверх каталога lab/running/
    │   ├── rendering.py             # Генератор целевых конфигов из шаблонов Jinja2 (templates/<platform>/*.j2)
    │   ├── normalization.py         # Очистка шума и выделение управляемых секций перед сравнением
    │   ├── diff_filters.yaml        # Декларативные правила фильтрации CLI по вендорам
    │   ├── diff.py                  # Иерархический расчёт патчей наката и отката (hier_config)
    │   └── health.py                # Post-check верификатор (BGP Established, префиксы, порты up/up, ping loss ≤ 20%)
    ├── pipeline/                    # Оркестрация транзакционных пайплайнов
    │   ├── runner.py                # Исполнитель фоновых задач с перехватом ошибок и таймаутов
    │   ├── planning.py              # Логика DRY_RUN (lint → render → collect → normalize → diff)
    │   ├── deployment.py            # Логика DEPLOY (pre-check → apply commit confirmed → post-check → confirm/rollback)
    │   ├── pipelines.py             # Логика DRIFT_SCAN и DRIFT_REMEDIATE
    │   └── recorder.py              # Запись прогресса и шагов выполнения в БД
    ├── services/                    # Прикладные доменные сервисы (все модули < 500 строк)
    │   ├── devices.py, jobs.py, drift.py, users.py, sessions.py
    │   ├── retention.py             # Пред-коллекторный чистильщик логов (/var/log/netops/*.log), RAM-кэшей и старых записей БД
    │   ├── state.py                 # Ядро StateManager (Redis + PostgreSQL SystemState + Memory fallback)
    │   ├── state_domains.py         # Доменный миксин StateDomainsMixin (блокировки, кэш телеметрии, шаблонов, Factory Freeze)
    │   ├── discovery.py             # Оркестратор SSH-зондирования (/devices/probe), онбординга и привязки к Git SoT
    │   ├── discovery_profiles.py    # Загрузка YAML-профилей платформ (intent/platforms/*.yaml) и детекция баннеров
    │   ├── discovery_parsers.py     # Парсеры железа, интерфейсов Linux/CLI и соседей LLDP
    │   ├── discovery_brownfield.py  # Извлечение BGP, ACL и генерация стартового YAML-интента из running-config
    │   ├── bootstrap.py             # 4-шаговый визард «Матрёшка»
    │   ├── bootstrap_discovery.py   # Авто-обнаружение узлов стенда (Containerlab / TCP-скан / Offline)
    │   ├── bootstrap_exposure.py    # Обратный SSH-туннель (ssh -R) для выдачи публичного доступа внешним участникам
    │   ├── bootstrap_owner.py       # Привязка и восстановление прав Владельца (Owner)
    │   ├── telemetry.py             # Координатор сбора метрик, резолвинга портов и выбора протокола (gNMI/Exporter/SNMP/SSH)
    │   ├── telemetry_parsers.py     # Реестр CLI-парсеров PARSER_REGISTRY (CPU, RAM, Uplink, Disk, Load)
    │   ├── telemetry_prometheus.py  # Прямые запросы временных рядов из Prometheus и VictoriaMetrics
    │   ├── git_sot.py               # Метаданные Git с 10-секундным TTL-кэшем, git pull и синхронизация
    │   ├── chaos.py                 # Сценарии Chaos Engineering (инъекция дрейфа, падение портов, сброс к эталону)
    │   ├── forecast.py              # Расчёт прогнозов временных рядов Statistical Forecast (квантили p10/p50/p90 и ETA отказа)
    │   ├── ai_guard.py              # Эвристический и ИИ-анализ безопасности патча перед деплоем (Pre-Flight Guard)
    │   ├── llm.py                   # Интеграция с LLM (OpenRouter / Gemini / локальная эвристика) для объяснения diff и Copilot
    │   ├── freeze.py                # Глобальный рубильник заморозки изменений (Factory Freeze)
    │   └── notifier.py              # Диспетчер уведомлений в Telegram, реестр доступов и синхронизация токенов
    ├── telemetry/                   # Единый конвейер метрик Prometheus / VictoriaMetrics и Telegram-бот
    │   ├── collector.py             # Проход сбора (вызывает pre_collect_cleanup -> собирает срезы -> пушит в VictoriaMetrics)
    │   ├── targets.py               # Авто-генерация целей для gnmic, snmp_exporter и node_exporter
    │   ├── metrics.py               # Каталог метрик и сериализация в формат Prometheus
    │   ├── bot.py                   # Ядро и поллинг Telegram-бота
    │   ├── bot_auth.py              # Авторизация и привязка чатов Telegram к ролям и стендам
    │   ├── bot_views.py             # Экраны отчётов (/status, /drift, /jobs, /metrics, /users, /security)
    │   └── bot_actions.py           # Команды управления (/collect, /scan, /freeze, /ai)
    └── worker/                      # Конфигурация Celery и периодических задач Beat
        ├── celery_app.py
        └── tasks.py
```

---

## Запуск в Docker-контейнерах

Вся платформа запускается единым Docker-стеком из корня репозитория:

```bash
docker compose up --build -d
```

При старте контейнер `api` автоматически применяет миграции (`alembic upgrade head`) и поднимает ASGI-сервер `uvicorn netops.main:app`; контейнеры `worker`, `beat` и `telegram-bot` используют тот же собранный образ `netops-backend`.

Для локального прогона тестов и линтеров внутри `backend/`:

```bash
backend/.venv/bin/pytest backend/tests/
backend/.venv/bin/ruff check backend/
```


### Если в базе нет таблиц

Миграции применяет контейнер `api` при старте. Пока схемы нет, `/readyz` отвечает 503
`migrations not applied`, API не становится `healthy`, и воркер с Beat не запускаются.

```bash
docker compose ps                                  # api должен быть healthy
docker compose logs api | grep -i alembic          # что сделали миграции, текст ошибки
docker compose exec api alembic upgrade head       # применить миграции ещё раз
docker compose exec postgres psql -U netops -d netops -c '\dt'
```

## Проверки

```bash
uv run pytest --cov=netops   # все модульные и интеграционные тесты, SQLite, без Redis и сети
uv run ruff check .
uv run black --check .
uv run mypy                  # strict
```

Тест `tests/integration/test_migrations.py` прогоняет миграции и сверяет результат с моделями —
если поменяли модель и забыли миграцию, он упадёт. Новая миграция:
`uv run alembic revision --autogenerate -m "..."`, затем проверить файл руками.

Тесты `tests/integration/test_repo_data.py` проверяют данные стенда в корне репозитория: intent
проходит линт, шаблоны из `templates/` рендерятся для каждого устройства.

**Smoke-тест стека.** Когда стек поднят (`docker compose up -d --wait`), из корня репозитория:

```bash
python3 backend/scripts/smoke_stack.py
```

## Конфигурация

Все переменные с префиксом `NETOPS_`, полный список — `netops/settings.py` и `.env.example`.

| Переменная | Назначение |
|---|---|
| `DATABASE_URL` | PostgreSQL (`postgresql+psycopg://...`) или SQLite (`sqlite:///...`) |
| `REDIS_URL` | брокер Celery и хранилище флага `Factory Freeze` |
| `INTENT_REPO_PATH` | checkout Git-репозитория с intent (`intent/`) |
| `TEMPLATES_PATH` | шаблоны Jinja2 (`<platform>/{base,interfaces,acls,bgp}.j2`) |
| `DIFF_FILTERS_PATH` | свой файл фильтров диффа в формате `netops/network/diff_filters.yaml`; по умолчанию берётся он |
| `NETWORK_DRIVER` | `offline` (файловый стенд `lab/running/`) или `scrapli` (живой SSH до Containerlab / железа) |
| `COMMIT_CONFIRM_TIMEOUT_SECONDS` | таймер `commit confirmed`, по умолчанию 180 |
| `POST_CHECK_ATTEMPTS`, `POST_CHECK_INTERVAL_SECONDS` | повторы post-check, пока сходится BGP: по умолчанию 6 × 10 с |
| `MAX_PING_LOSS_PERCENT` | допустимые потери ping, по умолчанию 20 |
| `DRIFT_SCAN_INTERVAL_SECONDS` | период фонового скана, по умолчанию 900 (15 минут) |
| `API_TOKENS` | начальные токены `{"<token>": {"username": ..., "role": "viewer\|operator\|admin"}}` |
| `AUTH_PROFILES` | JSON `{"lab": {"username": ..., "password": ...}}`: SSH-учётки для `auth_profile` из инвентаря |
| `CORS_ORIGINS` | адреса фронтенда, которым разрешены запросы из браузера |

## API

### 1. Устройства, Инвентарь и Intent (`routes/devices.py`)

| Метод | URL | Роль | Что делает |
|---|---|---|---|
| GET | `/api/v1/devices?status=&role=&platform=` | viewer | список устройств со спарклайнами и операционным статусом |
| GET | `/api/v1/devices/{id}` | viewer | карточка устройства + параметры из intent + снапшоты |
| POST/PATCH/DELETE | `/api/v1/devices[/{id}]` | operator/admin | управление инвентарём и добавление узлов |
| POST | `/api/v1/devices/probe` | operator | живая проверка доступности IP/порта по TCP/SSH перед добавлением |
| GET | `/api/v1/devices/{id}/telemetry` | viewer | метрики CPU, RAM, утилизации интерфейсов и BGP-соседей |
| POST | `/api/v1/devices/{id}/quick-action` | admin | быстрый диагностический CLI-запрос на устройство с записью в аудит |
| POST | `/api/v1/devices/reset-golden` | operator | восстановление эталонных конфигураций (`lab/golden_configs/`) |
| POST | `/api/v1/inventory/sync` | operator | импорт `inventory.yaml` из Git в базу данных |
| GET | `/api/v1/intent/lint` | viewer | pre-flight lint репозитория intent |

### 2. Оркестрация задач и Контроль дрейфа (`routes/jobs.py`, `routes/drift.py`)

| Метод | URL | Роль | Что делает |
|---|---|---|---|
| POST | `/api/v1/jobs/dry-run` | viewer | расчёт плана изменений (`DRY_RUN`) без наката в сеть → `job_id` |
| POST | `/api/v1/jobs/deploy` | operator | боевой деплой по успешному `dry-run` с проверкой `Factory Freeze` |
| POST | `/api/v1/jobs/{id}/rollback` | operator | принудительный откат задачи к предыдущему снапшоту |
| GET | `/api/v1/jobs?type=&status=` | viewer | история задач |
| GET | `/api/v1/jobs/{id}` | viewer | статус, прогресс (%), устройства, логи шагов |
| GET | `/api/v1/jobs/{id}/logs?after_id=` | viewer | инкрементальная подгрузка новых строк лога |
| GET | `/api/v1/jobs/{id}/diff` | viewer | `running_config`, `intended_config`, `remediation_patch`, `rollback_patch` |
| POST | `/api/v1/drift/scan` | operator | внеочередной скан дрейфа (`{"device_ids": [...]}` или все) |
| GET | `/api/v1/drift/report` | viewer | последняя проверка каждого устройства + число строк отклонений |
| POST | `/api/v1/drift/remediate` | operator | автоматическое устранение дрейфа (`DRIFT_REMEDIATE`) |

### 3. Предиктивная аналитика Statistical Forecast, AI Guard и Chaos Lab (`routes/insights.py`)

| Метод | URL | Роль | Что делает |
|---|---|---|---|
| GET | `/api/v1/forecast` | viewer | прогноз временных рядов Statistical Forecast (`cpu_pct`, `uplink_util_pct`) с квантилями `p10`/`p90` и расчётом времени до пробития SLA (`eta_hours`) |
| POST | `/api/v1/ai-guard` | viewer | проверка безопасности изменений (`AI Pre-Flight Guard`) перед выкаткой |
| POST | `/api/v1/chaos` | operator | инъекция тестовых сбоев в стенд (несанкционированный CLI-дрейф, BGP flap, перегрузка линка) |
| POST | `/api/v1/copilot` | viewer | интерактивный чат с ИИ-ассистентом `NetOps Copilot` с контекстом всей фабрики |
| POST | `/api/v1/jobs/{id}/explain` | viewer | анализ рисков конфигурационного диффа задачи (LLM + детерминированная эвристика) |

### 4. Аварийный контур `Emergency Hub` (`routes/emergency.py`)

| Метод | URL | Роль | Что делает |
|---|---|---|---|
| POST | `/api/v1/emergency/command` | admin | прямое выполнение диагностической CLI-команды (`show`/`display`) на узле |
| POST | `/api/v1/emergency/patch` | admin | экстренный накат конфигурационного патча в обход стандартных гейтов |
| POST | `/api/v1/emergency/soft-reset` | admin | мягкий сброс: принудительное возвращение фабрики к `golden_configs` |
| POST | `/api/v1/emergency/hard-reset` | admin | жёсткий сброс: переразвёртывание топологии `Containerlab` по SSH |
| GET/POST | `/api/v1/emergency/freeze` | viewer/operator | чтение и переключение глобальной блокировки изменений (`Factory Freeze`) |
| GET | `/api/v1/emergency/audit` | admin | неизменяемый журнал всех аварийных вмешательств (`emergency_audit.jsonl`) |

### 5. Система, Визард «Матрёшка», Git SoT и Пользователи (`routes/system.py`, `routes/users.py`)

| Метод | URL | Роль | Что делает |
|---|---|---|---|
| GET | `/api/v1/system/bootstrap/status` | — | статус 4-шагового визарда первичной инициализации («Матрёшка») |
| POST | `/api/v1/system/bootstrap/step{1..4}` | — | шаги визарда: (1) Telegram Bot + Owner, (2) Режим контура + TCP Probe, (3) Матрица паролей узлов, (4) GitHub SoT |
| GET | `/api/v1/git/status` | viewer | статус репозитория Intent (ветка, коммит, локальные изменения) |
| POST | `/api/v1/git/sync` | operator | синхронизация `git pull` / `git push` и автоматический ре-импорт инвентаря |
| POST | `/api/v1/git/webhook` | — | приёмник GitHub Webhook (`X-Hub-Signature-256`) для авто-запуска `Dry-Run` при `push` |
| POST | `/api/v1/ws/ticket` | viewer | выдача одноразового криптографического билета (TTL 30 с) для подключения к WebSocket |
| WS | `/api/v1/ws/stream?ticket=` | viewer | потоковая телеметрия состояния фабрики и задач в реальном времени |
| GET | `/api/v1/auth/me` | viewer | текущий пользователь, роль, время истечения и разрешённые скоупы |
| GET/POST/PATCH/DELETE | `/api/v1/users[/{id}]` | admin | управление пользователями, выпуск именных TTL-токенов и привязка к Telegram |
| GET | `/healthz`, `/readyz`, `/metrics` | — | проверки живучести/готовности контейнера и экспорт метрик Prometheus |

---

## Метрики и телеграм-бот

Воркер раз в `NETOPS_METRICS_INTERVAL_SECONDS` (по умолчанию 60) публикует последний срез замеров
в Redis (`netops:telemetry:latest`, TTL = 3 интервала), а `GET /metrics` отдаёт его в формате
Prometheus. В PostgreSQL метрики больше не пишутся: Prometheus скрейпит `/metrics`, держит 3 дня
для алертов и отправляет всё через `remote_write` в VictoriaMetrics (история, `VM_RETENTION`,
по умолчанию 12 месяцев) — она же источник по умолчанию для Grafana.

Раз в `NETOPS_COLLECTOR_TARGETS_INTERVAL_SECONDS` (по умолчанию 3600) задача
`netops.telemetry.refresh_collector_targets` проверяет каждое устройство и раскладывает его по
внешним сборщикам: gNMI (подтверждён `gnmic capabilities`) → `gnmic_targets.yaml`, exporter
(ответ в формате Prometheus) → `exporter_targets.json`, SNMP v2c (ответ на заданное
`NETOPS_SNMP_COMMUNITY`) → `prometheus_targets.json`. Остальные остаются на SSH CLI-опросе.
План виден в `GET /api/v1/telemetry/collectors`, принудительный пересчёт —
`POST /api/v1/telemetry/collectors/refresh`.

Из базы: `netops_device_status`, `netops_devices_total`, `netops_drift_devices`,
`netops_jobs_total`, `netops_job_last_finished_timestamp_seconds`. Со стенда (через тот же
`HealthProbe`, что и post-check): `netops_device_reachable`, `netops_bgp_session_up`,
`netops_bgp_prefixes_accepted`, `netops_interface_up`, `netops_ping_loss_percent`.

**Бот** (`python -m netops.telemetry.bot`, контейнер `telegram-bot`) присылает оповещения при
смене состояния устройства (появился дрейф, устройство недоступно, снова совпало с эталоном) и об
упавших задачах. Отвечает на команды `/status`, `/drift`, `/jobs`, `/metrics`, а также поддерживает
привязку профилей инженеров через `netops/services/notifier.py`.

---

## Как работают задачи

- **DRY_RUN** — lint всего intent (при ошибке — `FAILED` без обращения к сети) → рендер
  шаблонов → сбор running-config → нормализация → `hier_config`. Снимки конфигов и патчи
  сохраняются в `config_snapshots` / `job_targets`.
- **DEPLOY** — только для успешного dry-run с изменениями, одно подтверждение на dry-run.
  Проверяет отсутствие `Factory Freeze`. Устройства обрабатываются по очереди, при первой ошибке раскатка останавливается (остальные — `SKIPPED`).
  Перед применением running-config сверяется по хешу с dry-run: если на устройстве что-то поменяли,
  деплой отклоняется. Далее `pre-check → apply → post-check → confirm` или `rollback` (`ROLLED_BACK`).
- **DRIFT_SCAN** — по расписанию (пропускается, если предыдущий скан ещё идёт) или вручную;
  пишет `drift_records` и статус устройства.
- **DRIFT_REMEDIATE** — пересчитывает компенсирующий патч на текущем running-config и
  прогоняет его через тот же транзакционный деплой.

---

## Точки интеграции и мульти-вендорная матрица

- **Сетевой драйвер (`netops/network/scrapli_driver.py` и `offline.py`)**: поддерживает работу как с живым стендом Containerlab по SSH (`NETOPS_NETWORK_DRIVER=scrapli` с автоматическим fallback на `Paramiko`), так и с локальным файловым эмулятором (`NETOPS_NETWORK_DRIVER=offline`, каталог `lab/running/`).
- **Шаблоны Jinja2 (`templates/<platform>/`)**: реализованы и протестированы для всех 6 платформ:
  - `cisco_iosxe` (Cisco Catalyst / CSR1000v / c8000v)
  - `arista_eos` (Arista cEOS / vEOS)
  - `huawei_vrp` (Huawei CloudEngine CE12800 / VRP)
  - `eltex_mes` (Eltex MES / ESR)
  - `juniper_junos` (Juniper vMX / vQFX)
  - `yadro_kornfe` (YADRO KORNFE SONiC)
- **Нормализация (`netops/network/normalization.py`, `diff_filters.yaml`)**: маскирует секреты, отбрасывает служебные строки и выделяет только управляемые секции (`managed_sections`), исключая ложные срабатывания дрейфа на management-интерфейсах и VTY-линиях.

