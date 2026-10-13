# Мультивендорная спецификация: 6 поддерживаемых платформ

> **Требование ТЗ КРОК**: Поддержка не менее 6 вендоров (зарубежные и отечественные) с унифицированным управлением и сбором телеметрии.

---

## 1. Сводная матрица поддерживаемых вендоров

| № | Вендор | Платформа / NOS | Тип | Механизм Safe Commit / Rollback | Протоколы автоматизации |
|---|---|---|---|---|---|
| **1** | **Cisco Systems** | Cisco IOS-XE (Catalyst 8000v / CSR1000v) | Зарубежный | `commit confirmed <min>` / `archive config rollback` | SSH (Scrapli), NETCONF, RESTCONF |
| **2** | **Arista Networks** | Arista EOS (cEOSLab 4.32) | Зарубежный | `configure session` -> `commit` / `rollback` | eAPI (JSON-RPC), SSH (Scrapli) |
| **3** | **Huawei** | Huawei VRP (CloudEngine 12800) | Зарубежный | Двухфазный коммит: `commit` / `rollback configuration` | SSH (STELNET), NETCONF |
| **4** | **Juniper Networks** | Junos OS (vMX / QFX) | Зарубежный | `commit confirmed <min>` / `rollback <0-49>` | PyEZ, NETCONF (XML/YANG), SSH |
| **5** | **Eltex** | Eltex MES (MES2324 / MES5324) | Отечественный | `copy running startup` / таймер подтверждения | SSH, CLI, SNMPv2c/v3 |
| **6** | **Yadro** | Yadro Kornfe NOS | Отечественный | Теневая сессия конфигурации / `commit` | OpenConfig (gNMI/gNOI), REST, SSH |

---

## 2. Команды снятия телеметрии и проверки здоровья

### 1. Cisco IOS-XE
- **Инвентаризация и версия**: `show version`, `show inventory`
- **Интерфейсы и ошибки**: `show ip interface brief`, `show interfaces | include CRC|input errors|output errors`
- **Маршрутизация BGP**: `show ip bgp summary`, `show ip route`
- **Загрузка ресурсов**: `show processes cpu sorted | exclude 0.00`, `show memory statistics`

### 2. Arista EOS
- **Инвентаризация и версия**: `show version`, `show inventory`
- **Интерфейсы**: `show interfaces status`, `show ip interface brief`
- **BGP**: `show ip bgp summary` (доступно в JSON через eAPI: `{"json_format": true}`)
- **Загрузка ресурсов**: `show processes top once`

### 3. Huawei CloudEngine VRP
- **Инвентаризация и версия**: `display version`, `display device`
- **Интерфейсы**: `display ip interface brief`, `display interface description`
- **BGP**: `display bgp peer`
- **Загрузка ресурсов**: `display cpu-usage`, `display memory-usage`

### 4. Juniper Junos
- **Инвентаризация**: `show chassis hardware`, `show version`
- **Интерфейсы**: `show interfaces terse`
- **BGP**: `show bgp summary`
- **Ресурсы**: `show system processes extensive`

### 5. Eltex MES
- **Инвентаризация**: `show system`, `show version`
- **Интерфейсы**: `show interfaces status`
- **Маршрутизация**: `show ip bgp summary`, `show ip route`

### 6. Yadro Kornfe NOS
- **Инвентаризация**: `show system-info`, `show environment`
- **Интерфейсы и BGP**: `show ip interface brief`, `show ip bgp summary`
