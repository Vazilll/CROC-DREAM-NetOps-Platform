# CROC NetOps Mobile & Desktop Client (Dart / Flutter)

Кросс-платформенный клиент NetOps Platform на Dart/Flutter для мониторинга и управления сетью на смартфонах и ноутбуках.

## Архитектура и возможности
- **Адаптивный интерфейс (Responsive Viewport)**:
  - **Смартфон (< 768px)**: BottomNavigationBar, карточки инвентаря, быстрые шторки действий (Dry-Run / Remediate), touch-оптимизированные контролы.
  - **Ноутбук / Планшет (>= 768px)**: NavigationRail, полноразмерная сетка Bento Grid, детальные спарклайны телеметрии.
- **Два режима интерактивной топологии**:
  1. *CLOS Дата-центр (Стенд)*: 2x Spine (Arista EOS) ↔ 2x Leaf (Cisco IOS-XE / Arista).
  2. *Иерархическая корпоративная сеть (Enterprise)*: WAN -> Edge Firewalls (DMZ) -> Core Switch -> Distribution Switches -> Access Switches -> Workstations (Data VLAN 10 / Voice VLAN 20).
- **Сквозная телеметрия**: графики пропускной способности (Throughput Mbps), задержки (Latency ms), потерь пакетов и утилизации CPU.
- **Интеграция с REST API**: прямое подключение к FastAPI бэкенду на `http://5.228.243.54:8000` с fallback-режимом для автономного предпросмотра.

## Запуск
```bash
# Веб-версия (в браузере):
flutter run -d chrome

# Десктоп-версия (Windows / macOS / Linux):
flutter run -d windows

# Мобильная версия (Android / iOS):
flutter run -d android
```
