# Isolated Server Monitor MCP Server

Изолированный, безопасный MCP-сервер (Model Context Protocol) для мониторинга хоста и состояния сервера с соблюдением принципа наименьших привилегий (Least Privilege).

## Особенности безопасности и архитектура

1. **Только чтение (Read-Only)**: Сервер предоставляет строго диагностические метрики и не выполняет модификацию системы.
2. **Защита от произвольного выполнения команд**: Нет инструментов вида `exec`, `bash` или `shell`.
3. **Белый список systemd-сервисов**: Инструмент `get_service_status` разрешает опрос только предопределенного списка служб (например, `docker`, `nginx`, `postgresql`, `croc-backend`). Любые посторонние службы блокируются с возвратом ошибки доступа.
4. **Маскирование секретов в процессах**: Для `get_top_processes` аргументы командной строки фильтруются регулярными выражениями: пароли, токены, ключи API, Bearer-токены и connection string заменяются на `***MASKED***`.
5. **Безопасный вызов subprocess**: Вызовы `systemctl` выполняются со списком аргументов (`shell=False`) без использования шелла.
6. **Автономность и stdio-протокол**: Сервер реализует спецификацию JSON-RPC 2.0 MCP (2024-11-05) поверх стандартных потоков `stdin/stdout`. Работает напрямую через системный `python3` (при наличии `psutil`) или через `uv run`.

---

## Доступные инструменты (Tools)

| Инструмент | Описание | Параметры |
|---|---|---|
| `get_system_overview` | Сводка по CPU, RAM, Swap, Uptime, Load Averages, ОС и хосту | Нет |
| `get_disk_usage` | Метрики дисковых разделов и конкретных путей монтирования | `path` (строка, опционально, по умолчанию `/`) |
| `get_top_processes` | Топ процессов по CPU или RAM с маскированием секретов | `limit` (int, 1-50, по умолчанию 10), `sort_by` (`cpu` или `memory`) |
| `get_service_status` | Статус службы systemd из белого списка | `service_name` (строка, обязательно) |
| `list_whitelisted_services` | Список разрешенных для опроса служб | Нет |

---

## Быстрый запуск и тестирование

### 1. Встроенная самодиагностика
Выполнить опрос всех инструментов напрямую без MCP-клиента:
```bash
python3 tools/mcp_server_monitor/server.py --test
# или через uv:
uv run tools/mcp_server_monitor/server.py --test
```

### 2. Тестирование MCP stdio протокола
Запустить симуляцию MCP-клиента с проверкой handshake, ping, `tools/list` и `tools/call`:
```bash
python3 tools/mcp_server_monitor/test_mcp_client.py
```

---

## Конфигурация для MCP-клиентов

### 1. Claude Desktop (`claude_desktop_config.json`)
```json
{
  "mcpServers": {
    "server-monitor": {
      "command": "python3",
      "args": [
        "/home/tarhes/Проекты/app/CROC-DREAM-NetOps-Platform/tools/mcp_server_monitor/server.py"
      ],
      "env": {
        "ALLOWED_SERVICES": "docker,containerd,ssh,sshd,nginx,redis,postgresql,croc-backend,croc-frontend,cron,systemd-journald"
      }
    }
  }
}
```

### 2. Cursor (`.cursor/mcp.json` или Cursor Settings -> MCP)
```json
{
  "mcpServers": {
    "server-monitor": {
      "command": "python3",
      "args": [
        "/home/tarhes/Проекты/app/CROC-DREAM-NetOps-Platform/tools/mcp_server_monitor/server.py"
      ]
    }
  }
}
```

### 3. Запуск через `uv` (изолированное окружение на лету)
```json
{
  "mcpServers": {
    "server-monitor": {
      "command": "uv",
      "args": [
        "run",
        "--with",
        "psutil>=5.9.0",
        "/home/tarhes/Проекты/app/CROC-DREAM-NetOps-Platform/tools/mcp_server_monitor/server.py"
      ]
    }
  }
}
```

---

## Настройка белого списка служб
По умолчанию разрешены: `docker`, `containerd`, `ssh`, `sshd`, `nginx`, `redis`, `postgresql`, `croc-backend`, `croc-frontend`, `cron`, `crond`, `systemd-journald`, `systemd-networkd`, `systemd-resolved`, `ufw`, `iptables`.

Чтобы расширить белый список, передайте переменную окружения `ALLOWED_SERVICES` через запятую:
```bash
export ALLOWED_SERVICES="my-api,my-worker,nginx,docker"
```
