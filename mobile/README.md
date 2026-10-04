# CROC DREAM NetOps Cockpit (Flutter & Dart)

Кросс-платформенное приложение сетевого инженера на Dart/Flutter для управления и мониторинга гетерогенной сетевой инфраструктуры следующего поколения.

Поддерживает запуск на **iOS, Android, Windows, macOS, Linux и Web (Chrome)** с адаптивным интерфейсом под смартфоны, планшеты и мониторы высокого разрешения.

---

## Архитектура и Структура Проекта

Построено в соответствии с архитектурными стандартами `Flutter Layered Architecture` (UI, State/ViewModel, Domain/Data):

```text
mobile/
├── pubspec.yaml                 # Зависимости (http, provider, intl)
├── README.md                    # Архитектурная документация
├── test/
│   └── widget_test.dart         # Тесты рендеринга и переключения разделов
└── lib/
    ├── main.dart                # Точка входа, инициализация Provider и темы
    ├── models/
    │   ├── device.dart          # Модели Device, InterfaceIntent, BgpIntent
    │   ├── job.dart             # Модели Job, JobTarget, JobLog, DeviceDiff, JobDiff
    │   ├── drift.dart           # Модели DriftReportItem (детекция дрейфа)
    │   ├── forecast.dart        # Модели TimesFM-3.0 Forecast и ForecastAlert
    │   └── copilot.dart         # Модели AI Copilot и RiskExplanation
    ├── services/
    │   └── api_service.dart     # REST API клиент к FastAPI (127.0.0.1:8000 / 5.228.243.54:8000)
    │                            # с защищенным оффлайн-fallback режимом
    ├── state/
    │   └── netops_state.dart    # ViewModel (ChangeNotifier) с централизованным реактивным состоянием
    └── ui/
        ├── theme.dart           # Obsidian Neo-Brutalist дизайн-система
        ├── responsive_scaffold.dart # Адаптивный каркас: NavigationBar (< 768px) / NavigationRail (>= 768px)
        ├── command_palette.dart     # Палитра быстрого поиска и команд (Ctrl+K)
        ├── dry_run_modal.dart       # Диалог параметризованного запуска Dry-Run
        └── screens/
            ├── dashboard_screen.dart # KPI Bento Grid, мини-схема стенда, сводка задач
            ├── topology_screen.dart  # 6-узловой CLOS стенд (2 Arista + 2 Cisco + 2 Huawei) и Enterprise
            ├── devices_screen.dart   # Инвентарь, фильтрация по вендорам, детализация интерфейсов
            ├── diff_screen.dart      # HierConfig синтаксический дифф и транзакционный деплой (180s)
            ├── drift_screen.dart     # Отчет дрейфа конфигураций и автоматическое устранение (Remediate)
            ├── jobs_screen.dart      # Очередь задач, прогресс-бары и логи выполнения
            ├── telemetry_screen.dart # Спарклайны RTT/CPU и график прогнозирования TimesFM-3.0
            ├── chaos_lab_screen.dart # Инжекция сбоев: задержка, потери пакетов, разрыв BGP, блэкхол
            ├── copilot_screen.dart   # ИИ-ассистент на базе Google Gemini и TimesFM
            └── slides_screen.dart    # Презентационные слайды архитектуры платформы
```

---

## 10 Ключевых Разделов Системы

1. **Дашборд (Dashboard)**:
   - Bento Grid с метриками: всего узлов, % комплаенса, активный дрейф, выполненные задачи.
   - Быстрые действия: запуск Dry-Run, внеочередной скан, синхронизация с Git.
   - Сводка состояния CLOS стенда в реальном времени.

2. **Топология (Topology)**:
   - **CLOS Стенд**: 2x Spine (Arista EOS 4.32.0F) ↔ 2x Leaf (Cisco IOS-XE) + 2x Leaf (Huawei VRP) + 2x FW (Juniper Junos).
   - **Enterprise Иерархия**: WAN Gateway → HA Firewalls (DMZ) → Core Aggregation → Distribution Switches → Access VLANs.
   - Интерактивный тап по любому узлу открывает паспорт оборудования с BGP и интерфейсами.

3. **Инвентарь Устройств (Devices)**:
   - Поиск по имени и IP.
   - Мульти-вендорная фильтрация (`arista_eos`, `cisco_iosxe`, `huawei_vrp`, `juniper_junos`).
   - Паспорт устройства с деталями VLAN, MTU, L2/L3 режимами и BGP пирингом.

4. **HierConfig Дифф & Деплой (Diff & Deploy)**:
   - Цветовая подсветка дельты: зеленый (`+`) — добавление, красный (`-`) — удаление, синий (`!`) — контекст.
   - Встроенный AI Risk Assurance от Gemini.
   - Переключатель "План отката (Rollback patch)".
   - Кнопка двухфазного деплоя **Commit Confirmed (180 сек)** с защитой от потери управления.

5. **Контроль Дрейфа (Drift Compliance)**:
   - Автоматическое сопоставление running-config с эталоном Git.
   - Вывод несанкционированных строк и недостающих команд.
   - Кнопка **"Устранить дрейф (Remediate)"** для мгновенной генерации компенсирующего патча.

6. **Журнал Задач (Jobs Pipeline)**:
   - Очередь асинхронных задач (Celery / Background Worker).
   - Индикаторы прогресса и статусы (`SUCCESS`, `RUNNING`, `FAILED`).
   - Просмотр детальных системных логов с уровнями INFO / WARNING / ERROR.

7. **Телеметрия & TimesFM-3.0 AI (Telemetry & Forecast)**:
   - Сквозные спарклайны: Throughput (Mbps), Fabric Latency RTT (ms), CPU Load (%), RAM (%).
   - График нейросетевого прогноза TimesFM-3.0 с 90% доверительным интервалом и предупреждением за 45 минут до инцидента.

8. **Стресс-Лаборатория (Chaos Lab)**:
   - Инжекция сетевых сбоев: задержка +180ms, потеря пакетов 15%, разрыв eBGP пиринга, блэкхол коммутатора.
   - Мониторинг быстрой сходимости BGP и проверка резервирования ECMP.

9. **ИИ-Копилот (Copilot Panel)**:
   - Диалоговый интерфейс сетевого инженера с пресетами типовых запросов.
   - Анализ безопасности изменений и консультации по вендорным особенностям CLI.

10. **Презентация Архитектуры (Slides Deck)**:
    - Интерактивные слайды для демонстрации жюри и коллегам ключевых преимуществ платформы.

---

## Запуск Клиента

```bash
# Веб-версия (рекомендуется для быстрого превью в браузере):
flutter run -d chrome

# Нативная Windows-версия:
flutter run -d windows

# Смартфон (Android / iOS):
flutter run -d android
```
