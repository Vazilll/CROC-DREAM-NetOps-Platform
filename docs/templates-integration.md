# Шаблоны Jinja2: что взято из набора Тимура и где реализовано

Тимур прислал архив `j2templates` с шаблонами под Cisco, Arista и Huawei. Как есть они с бэкендом
не работали: папки назывались `cisco` / `arista` / `huawei` вместо значений платформы
(`cisco_iosxe`, `arista_eos`, `huawei_vrp`), в шаблонах использовались переменные верхнего уровня
(`{{ hostname }}`, `{{ interfaces }}`, `{{ bgp }}`) вместо нашего контекста (`device`, `intent`),
а `ipv4_address.split('/')` падало, потому что в контекст приходит объект `ipaddress`, а не строка.

Поэтому из набора взяты четыре решения и перенесены в наши шаблоны. Ниже — что именно, с исходной
строкой и реализацией.

## 1. Loopback из `bgp.router_id`

**У Тимура** (`cisco/interfaces.j2`, то же в `arista` и `huawei`):

```jinja
{% if bgp is defined and bgp.router_id is defined %}
interface Loopback0
 description Router-ID
 ip address {{ bgp.router_id }} 255.255.255.255
{% endif %}
```

**Реализовано в:**

- `templates/cisco_iosxe/interfaces.j2`
- `templates/arista_eos/interfaces.j2`
- `templates/huawei_vrp/interfaces.j2`

```jinja
{% set declared = intent.interfaces | map(attribute="name") | join(" ") | lower %}
{% if intent.bgp and "loopback" not in declared %}
interface LoopBack0
 description Router-ID
 ip address {{ intent.bgp.router_id }} 255.255.255.255
{% endif %}
```

Отличия от исходника: контекст `intent.bgp`; проверка значения вместо `is defined` (с
`StrictUndefined` поле всегда определено, но может быть пустым); добавлена защита — если Loopback
уже описан в intent, второй не генерируется. Имя и маска по вендорам: `Loopback0` и десятичная
маска у Cisco, `Loopback0` с `/32` у Arista, `LoopBack0` у Huawei.

**Зачем.** В `intent/devices/*.yaml` Loopback не описан, а на устройствах он есть и на нём
router-id. Без этой генерации патч наката содержал `no interface Loopback0`, то есть деплой удалил
бы интерфейс с router-id и развалил BGP на всех узлах.

## 2. `negotiation auto` на физических портах Cisco

**У Тимура** (`cisco/interfaces.j2`): строка `negotiation auto` в конце каждого интерфейса.

**Реализовано в** `templates/cisco_iosxe/interfaces.j2`:

```jinja
{% if not iface.name.lower().startswith("loopback") %}
 negotiation auto
{% endif %}
```

Добавлено исключение для Loopback — такой команды у него быть не может.

**Зачем.** Команда есть на всех физических портах стенда, а в нашем шаблоне её не было, поэтому
патч на каждом прогоне выдавал `no negotiation auto`.

## 3. Вид секции BGP у Cisco

**У Тимура** (`cisco/bgp.j2`): строки `bgp log-neighbor-changes` и `address-family ipv4`.

**Реализовано в** `templates/cisco_iosxe/bgp.j2`:

```diff
  bgp router-id {{ intent.bgp.router_id }}
+ bgp log-neighbor-changes
- address-family ipv4 unicast
+ address-family ipv4
```

**Зачем.** На устройстве секция называется `address-family ipv4`, а `log-neighbor-changes` включён.
Из-за расхождения патч переписывал всю секцию BGP на каждом прогоне.

## 4. Синтаксис Huawei VRP

Шаблоны `huawei/*.j2` использованы как справка по командам VRP; файлы переписаны под наш контекст.
Каждая команда дополнительно сверена с конфигом со стенда `lab/golden_configs/leaf1.cfg`.

| Конструкция | Файл |
|---|---|
| `sysname` вместо `hostname` | `templates/huawei_vrp/base.j2` |
| `undo portswitch` для L3-порта | `templates/huawei_vrp/interfaces.j2` |
| `undo shutdown` вместо `no shutdown` | `templates/huawei_vrp/interfaces.j2` |
| `ip address <адрес> <десятичная маска>` | `templates/huawei_vrp/interfaces.j2` |
| `bgp <asn>` без `router` | `templates/huawei_vrp/bgp.j2` |
| `peer <ip> as-number <asn>`, `peer <ip> description` | `templates/huawei_vrp/bgp.j2` |
| `ipv4-family unicast`, `undo synchronization` | `templates/huawei_vrp/bgp.j2` |
| `network <адрес> <маска>`, `peer <ip> enable` | `templates/huawei_vrp/bgp.j2` |
| `acl name <имя> advance` с `rule ...` | `templates/huawei_vrp/acls.j2` |

До этого шаблонов для Huawei не было вообще, и dry-run на `leaf-1` и `leaf-2` падал с ошибкой
`No templates found for platform huawei_vrp`.

## Что из набора не взято

