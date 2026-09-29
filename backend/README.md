# NetOps Platform — бэкенд

Серверная часть платформы CROC DREAM (зона ответственности Лёши, раздел 3.4 ТЗ): REST API на
FastAPI, PostgreSQL + Alembic, фоновые задачи Celery/Redis, конечный автомат задач, пайплайн
dry-run → deploy с откатом и движок дрейфа по расписанию Celery Beat.

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
| Нормализация конфигов (баннеры, счётчики байт, сертификаты, отступы) | `netops/network/normalization.py` |
| Критерии аварийной деградации (BGP, интерфейсы, потери ping > 20 %) | `netops/network/health.py` |
| RBAC: viewer / operator / admin | `netops/api/deps.py` |
| OpenAPI/Swagger | `/docs`, `/openapi.json` |

## Быстрый старт

Нужны Python 3.11+ и [uv](https://docs.astral.sh/uv/).

```bash
cd backend
uv sync                      # зависимости + dev-инструменты
cp .env.example .env         # поправить пути и токены
uv run alembic upgrade head  # схема БД
uv run uvicorn netops.main:app --reload
```

Воркер и планировщик (нужен Redis):

```bash
uv run celery -A netops.worker.tasks worker --loglevel=INFO
uv run celery -A netops.worker.tasks beat --loglevel=INFO
```

Всё сразу в Docker (Postgres, Redis, API, воркер, Beat): `docker compose -f docker-compose.dev.yml up --build`.
Общий `docker-compose.yml` для всей платформы собирает Даня; этот файл — только для разработки бэкенда.

Swagger: <http://localhost:8000/docs>. Авторизация — заголовок `Authorization: Bearer <token>`.

## Проверки

```bash
uv run pytest --cov=netops   # 240+ тестов, SQLite, без Redis и сети
uv run ruff check .
uv run black --check .
uv run mypy                  # strict
```

Тест `tests/integration/test_migrations.py` прогоняет миграции и сверяет результат с моделями —
если поменяли модель и забыли миграцию, он упадёт. Новая миграция:
`uv run alembic revision --autogenerate -m "..."`, затем проверить файл руками.

## Конфигурация

Все переменные с префиксом `NETOPS_`, полный список — `netops/settings.py` и `.env.example`.

| Переменная | Назначение |
|---|---|
| `DATABASE_URL` | PostgreSQL, `postgresql+psycopg://...` |
| `REDIS_URL` | брокер Celery |
| `INTENT_REPO_PATH` | checkout Git-репозитория с intent |
| `TEMPLATES_PATH` | шаблоны Jinja2 (`<platform>/{base,interfaces,acls,bgp}.j2`) |
| `NORMALIZATION_RULES_PATH` | необязательный YAML с дополнительными правилами нормализации |
| `NETWORK_DRIVER` | пока только `offline` (см. ниже) |
| `COMMIT_CONFIRM_TIMEOUT_SECONDS` | таймер `commit confirmed`, по умолчанию 180 |
| `DRIFT_SCAN_INTERVAL_SECONDS` | период фонового скана, по умолчанию 900 (15 минут) |
| `API_TOKENS` | JSON `{"<token>": {"username": ..., "role": "viewer\|operator\|admin"}}` |
| `AUTH_PROFILES` | JSON `{"lab": {"username": ..., "password": ...}}`: SSH-учётки для `Device.auth_profile` |

## API

| Метод | URL | Роль | Что делает |
|---|---|---|---|
| GET | `/api/v1/devices?status=&role=&platform=` | viewer | список устройств |
| GET | `/api/v1/devices/{id}` | viewer | карточка устройства + параметры из intent |
| POST/PATCH/DELETE | `/api/v1/devices[/{id}]` | admin | управление инвентарём |
| POST | `/api/v1/inventory/sync` | admin | импорт `inventory.yaml` из Git |
| GET | `/api/v1/intent/lint` | viewer | pre-flight lint репозитория intent |
| POST | `/api/v1/jobs/dry-run` | operator | `{"device_ids": [1, 2], "intent_source": "git_main"}` → `job_id` |
| GET | `/api/v1/jobs?type=&status=` | viewer | история задач |
| GET | `/api/v1/jobs/{id}` | viewer | статус, прогресс (%), устройства, логи шагов |
| GET | `/api/v1/jobs/{id}/diff` | viewer | `running_config`, `intended_config`, `remediation_patch`, `rollback_patch` по каждому устройству |
| POST | `/api/v1/jobs/deploy` | operator | `{"job_id": "<dry-run>", "confirmed_by": "..."}` → `job_id` деплоя |
| POST | `/api/v1/drift/scan` | operator | внеочередной скан (`{"device_ids": [...]}` или все) |
| GET | `/api/v1/drift/report?since=&until=&status=` | viewer | последняя проверка каждого устройства |
| POST | `/api/v1/drift/remediate` | operator | `{"device_id": 1}` → `job_id` |
| GET | `/api/v1/auth/me` | viewer | текущий пользователь и роль (для UI) |
| GET | `/healthz`, `/readyz` | — | liveness / readiness (БД) |

Ошибки: `404` — нет сущности, `409` — конфликт состояния (dry-run не успешен, устройство уже
деплоится и т. п.), `422` — ошибка валидации (для intent — со списком `issues` с файлом и полем),
`503` — очередь недоступна (задача сразу помечается `FAILED`).

## Как работают задачи

- **DRY_RUN** — lint всего intent (при ошибке — `FAILED` без обращения к сети) → рендер
  шаблонов → сбор running-config → нормализация → hier_config. Снимки конфигов и патчи
  сохраняются в `config_snapshots` / `job_targets`.
- **DEPLOY** — только для успешного dry-run с изменениями, одно подтверждение на dry-run.
  Устройства обрабатываются по очереди, при первой ошибке раскатка останавливается (остальные — `SKIPPED`).
  Перед применением running-config сверяется по хешу с dry-run: если на устройстве что-то поменяли,
  деплой отклоняется. Далее pre-check → apply → post-check → confirm или rollback (`ROLLED_BACK`).
- **DRIFT_SCAN** — по расписанию (пропускается, если предыдущий скан ещё идёт) или вручную;
  пишет `drift_records` и статус устройства.
- **DRIFT_REMEDIATE** — пересчитывает компенсирующий патч на текущем running-config и
  прогоняет его через тот же транзакционный деплой.

Задача `FAILED`, если упало хотя бы одно устройство. Зависшие задачи (воркер умер, сообщение
потерялось) через `JOB_TIMEOUT_SECONDS` переводятся в `FAILED` фоновой задачей Beat, устройства
освобождаются. Статус устройства `UNKNOWN` (добавлен к статусам ТЗ) — ещё не проверялось или
состояние неизвестно после неудачного отката.

## Точки интеграции для команды

**Максим (Scrapli/Nornir).** Пайплайн работает с сетью только через протоколы из
`netops/network/base.py`: `ConfigCollector` (параллельный сбор running-config),
`ConfigDeployer` (`apply` с commit confirmed / `confirm` / `rollback`) и `HealthProbe`
(снимок BGP, интерфейсов, ping). Реализацию достаточно зарегистрировать в `build_toolchain()`
(`netops/toolchain.py`) под новым значением `NETOPS_NETWORK_DRIVER`, оркестрацию менять не нужно.
Пока используется `OfflineLab` — «стенд на файлах»: running-config читается из
`<OFFLINE_LAB_PATH>/<hostname>.cfg`, confirm записывает туда intended config. Так можно
показать весь сценарий без Containerlab.

**Тимофей (шаблоны).** Шаблоны: `<TEMPLATES_PATH>/<platform>/{base,interfaces,acls,bgp}.j2`,
склеиваются в этом порядке, отсутствующие секции пропускаются. В контексте: `device`
(`InventoryDevice`: hostname, platform, role, management_ip…) и `intent` (`DeviceIntent`).
Адреса — объекты `ipaddress`: `iface.ipv4_address.ip`, `.netmask`, `.with_prefixlen`,
`prefix.hostmask`. Неизвестная переменная — ошибка (`StrictUndefined`). Рабочие примеры
под IOS-XE и EOS лежат в `tests/fixtures/templates/`.

**Аня (нормализация).** Встроенные правила — в `DEFAULT_RULES`
(`netops/network/normalization.py`). Дополнительные правила можно подключить YAML-файлом без
правок кода:

```yaml
cisco_iosxe:
  ignore_lines: ['^service timestamps']   # регулярки по строке
  ignore_sections: ['^line vty']          # строка + все вложенные
```

**Даня (формат intent).** Репозиторий intent: `inventory.yaml` (список устройств) и
`devices/<hostname>.yaml` (`interfaces`, `bgp`, `acls` по разделу 2.1 ТЗ). Схема — Pydantic-модели
в `netops/intent/models.py`, пример — `tests/fixtures/intent-repo/` (CLOS: 2 spine Arista + 2 leaf Cisco).
Неизвестные поля запрещены, чтобы опечатки не проходили молча.

## Что ещё не сделано

- Драйвер Scrapli/Nornir и реальные health-check команды (Максим) — пока `OfflineLab`.
- Реальные шаблоны Jinja2 (Тимофей) — в репозитории только тестовые.
- Проверка «каждый заявленный BGP-сосед в Established» после деплоя: сейчас оценивается только
  регрессия относительно pre-check (сессия была Established и перестала).
- Пользователи и токены задаются в настройках; управление учётками через API и принудительный
  накат rollback администратором — следующий шаг.
- `intent_source` поддерживает только `git_main` (читается рабочая копия в `INTENT_REPO_PATH`,
  `git pull` выполняется снаружи).
- Docker-образ и `docker-compose.dev.yml` написаны, но не собирались (на машине не был запущен Docker).
