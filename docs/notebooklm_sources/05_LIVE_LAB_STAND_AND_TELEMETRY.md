# Живой лабораторный стенд CROC DREAM (5.228.243.54)

> **Хост-сервер стенда**: `srv-5-228-243-54` (`5.228.243.54`)  
> **SSH порт хоста**: `221` (пользователь: `crocdream`)  
> **Containerlab топология**: `/home/crocdream/clab-quickstart/fabric.clab.yaml`  

---

## 1. Параметры аппаратного хоста стенда

- **CPU Cores**: 8 ядер (Intel Xeon / KVM vCPU)
- **RAM**: 19 GiB всего (9.8 GiB занято, **9.5 GiB свободно**)
- **Накопитель**: 55 GB NVMe (40 GB занято, **13 GB свободно**)
- **Сетевой стек**: Docker 29.8, Containerlab v0.59+, vrnetlab

---

## 2. Карта проброса портов и узлы стенда

| Имя узла в Clab | Контейнер Docker | Модель / ОС | Внутренний IP clab_mgmt | Внешний SSH-порт | Логин / Пароль |
|---|---|---|---|---|---|
| **`spine1`** | `clab-dc-clos-cisco-arista-huawei-spine1` | Cisco Catalyst 8000v (IOS-XE 17.03.08a) | `172.20.20.6` | `5.228.243.54:2211` | `admin` / `F5ga6jfkig1` |
| **`spine2`** | `clab-dc-clos-cisco-arista-huawei-spine2` | Arista cEOSLab (EOS 4.32.0F) | `172.20.20.4` | `5.228.243.54:2212` | `admin` / `admin` (or `F5ga6jfkig2`) |
| **`leaf1`** | `clab-dc-clos-cisco-arista-huawei-leaf1` | Huawei CloudEngine 12800 (VRP 8.180) | `172.20.20.2` | `5.228.243.54:2221` | `admin` / `F5ga6jfkig` |
| **`leaf2`** | `clab-dc-clos-cisco-arista-huawei-leaf2` | Huawei CloudEngine 12800 (VRP 8.180) | `172.20.20.3` | `5.228.243.54:2222` | `admin` / `F5ga6jfkig2` |
| **`host-a`** | `clab-dc-clos-cisco-arista-huawei-host-a` | Alpine Linux (Client A: `10.10.11.10/24`) | `172.20.20.7` | `5.228.243.54:2231` | `root` / `root` |
| **`host-b`** | `clab-dc-clos-cisco-arista-huawei-host-b` | Alpine Linux (Client B: `10.10.12.10/24`) | `172.20.20.8` | `5.228.243.54:2232` | `root` / `root` |

---

## 3. Живая телеметрия и проверка BGP eBGP Underlay

### Cisco Spine-1:
```text
spine1#show ip bgp summary
BGP router identifier 10.255.0.1, local AS number 65000
Neighbor        V           AS MsgRcvd MsgSent   TblVer  InQ OutQ Up/Down  State/PfxRcd
10.0.1.1        4        65101     243     245        5    0    0 01:42:15        2
10.0.1.3        4        65102     242     245        5    0    0 01:42:12        2
```

### Arista Spine-2:
```text
spine2#show ip bgp summary
BGP summary information for VRF default
Router identifier 10.255.0.2, local AS number 65000
Neighbor        V           AS MsgRcvd MsgSent   InQ OutQ  Up/Down State   PfxRcd PfxAcc
10.0.1.5        4        65101     248     250     0    0 01:44:05 Estab   2      2
10.0.1.7        4        65102     247     250     0    0 01:44:01 Estab   2      2
```

### Huawei Leaf-1:
```text
<leaf1>display bgp peer
 BGP local router ID : 10.255.0.11
 Local AS number : 65101
 Total number of peers : 2                 Peers in established state : 2

  Peer            V          AS  MsgRcvd  MsgSent  OutQ  Up/Down       State  PrefRcv
  10.0.1.0        4       65000      245      243     0 01:42:16 Established        1
  10.0.1.4        4       65000      250      248     0 01:44:06 Established        1
```
