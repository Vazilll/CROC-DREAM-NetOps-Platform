# Архитектура фабрики ЦОД «По-взрослому»: SDSM, Clos, eBGP и EVPN/VXLAN

> **Базовые источники**: 
> - Linkmeup SDSM (Сети для самых маленьких: `https://linkmeup.gitbook.io/sdsm`)
> - RFC 7938: *Use of BGP for Routing in Large-Scale Data Centers*
> - RFC 7432: *BGP MPLS-Based Ethernet VPN*
> - RFC 8365: *A Network Virtualization Overlay Solution Using BGP EVPN with VXLAN*

---

## 1. Сравнение подходов к построению фабрики ЦОД

| Параметр | Устаревший / Студенческий подход | Промышленный Enterprise-подход («По-взрослому») |
|---|---|---|
| **Топология** | L2 Spanning Tree (STP/RSTP), блокировка 50% портов, широковещательные штормы | **Clos (Leaf-Spine, 2-tier / 3-tier)**: строго L3-фабрика, 100% линков активны через ECMP (Equal-Cost Multi-Path). |
| **Маршрутизация Underlay** | OSPF / IS-IS с тяжелыми LSA, медленная сходимость в гетерогенных сетях | **Чистый eBGP Underlay (RFC 7938)**: у каждого Leaf свой приватный ASN (65101, 65102), у всех Spines единый ASN (65000). Нет циклических зависимостей, простая фильтрация AS-Path. |
| **P2P Линки** | Подсети /30 или /24, трата адресов | **Подсети /31 (RFC 3021)**: ровно 2 IP на линк (нулевой хост и единичный), либо IPv6 BGP Unnumbered (RFC 5549). |
| **MTU** | Стандартный 1500 байт (фрагментация пакетов оверлея) | **Jumbo Frames (MTU 9000-9216 байт)**: запас 50-54 байта под заголовки VXLAN/Geneve без фрагментации трафика клиентов. |
| **Обнаружение аварий** | Стандартные BGP таймеры (Keepalive 60s, Hold 180s) | **BFD (Bidirectional Forwarding Detection)**: интервалы 50-100 мс, обнаружение обрыва линка и переключение ECMP за < 300 мс. |
| **Сетевой оверлей (L2/L3)** | VLAN (лимит 4096), растянутый L2 через транки (риск падения всего ЦОД) | **MP-BGP EVPN / VXLAN (RFC 7432 / 8365)**: 16 миллионов VNI, инкапсуляция L2 фреймов в UDP 4789. Control Plane на BGP. |
| **Шлюз для серверов** | HSRP/VRRP (активен один коммутатор, тромбонинг трафика) | **Distributed Anycast Gateway (Symmetric IRB)**: одинаковый Virtual IP и Virtual MAC на всех Leaf. Хост шлет пакет в локальный Leaf без перегрузки Spines. |

---

## 2. Архитектура Underlay: eBGP Clos (RFC 7938)

### Схема распределения автономных систем (ASN)
```
       [ spine-1 (Cisco) ]              [ spine-2 (Arista) ]       <-- AS 65000 (Spine Layer)
          (10.255.0.1)                     (10.255.0.2)
             |      \                         /      |
       10.0.1.0/31   10.0.1.2/31       10.0.1.4/31   10.0.1.6/31
             |          \                 /          |
             |           \               /           |
       10.0.1.1/31        \             /        10.0.1.5/31
             |             \           /             |
       [ leaf-1 (Huawei) ]  \         /        [ leaf-2 (Huawei) ]
         AS 65101            \       /           AS 65102
       (10.255.0.11)          \     /          (10.255.0.12)
             |                 \   /                 |
       10.10.11.1/24            \ /            10.10.12.1/24
             |                   X                   |
       [ host-a (Linux) ]       / \            [ host-b (Linux) ]
        10.10.11.10/24                         10.10.12.10/24
```

### Принципы построения Underlay:
1. **Loopback-интерфейсы**:
   - `spine-1`: `10.255.0.1/32`
   - `spine-2`: `10.255.0.2/32`
   - `leaf-1`: `10.255.0.11/32`
   - `leaf-2`: `10.255.0.12/32`
   Анонсируются в eBGP Underlay. Служат `Router-ID` и источниками VTEP туннелей (`vxlan source-interface`).
2. **eBGP Peering**:
   - `spine-1` (AS 65000) <-> `leaf-1` (AS 65101) на `10.0.1.0/31`
   - `spine-1` (AS 65000) <-> `leaf-2` (AS 65102) на `10.0.1.2/31`
   - `spine-2` (AS 65000) <-> `leaf-1` (AS 65101) на `10.0.1.4/31`
   - `spine-2` (AS 65000) <-> `leaf-2` (AS 65102) на `10.0.1.6/31`
3. **ECMP Multipath**:
   - На каждом Leaf трафик до других Leaf балансируется по двум независимым путям через `spine-1` и `spine-2` (`maximum-paths 64` / `load-sharing`).

---

## 3. Архитектура Overlay: MP-BGP EVPN + VXLAN

### Ключевые компоненты:
1. **Address-Family L2VPN EVPN (AFI 25 / SAFI 70)**:
   - Обмен информацией о MAC-адресах и IP-маршрутах хостов через Control Plane BGP без лавинного флудинга (Flood and Learn устраняется).
2. **Типы маршрутов EVPN (RFC 7432)**:
   - **Type 2 (MAC/IP Advertisement)**: Анонс MAC- и IP-адреса конкретного подключенного хоста (например, `host-a` с IP `10.10.11.10` и его MAC) вместе с MPLS/VNI лейблом и IP адресом VTEP.
   - **Type 3 (Inclusive Multicast Ethernet Tag)**: Построение туннелей для Broadcast/Unknown Unicast/Multicast (BUM) трафика.
   - **Type 5 (IP Prefix Route)**: Межсетевая L3-маршрутизация для передачи целых подсетей без передачи отдельных MAC-адресов.
3. **Symmetric IRB (Integrated Routing and Bridging)**:
   - Роутинг между тенантными VRF происходит одинаково на Leaf-источнике и Leaf-приемнике через выделенный L3 VNI (Transit VNI), снижая нагрузку на Spines до роли чистых транзитных коммутаторов (IP Fabric).
