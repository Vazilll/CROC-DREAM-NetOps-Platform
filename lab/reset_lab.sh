#!/usr/bin/env bash
set -u

START_TIME=$(date +%s)
echo "=============================================="
echo " [*] Lab Fast Reset started (Target: <= 10s)"
echo "=============================================="

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_DIR="${SCRIPT_DIR}/golden_configs"

# 1. Arista cEOS (Sysdb Cli)
reset_arista() {
  local node="$1"
  local cfg_file="$2"
  local container="clab-croc-dream-lab-${node}"
  local full_cfg="${CONFIG_DIR}/${cfg_file}"

  if [ ! -f "${full_cfg}" ]; then
    echo "[-] Arista ${node}: ${cfg_file} not found"
    return 1
  fi

  if docker inspect "${container}" > /dev/null 2>&1; then
    docker cp "${full_cfg}" "${container}:/mnt/flash/startup-config"
    # Восстановление конфига + фиксация пароля admin
    docker exec "${container}" Cli -p 15 -c "configure replace flash:startup-config" > /dev/null 2>&1
    docker exec "${container}" Cli -p 15 -c "configure"$'\n'"username admin privilege 15 secret admin"$'\n'"write memory" > /dev/null 2>&1
    echo "[+] Arista ${node}: restored (user: admin / pass: admin)"
  else
    echo "[-] Arista ${node}: not running"
  fi
}

# 2. Huawei CE12800 (VRP8)
reset_huawei() {
  local node="$1"
  local cfg_file="$2"
  local container="clab-croc-dream-lab-${node}"
  local full_cfg="${CONFIG_DIR}/${cfg_file}"

  if [ ! -f "${full_cfg}" ]; then
    echo "[-] Huawei ${node}: ${cfg_file} not found"
    return 1
  fi

  if docker inspect "${container}" > /dev/null 2>&1; then
    if docker exec -i "${container}" python3 -W ignore -c "
import telnetlib, sys, time

tn = telnetlib.Telnet('127.0.0.1', 5000, timeout=5)
tn.write(b'\r\nreturn\r\nn\r\nscreen-length 0 temporary\r\nsystem-view\r\n')
time.sleep(0.3)

for line in sys.stdin:
    cmd = line.strip()
    if not cmd or cmd.startswith('!'):
        continue
    if cmd == '#':
        tn.write(b'\r\nreturn\r\nsystem-view\r\n')
        continue
    if any(cmd.startswith(x) for x in [
        'device board',
        'authentication-scheme default',
        'authorization-scheme default',
        'accounting-scheme default',
        'domain default',
        'local-user admin password'
    ]):
        continue
    tn.write(cmd.encode('utf-8') + b'\r\n')
    time.sleep(0.012)

# Жестко фиксируем пароль admin перед коммитом
tn.write(b'\r\nsystem-view\r\naaa\r\nundo local-user policy security-enhance\r\nlocal-user admin password cipher admin\r\nlocal-user admin service-type ssh terminal\r\n')
tn.write(b'\r\nsystem-view\r\ncommit\r\nreturn\r\n')
time.sleep(2.5)
tn.close()
" < "${full_cfg}" 2>/tmp/"${node}".err; then
      echo "[+] Huawei ${node}: restored (user: admin / pass: admin)"
    else
      echo "[-] Huawei ${node}: failed (check /tmp/${node}.err)"
    fi
  else
    echo "[-] Huawei ${node}: not running"
  fi
}

# 3. Cisco C8000v (IOS-XE)
reset_cisco() {
  local node="$1"
  local cfg_file="$2"
  local container="clab-croc-dream-lab-${node}"
  local full_cfg="${CONFIG_DIR}/${cfg_file}"

  if [ ! -f "${full_cfg}" ]; then
    echo "[-] Cisco ${node}: ${cfg_file} not found"
    return 1
  fi

  if docker inspect "${container}" > /dev/null 2>&1; then
    if docker exec -i "${container}" python3 -W ignore -c "
import telnetlib, sys, time

tn = telnetlib.Telnet('127.0.0.1', 5000, timeout=5)
tn.write(b'\r\n')

# Авторизация в консоли IOS-XE
for _ in range(4):
    idx, match, text = tn.expect([br'[Uu]sername:', br'[Pp]assword:', br'#', br'>'], timeout=2)
    if idx == 0:
        tn.write(b'admin\r\n')
    elif idx == 1:
        tn.write(b'admin\r\n')
    elif idx == 2:
        break
    elif idx == 3:
        tn.write(b'enable\r\nadmin\r\n')
        break

tn.write(b'terminal length 0\r\nconfigure terminal\r\n')
time.sleep(0.3)

for line in sys.stdin:
    cmd = line.strip()
    if not cmd or cmd.startswith('!') or cmd.startswith('Building') or cmd.startswith('Current configuration') or cmd == 'end':
        continue
    # Пропускаем старые команды паролей, чтобы перезаписать их гарантированно в конце
    if cmd.startswith('username admin') or cmd.startswith('enable secret') or cmd.startswith('enable password'):
        continue
    tn.write(cmd.encode('utf-8') + b'\r\n')
    time.sleep(0.015)

# Выходим из любых интерфейсов в корень config и жестко задаем пароль admin
tn.write(b'\r\nexit\r\nexit\r\nusername admin privilege 15 secret admin\r\nenable secret admin\r\nend\r\n')
time.sleep(1)
tn.close()
" < "${full_cfg}" 2>/tmp/"${node}".err; then
      echo "[+] Cisco ${node}: restored (user: admin / pass: admin)"
    else
      echo "[-] Cisco ${node}: failed (check /tmp/${node}.err)"
    fi
  else
    echo "[-] Cisco ${node}: not running"
  fi
}

# --- Параллельный запуск всех 6 нод ---
reset_arista "spine-1-a" "spine-1-a.cfg" &
PID1=$!
reset_arista "spine-2-a" "spine-2-a.cfg" &
PID2=$!

reset_cisco "leaf-1-c" "leaf-1-c.cfg" &
PID3=$!
reset_cisco "leaf-2-c" "leaf-2-c.cfg" &
PID4=$!

reset_huawei "leaf-3-h" "leaf-3-h.cfg" &
PID5=$!
reset_huawei "leaf-4-h" "leaf-4-h.cfg" &
PID6=$!

wait "$PID1" "$PID2" "$PID3" "$PID4" "$PID5" "$PID6"

END_TIME=$(date +%s)
ELAPSED=$(( END_TIME - START_TIME ))
echo "=============================================="
echo "[+] All nodes restored in ${ELAPSED}s"
echo "=============================================="
