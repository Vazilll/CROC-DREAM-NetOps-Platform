# Jules AI Agent Instructions — CROC DREAM NetOps Platform

Добро пожаловать, Jules! Этот репозиторий — проект хакатона **CROC DREAM: NetOps Platform** (автоматизация и комплаенс гетерогенной сетевой инфраструктуры).

## 🧭 Архитектурный контекст
1. **Source of Truth (SoT)**: Декларативное описание фабрики в YAML (`intent/inventory.yaml`, `intent/devices/*.yaml`).
2. **Шаблонизация**: Jinja2 шаблоны по вендорам (`templates/arista_eos/`, `templates/cisco_iosxe/`).
3. **Иерархический дифф**: Библиотека `hier_config` рассчитывает `remediation_patch` и `rollback_patch`.
4. **Бэкенд**: FastAPI + PostgreSQL (в проде) / SQLite (локально) + Celery/Redis (`backend/netops/`).
5. **Сетевой уровень**:
   - `backend/netops/network/base.py` — контракты `ConfigCollector`, `ConfigDeployer`, `HealthProbe`.
   - `backend/netops/network/offline.py` — эмулятор для локальной разработки.
   - `backend/netops/network/scrapli_driver.py` — живой драйвер для Containerlab по SSH.
6. **Фронтенд**: Vite + React 19 + TypeScript + Tailwind CSS + Three.js WebGL 3D Topology + Monaco Editor (`frontend/`).

---

## 🎯 Задачи для Jules (приоритеты)
Если ты подключен через GitHub App / jules.google.com или запускаешь задачи по issue:

### Приоритет 1: Huawei VRP Шаблоны и Драйвер
- В ТЗ заложена поддержка третьего вендора (`huawei_vrp`).
- Добавить шаблоны Jinja2: `templates/huawei_vrp/{base,interfaces,bgp}.j2`.
- Расширить `backend/netops/network/scrapli_driver.py` поддержкой `HuaweiVRPDriver`.

### Приоритет 2: Экспорт метрик в Prometheus
- Добавить эндпоинт `/metrics` в FastAPI для сбора статистики:
  - `netops_jobs_total{status, type}`
  - `netops_drift_detected_total`
  - `netops_node_health{hostname, status}`

### Приоритет 3: Тесты для 3D интерфейса и API
- Добавить тесты на новые роуты в `backend/tests/integration/test_api_devices.py`.
- Убедиться, что `uv run pytest` всегда завершается со 100% успехом (285+ тестов).

---

## 🛡️ Правила для изменений (Invariants)
- **Строгая типизация**: Pydantic v2 для моделей, TypeScript для фронтенда.
- **Никаких сломанных тестов**: перед каждым PR запускай `uv run pytest` и `npm run build` в `frontend/`.
- **Кодировка**: все файлы строго в UTF-8.
