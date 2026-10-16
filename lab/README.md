# Лабораторный стенд (`lab/`) — Golden Configs & Offline Emulation

Каталог `lab/` отвечает за эталонные конфигурации узлов CLOS-фабрики, локальную файловую эмуляцию сети (`OfflineLab`) и скрипты быстрого восстановления стенда.

После запуска containerlab'а необходимо подожать 2-3 минуты до загрузки коммутаторов, после запустить reset_lab.sh для приведения коммутаторв Huawei в нормальное состояние. 

---

## Структура каталога

```
lab/
├── README.md                  # Этот документ
├── reset_lab.sh               # Скрипт принудительного сброса живого стенда Containerlab к эталону
├── golden_configs/            # Неизменяемые эталонные («золотые») конфиги узлов фабрики
│   ├── spine1.cfg             # Эталон Cisco IOS-XE (spine-1.croc.lab)
│   ├── spine2.cfg             # Эталон Arista EOS   (spine-2.croc.lab)
│   ├── leaf1.cfg              # Эталон Huawei VRP   (leaf-1.croc.lab)
│   └── leaf2.cfg              # Эталон Huawei VRP   (leaf-2.croc.lab)
└── running/                   # Рабочая директория эмулятора OfflineLab и локального runtime-состояния
    ├── spine-1.croc.lab.cfg   # Текущий running-config узла spine-1 в режиме offline
    ├── spine-2.croc.lab.cfg   # Текущий running-config узла spine-2 в режиме offline
    ├── leaf-1.croc.lab.cfg    # Текущий running-config узла leaf-1 в режиме offline
    ├── leaf-2.croc.lab.cfg    # Текущий running-config узла leaf-2 в режиме offline
    └── *.json / *.jsonl       # Runtime-кэши (telemetry_cache.json, access_registry.json, emergency_audit.jsonl — в .gitignore)
```

---

## Как работают режимы стенда

1. **Режим `offline` (`NETOPS_NETWORK_DRIVER=offline`)**:
   - Драйвер [`backend/netops/network/offline.py`](file:///home/tarhes/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/app/CROC-DREAM-NetOps-Platform/backend/netops/network/offline.py) читает и модифицирует файлы `lab/running/<hostname>.cfg`.
   - Позволяет запускать весь цикл `Dry-Run → Deploy → Drift Scan → Remediate → Chaos Lab` на любом ноутбуке и в CI/CD без поднятия виртуальных машин.
   - При нажатии **«Сбросить к эталону (Golden Baseline)»** в UI или вызове `POST /api/v1/devices/reset-golden` файлы из `lab/golden_configs/` копируются в `lab/running/`.

2. **Режим `scrapli` (`NETOPS_NETWORK_DRIVER=scrapli`)**:
   - Драйвер [`backend/netops/network/scrapli_driver.py`](file:///home/tarhes/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/app/CROC-DREAM-NetOps-Platform/backend/netops/network/scrapli_driver.py) подключается по SSH к реальным контейнерам/VM маршрутизаторов в Containerlab (`5.228.243.54`).
   - Скрипт [`reset_lab.sh`](file:///home/tarhes/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/app/CROC-DREAM-NetOps-Platform/lab/reset_lab.sh) позволяет одним вызовом вернуть все живые узлы Containerlab к эталонному состоянию `golden_configs/`.