| Что | Почему |
|---|---|
| `enable password`, `username ... password`, `local-user ... irreversible-cipher`, хэш sha512 | Секреты в Git, и пароль уехал бы в конфиг устройства. Учётки берутся из `NETOPS_AUTH_PROFILES` в `.env` |
| `GigabitEthernet1`, `vrf clab-mgmt`, `line vty`, `ssh`, `netconf`, `ip route` | Эти секции не входят в `managed_sections` (`backend/netops/network/diff_filters.yaml`), в сравнении не участвуют — генерировать их незачем |
| `mask_map` — словарь масок вручную | Покрывал только `/32, /31, /30, /24, /16`; любая другая маска молча превращалась в `255.255.255.0`, то есть неверный конфиг без ошибки. У нас маска берётся из объекта адреса (`iface.ipv4_address.netmask`) |
| `hostname.split('.')[0] \| replace('-','')` | Подгоняет имя под стенд, но тогда intent перестаёт быть источником правды. Открытый вопрос, см. ниже |
| `version 17.3`, `service timestamps`, `platform qfp`, `spanning-tree mode mstp`, `ipv6 address`, `transceiver qsfp` | Либо отбрасываются фильтрами нормализации, либо захардкожены под конкретную ноду |

Файлы из архива в репозиторий не добавлялись: перенесены только перечисленные решения.

## Проверка

Dry-run на всех четырёх устройствах против реальных конфигов стенда — `SUCCESS`, патчи минимальные:

| Устройство | Платформа | Накат |
|---|---|---|
| leaf-1.croc.lab | huawei_vrp | `undo sysname leaf1` / `sysname leaf-1.croc.lab` |
| leaf-2.croc.lab | huawei_vrp | `undo sysname leaf2` / `sysname leaf-2.croc.lab` |
| spine-1.croc.lab | cisco_iosxe | `no hostname spine1` / `hostname spine-1.croc.lab` |
| spine-2.croc.lab | arista_eos | `hostname spine-2.croc.lab` |

Интерфейсы, адреса, BGP и анонсы совпадают с эталоном — расхождений нет.

## Состояние на 14 октября

После обновления intent по адресному плану Ани (10.10.0.x, Loopback описан явно) и правок
шаблонов dry-run на всех четырёх устройствах не находит расхождений — стенд полностью совпадает
с эталоном. Что для этого добавлено:

- `acl_in` у интерфейса в intent: фильтр `FABRIC-IN` объявлен на фабричных портах, как на стенде,
  и больше не навешивается на клиентские. Шаблоны всех трёх платформ берут имя оттуда, а не из
  захардкоженной строки; неизвестное имя ACL ловится при валидации;
- `ip routing` возвращён в шаблон Arista (без него патч выключал маршрутизацию на spine-2);
- `no bgp default ipv4-unicast` добавлен в шаблон Cisco, как на устройстве;
- `traffic-filter inbound` у Huawei.

## Открытые вопросы

1. **`hostname`.** В intent FQDN (`spine-1.croc.lab`), на стенде короткие имена (`spine1`). Это
   единственный оставшийся дрейф. Нужно решение: приводим стенд к FQDN или меняем intent.
2. **Loopback в intent.** Сейчас он генерируется из `router_id`. Правильнее описать его в
   `intent/devices/*.yaml` как обычный интерфейс — тогда генерация не понадобится.
3. **ACL.** В intent пустые (`acls: []`), на стенде отсутствуют. Шаблоны `acls.j2` написаны, но не
   проверены на устройствах. Секция `ip access-list` / `acl name` участвует в сравнении, поэтому
   незаполненный шаблон приведёт к удалению ACL с оборудования.
4. **Eltex.** Шаблонов нет, ноды на стенде тоже. Платформа `eltex_esr` в бэкенде поддержана.

## Как добавлять шаблоны дальше

Путь: `<TEMPLATES_PATH>/<платформа>/{base,interfaces,acls,bgp}.j2`, склеиваются в этом порядке,
отсутствующие секции пропускаются. Значение платформы — из `netops/enums.py`: `cisco_iosxe`,
`arista_eos`, `huawei_vrp`, `eltex_esr`.

В контексте две переменные:

- `device` — `InventoryDevice`: `hostname`, `management_ip`, `management_port`, `platform`, `role`,
  `auth_profile`;
- `intent` — `DeviceIntent`: `hostname`, `interfaces`, `bgp`, `acls`.

Адреса — объекты `ipaddress`: `iface.ipv4_address.ip`, `.netmask`, `.with_prefixlen`,
`prefix.network_address`, `prefix.hostmask`. Неизвестная переменная — ошибка (`StrictUndefined`),
поэтому вместо `is defined` проверяйте значение: `{% if iface.ipv4_address %}`.

Проверить шаблоны:

```bash
cd backend && uv run pytest tests/integration/test_repo_data.py
```

Тест рендерит шаблоны для каждого устройства из `intent/inventory.yaml` и падает, если какой-то
шаблон не собрался.
