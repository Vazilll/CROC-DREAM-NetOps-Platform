# NetOps Platform MCP Server

Model Context Protocol (MCP) сервер для интеграции внешних ИИ-агентов с платформой автоматизации сетей **CROC DREAM NetOps Platform**.

## Предоставляемые инструменты (Tools)

1. `get_platform_health` — Проверка доступности API платформы, готовности БД и состояния выключателя экстренной блокировки (Factory Freeze).
2. `list_devices` — Просмотр сетевых устройств фабрики (Spine, Leaf, Border) с фильтрацией по платформе (Arista EOS, Cisco IOS-XE, Huawei VRP) и роли.
3. `get_drift_report` — Получение отчетов о дрейфе конфигураций (несанкционированные изменения относительно Git Single Source of Truth).
4. `trigger_dry_run` — Безопасный запуск пайплайна dry-run для валидации планируемых изменений без их применения к оборудованию.
5. `get_job_status` — Проверка статуса, целевых устройств и пошаговых логов выполнения задач.
6. `explain_config_risk` — Получение объяснения рисков и оценки безопасности конфигурационных изменений через AI Guard платформы.

## Переменные окружения

* `NETOPS_API_URL` — базовый URL к REST API платформы (по умолчанию: `http://127.0.0.1:8000/api/v1`).
* `NETOPS_API_TOKEN` — токен авторизации (по умолчанию: `dev-operator-token`).

## Проверка работы

```bash
python3 tools/mcp_netops_platform/test_client.py
```
