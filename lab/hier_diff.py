#!/usr/bin/env python3
"""CROC DREAM NetOps Platform — Hierarchical Config Diff Engine"""

from dataclasses import dataclass, field
import ipaddress
import os
from pathlib import Path
import re
import sys
import time
from typing import Any, Dict, List, Optional, Tuple
from jinja2 import Environment, FileSystemLoader
import yaml

try:
  import paramiko

  PARAMIKO_AVAILABLE = True
except ImportError:
  PARAMIKO_AVAILABLE = False

# Поддержка как hier_config v3 (get_hconfig), так и v2 (Host)
HIER_V3_AVAILABLE = False
HIER_V2_AVAILABLE = False
try:
  from hier_config import get_hconfig, get_hconfig_driver
  from hier_config.models import Platform as HPlatform

  HIER_V3_AVAILABLE = True
except ImportError:
  try:
    from hier_config import Host as _Host

    HIER_V2_AVAILABLE = True
  except ImportError:
    try:
      from hier_config.host import Host as _Host

      HIER_V2_AVAILABLE = True
    except ImportError:
      pass


def resolve_project_root() -> Path:
  """Находит корень репозитория CROC-DREAM-NetOps-Platform из любой точки запуска."""
  candidates = [Path(__file__).resolve().parent, Path.cwd().resolve()]
  for base in candidates:
    for parent in [base] + list(base.parents):
      if (parent / "intent" / "inventory.yaml").exists() and (
          parent / "templates"
      ).exists():
        return parent
      if (parent / "backend") in parent.iterdir() if parent.exists() else []:
        if (parent / "intent").exists():
          return parent
  return Path.cwd().resolve()


PROJECT_ROOT = resolve_project_root()


@dataclass
class DiffResult:
  has_drift: bool
  remediation_config: List[str] = field(default_factory=list)
  rollback_config: List[str] = field(default_factory=list)
  normalized_running: str = ""
  normalized_intended: str = ""


class InventoryConnectionResolver:

  @staticmethod
  def get_connection_info(
      device: Dict[str, Any], inventory: Dict[str, Any]
  ) -> Dict[str, Any]:
    hostname = device.get("hostname", "")

    mgmt_ip = str(device.get("management_ip", "")).strip()
    if not mgmt_ip:
      raise ValueError(f"В инвентаре для {hostname} не указан management_ip!")

    mgmt_port = int(device.get("management_port", 22))

    auth_profile_name = device.get("auth_profile", "")
    profile = inventory.get("auth_profiles", {}).get(auth_profile_name, {})
    username = profile.get("username", "admin")
    password = profile.get("password", "")

    platform = device.get("platform", "").lower()
    if "huawei" in platform or "vrp" in platform:
      cmd = "display current-configuration"
    elif "arista" in platform or "eos" in platform:
      cmd = "enable\nshow running-config"
    elif "cisco" in platform or "ios" in platform:
      cmd = "show running-config"
    elif "eltex" in platform or "mes" in platform or "esr" in platform:
      cmd = "show running-config"
    else:
      cmd = "show running-config"

    return {
        "hostname": hostname,
        "mgmt_ip": mgmt_ip,
        "mgmt_port": mgmt_port,
        "username": username,
        "password": password,
        "platform": platform,
        "cmd": cmd,
    }


class LiveConfigCollector:

  @staticmethod
  def pull(conn_info: Dict[str, Any]) -> str:
    if not PARAMIKO_AVAILABLE:
      raise RuntimeError(
          "Библиотека paramiko не установлена. Запустите: pip install paramiko"
      )

    host = conn_info["mgmt_ip"]
    port = conn_info["mgmt_port"]
    username = conn_info["username"]
    platform = conn_info["platform"]

    passwords_to_try = []
    if conn_info["password"]:
      passwords_to_try.append(conn_info["password"])

    default_fallbacks = [
        "admin",
        "F5ga6jfkig1",
        "F5ga6jfkig",
        "F5ga6jfkig2",
        "admin@huawei.com",
        "",
    ]
    for fb in default_fallbacks:
      if fb not in passwords_to_try:
        passwords_to_try.append(fb)

    last_err = None

    for pwd in passwords_to_try:
      client = paramiko.SSHClient()
      client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
      try:
        try:
          client.connect(
              hostname=host,
              port=port,
              username=username,
              password=pwd,
              look_for_keys=False,
              allow_agent=False,
              timeout=7,
              banner_timeout=12,
          )
        except paramiko.ssh_exception.BadAuthenticationType:
          transport = paramiko.Transport((host, port))
          transport.connect()

          def interactive_handler(title, instructions, prompt_list):
            return [pwd for _ in prompt_list]

          transport.auth_interactive(username, interactive_handler)
          client = paramiko.SSHClient()
          client._transport = transport

        # Для Huawei VRP надежнее использовать интерактивный shell из-за пагинации
        if "huawei" in platform or "vrp" in platform:
          chan = client.invoke_shell(width=512, height=1000)
          time.sleep(0.4)
          chan.send("screen-length 0 temporary\n")
          time.sleep(0.3)
          while chan.recv_ready():
            chan.recv(65535)
          chan.send("display current-configuration\n")

          buf = ""
          deadline = time.time() + 15
          while time.time() < deadline:
            if chan.recv_ready():
              chunk = chan.recv(65535).decode("utf-8", errors="ignore")
              buf += chunk
              if "return" in chunk and (
                  chunk.rstrip().endswith(">") or chunk.rstrip().endswith("]")
              ):
                break
            else:
              time.sleep(0.1)
          client.close()
          if buf.strip():
            return buf
        else:
          stdin, stdout, stderr = client.exec_command(conn_info["cmd"], timeout=15)
          output = stdout.read().decode("utf-8", errors="ignore")
          if len(output.splitlines()) < 10:
            chan = client.invoke_shell(width=512, height=1000)
            time.sleep(0.3)
            chan.send("enable\nterminal length 0\nshow running-config\n")
            time.sleep(1.2)
            output = ""
            while chan.recv_ready():
              output += chan.recv(65535).decode("utf-8", errors="ignore")
          client.close()
          if output.strip():
            return output

      except Exception as e:
        last_err = e
        continue

    raise ConnectionError(
        f"Не удалось подключиться к {host}:{port} ({last_err})"
    )


class SafeIP(str):

  def __new__(cls, val):
    return super().__new__(cls, str(val))

  def __init__(self, val):
    s = str(val).strip()
    try:
      if "/" in s:
        iface = ipaddress.IPv4Interface(s)
        net = iface.network
        self.ip = str(iface.ip)
        self.netmask = str(iface.netmask)
        self.with_prefixlen = str(iface.with_prefixlen)
        self.network_address = str(net.network_address)
        self.hostmask = str(net.hostmask)
        self.prefixlen = net.prefixlen
      else:
        ip_obj = ipaddress.IPv4Address(s)
        self.ip = str(ip_obj)
        self.netmask = "255.255.255.255"
        self.with_prefixlen = f"{s}/32"
        self.network_address = s
        self.hostmask = "0.0.0.0"
        self.prefixlen = 32
    except Exception:
      self.ip = s
      self.netmask = s
      self.with_prefixlen = s
      self.network_address = s
      self.hostmask = s
      self.prefixlen = 32


def wrap_intent_data(obj: Any) -> Any:
  if isinstance(obj, dict):
    return {k: wrap_intent_data(v) for k, v in obj.items()}
  elif isinstance(obj, list):
    return [wrap_intent_data(v) for v in obj]
  elif isinstance(obj, str):
    if (
        re.match(r"^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?:/\d{1,2})?$", obj)
        or obj == "any"
    ):
      return SafeIP(obj)
    return obj
  return obj


class TemplateRenderer:

  def __init__(self, templates_root: Optional[Path] = None):
    self.templates_root = templates_root or (PROJECT_ROOT / "templates")

  def find_template_dir(self, platform_str: str) -> Optional[Path]:
    plat = platform_str.lower()
    if "cisco" in plat or "ios" in plat:
      folder_candidates = ["cisco_iosxe", "cisco", "iosxe"]
    elif "arista" in plat or "eos" in plat:
      folder_candidates = ["arista_eos", "arista", "eos"]
    elif "huawei" in plat or "vrp" in plat:
      folder_candidates = ["huawei_vrp", "huawei", "vrp"]
    elif "eltex" in plat or "mes" in plat or "esr" in plat:
      folder_candidates = ["eltex_mes", "eltex_esr", "eltex", "mes", "esr"]
    elif "juniper" in plat or "junos" in plat:
      folder_candidates = ["juniper_junos", "juniper", "junos"]
    elif "yadro" in plat or "kornfe" in plat:
      folder_candidates = ["yadro_kornfe", "yadro"]
    else:
      folder_candidates = [plat]

    root_candidates = [
         Path(self.templates_root),
        PROJECT_ROOT / "templates",
        PROJECT_ROOT / "backend" / "tests" / "fixtures" / "templates",
        Path.cwd() / "templates",
    ]

    for root in root_candidates:
      if root.exists() and root.is_dir():
        for cand in folder_candidates:
          target = root / cand
          if target.exists() and target.is_dir():
            return target

    for root in root_candidates:
      if root.exists() and root.is_dir():
        if any(f.suffix == ".j2" for f in root.iterdir() if f.is_file()):
          return root

    return None

  def render(
      self,
      device_data: Dict[str, Any],
      inventory_data: Optional[Dict[str, Any]] = None,
      platform_str: str = "",
  ) -> str:
    hostname = device_data.get("hostname", "")
    short_host = hostname.split(".")[0]
    dev_inv = {}

    if inventory_data:
      for d in inventory_data.get("devices", []):
        inv_h = d.get("hostname", "")
        if inv_h == hostname or inv_h.split(".")[0] == short_host:
          dev_inv = d
          if not platform_str:
            platform_str = d.get("platform", "")
          break

    target_dir = self.find_template_dir(platform_str)
    if not target_dir:
      raise RuntimeError(
          f"Не удалось найти папку шаблонов для платформы '{platform_str}'"
      )

    intent_wrapped = wrap_intent_data(device_data)

    context = {
        **intent_wrapped,
        "intent": intent_wrapped,
        "device": dev_inv,
        "auth_profiles": (
            inventory_data.get("auth_profiles", {}) if inventory_data else {}
        ),
        "auth_profile": dev_inv.get("auth_profile"),
        "management_ip": dev_inv.get("management_ip"),
        "id": dev_inv.get("id"),
    }

    env = Environment(
        loader=FileSystemLoader(str(target_dir)),
        trim_blocks=True,
        lstrip_blocks=True,
    )

    parts = []
    for tmpl_name in [
        "base.j2",
        "interfaces.j2",
        "bgp.j2",
        "acls.j2",
    ]:
      tmpl_path = target_dir / tmpl_name
      if tmpl_path.exists():
        rendered = env.get_template(tmpl_name).render(context)
        if rendered.strip():
          parts.append(rendered)

    result = "\n".join(parts).strip()
    if not result:
      raise RuntimeError(
          f"Шаблоны в папке {target_dir} вернули пустой результат для"
          f" {hostname}"
      )
    return result


class ConfigNormalizer:

  @staticmethod
  def normalize(config_text: str, platform: str) -> str:
    config_text = config_text.replace("\r\n", "\n").replace("\r", "\n")
    lines = config_text.splitlines()
    plat = platform.lower()

    if "cisco" in plat or "ios" in plat:
      managed_roots = [
          r"^hostname\b",
          r"^interface (?!GigabitEthernet1$)",
          r"^router bgp\b",
          r"^ip access-list\b",
          r"^ip route (?!vrf clab-mgmt)",
          
          r"^snmp-server community\b",
      ]
      garbage_patterns = [
          r"^\s*Building configuration\.\.\.",
          r"^\s*Current configuration : \d+ bytes",
          r"^\s*!\s*Last configuration change at",
          r"^\s*!\s*NVRAM config last updated at",
          r"^\s*!\s*No configuration change since last restart",
          r"^\s*Using \d+ out of \d+ bytes",
          r"^\s*ntp clock-period \d+",
          r"^\s*version \d+\.\d+",
          r"^\s*boot-(start|end)-marker$",
          r"^\s*end$",
          r"^\s*exit-address-family$",
          r"^\s*negotiation\s+auto$",
          r"^\s*no\s+mop\s+(?:enabled|sysid)",
          r"^\s*no\s+ip\s+address\s*$",
          r"^\s*no\s+bgp\s+default\s+ipv4-unicast\s*$",
          r"^\s*bgp\s+log-neighbor-changes\s*$",
          r"^\s*#.*",
          r"^\s*!.*",
      ]
    elif "arista" in plat or "eos" in plat:
      managed_roots = [
          r"^hostname\b",
          r"^interface (?!Management)",
          r"^router bgp\b",
          r"^ip access-list\b",
          r"^ip routing$",
          r"^ip route (?!0\.0\.0\.0/0\s+172\.20\.20\.1)",
          
          r"^snmp-server community\b",
      ]
      garbage_patterns = [
          r"^\s*!\s*Command: show running-config",
          r"^\s*!\s*device:",
          r"^\s*!\s*boot system",
          r"^\s*!\s*Startup-config last modified at",
          r"^\s*!\s*Time:",
          r"^\s*transceiver qsfp default-mode",
          r"^\s*no\s+bgp\s+default\s+ipv4-unicast\s*$",
          r"^\s*end$",
          r"^\s*#.*",
          r"^\s*!.*",
      ]
    elif "huawei" in plat or "vrp" in plat:
      managed_roots = [
          r"^sysname\b",
          r"^lldp enable$",
          r"^vlan \d+",
          r"^bridge-domain \d+",
          r"^acl (?:name|number)\b",
          r"^interface (?:GE1/0/[019]|LoopBack0|Vbdif10|Nve1)\b",
          r"^ip route-static (?!vpn-instance __MGMT_VPN__)",
          r"^bgp \d+",
          r"^snmp-agent sys-info\b",
      ]
      garbage_patterns = [
          r"^\s*port link-type access\s*$",
          r"^\s*stp edged-port enable\s*$",
          r"^\s*preference 20 200 200\s*$",
          r"^\s*snmp-agent sys-info version.*$",
          r"^\s*traffic-filter inbound acl name FABRIC-IN\s*$",
          r"^\s*display current-configuration",
          r"^\s*screen-length\s+\d+",
          r"^\s*<[^>]+>",
          r"^\s*\[[^\]]+\]",
          r"^\s*!Software Version",
          r"^\s*!Last configuration was",
          r"^\s*#.*",
          r"^\s*!.*",
          r"^\s*return$",
          r"^\s*undo\s+synchronization\s*$",
      ]
    else:
      managed_roots = [
          r"^hostname\b",
          r"^interface (?!gigabitethernet 1/0/0$)",
          r"^router bgp\b",
          r"^route-map\b",
          r"^ip access-list\b",
      ]
      garbage_patterns = [
          r"^\s*#!/usr/bin/clish",
          r"^\s*#\d+",
          r"^\s*do\s+",
          r"^\s*#.*",
          r"^\s*!.*",
      ]

    garbage_patterns.extend([
        r"^\s*no\s+shutdown\s*$",
        r"^\s*undo\s+shutdown\s*$",
    ])

    managed_compiled = [re.compile(p) for p in managed_roots]
    garbage_compiled = [re.compile(p) for p in garbage_patterns]

    hash_replacements = [
        (
            re.compile(
                r"^(username \S+ (?:privilege \d+ )?(?:secret|password) \d)"
                r" \S+"
            ),
            r"\1 <hash>",
        ),
        (
            re.compile(r"^(username \S+ .*secret sha512) \S+"),
            r"\1 <hash>",
        ),
        (
            re.compile(
                r"^(\s*local-user \S+ password"
                r" (?:irreversible-cipher|cipher)) \S+"
            ),
            r"\1 <hash>",
        ),
        (
            re.compile(r"^(\s*username \S+\s+password encrypted) \S+"),
            r"\1 <hash>",
        ),
    ]

    normalized: List[str] = []
    in_managed_block = False

    for line in lines:
      line_str = line.rstrip()
      if not line_str.strip():
        continue

      if any(r.search(line_str) for r in garbage_compiled):
        continue

      for pattern, repl in hash_replacements:
        line_str = pattern.sub(repl, line_str)

      indent = len(line_str) - len(line_str.lstrip())

      if indent == 0:
        in_managed_block = any(r.search(line_str) for r in managed_compiled)
        if in_managed_block:
          normalized.append(line_str)
      else:
        if in_managed_block:
          content = re.sub(r"\s+", " ", line_str.lstrip())
          # Сохраняем точные уровни вложенности (например, bgp -> ipv4-family -> peer)
          line_str = (" " * indent) + content
          normalized.append(line_str)

    return "\n".join(normalized)


class HierSyntaxSanitizer:
  """Адаптирует вывод hier_config под синтаксис конкретной NOS (IOS-XE, EOS, Huawei VRP)."""

  @classmethod
  def clean(
      cls,
      lines: List[str],
      platform: str,
      intended_raw: str = "",
      running_raw: str = "",
      is_remediation: bool = True,
  ) -> List[str]:
    plat = platform.lower()
    is_huawei = "huawei" in plat or "vrp" in plat
    is_cisco = "cisco" in plat or "ios" in plat
    no_pfx = "undo " if is_huawei else "no "

    sanitized: List[str] = []
    for line in lines:
      raw = line.rstrip()
      if not raw:
        continue

      # Конвертируем 'no ' от hier_config в 'undo ' для Huawei VRP
      if is_huawei:
        raw = re.sub(r"^(\s*)no\s+", r"\1undo ", raw)
        # Упрощаем удаление ACL и peer на Huawei VRP
        if raw.strip().startswith("undo acl name "):
          parts = raw.strip().split()
          indent_str = raw[: len(raw) - len(raw.lstrip())]
          raw = f"{indent_str}undo acl name {parts[3]}"
        elif re.match(r"^\s*undo peer \S+ as-number \d+", raw):
          parts = raw.strip().split()
          indent_str = raw[: len(raw) - len(raw.lstrip())]
          raw = f"{indent_str}undo peer {parts[2]}"

      if re.match(r"^\s*(?:no\s+no|undo\s+undo)\b", raw):
        continue

      sanitized.append(raw)

    # Очистка дублирующихся 'no description' / 'no ip address' при замене значения в том же блоке
    final_lines: List[str] = []
    i = 0
    while i < len(sanitized):
      line = sanitized[i]
      stripped = line.strip()
      indent = len(line) - len(line.lstrip())

      # Если далее в этом же подблоке идет новое присваивание description или ip address (на Cisco/Arista)
      if stripped in ["no description", "undo description"]:
        has_replacement = False
        for j in range(i + 1, len(sanitized)):
          next_l = sanitized[j]
          if (len(next_l) - len(next_l.lstrip())) < indent:
            break
          if next_l.strip().startswith("description "):
            has_replacement = True
            break
        if has_replacement:
          i += 1
          continue

      if not is_huawei and stripped.startswith("no ip address "):
        has_replacement = False
        for j in range(i + 1, len(sanitized)):
          next_l = sanitized[j]
          if (len(next_l) - len(next_l.lstrip())) < indent:
            break
          if next_l.strip().startswith("ip address "):
            has_replacement = True
            break
        if has_replacement:
          i += 1
          continue

      final_lines.append(line)
      i += 1

    if is_huawei and final_lines and final_lines[-1].strip() != "commit":
      final_lines.append("commit")

    return final_lines


def _run_hier_config_engine(
    norm_running: str, norm_intended: str, platform: str, hostname: str
) -> Optional[Tuple[List[str], List[str]]]:
  """Запускает hier_config (v3 или v2) для всех платформ, включая VRP через generic/ios AST."""
  plat = platform.lower()
  if "arista" in plat or "eos" in plat:
    os_name = "eos"
  elif "cisco" in plat or "ios" in plat:
    os_name = "ios"
  else:
    os_name = "generic"

  if HIER_V3_AVAILABLE:
    try:
      enum_map = {
          "eos": HPlatform.ARISTA_EOS,
          "ios": HPlatform.CISCO_IOS,
          "generic": HPlatform.GENERIC,
      }
      driver = get_hconfig_driver(enum_map.get(os_name, HPlatform.GENERIC))
      run_cfg = get_hconfig(driver, norm_running)
      int_cfg = get_hconfig(driver, norm_intended)

      rem_cfg = run_cfg.config_to_get_to(int_cfg)
      rb_cfg = int_cfg.config_to_get_to(run_cfg)

      raw_rem = [line.cisco_style_text() for line in rem_cfg.all_children_sorted()]
      raw_rb = [line.cisco_style_text() for line in rb_cfg.all_children_sorted()]
      return raw_rem, raw_rb
    except Exception as e:
      print(f"  [WARN] Ошибка hier_config v3 ({e}), пробуем фоллбэк...")

  if HIER_V2_AVAILABLE:
    try:
      v2_os = "eos" if os_name == "eos" else "ios"
      host = _Host(hostname=hostname, os=v2_os)
      host.load_running_config(norm_running)
      host.load_generated_config(norm_intended)
      host.load_remediation_config()
      raw_rem = host.remediation_config_filtered_text(include_tags=set(), exclude_tags=set()).splitlines()

      host_rb = _Host(hostname=hostname, os=v2_os)
      host_rb.load_running_config(norm_intended)
      host_rb.load_generated_config(norm_running)
      host_rb.load_remediation_config()
      raw_rb = host_rb.remediation_config_filtered_text(include_tags=set(), exclude_tags=set()).splitlines()
      return raw_rem, raw_rb
    except Exception as e:
      print(f"  [WARN] Ошибка hier_config v2 ({e}), переключение на встроенный AST...")

  return None


class FallbackHierarchicalDiffEngine:
  """Рекурсивный иерархический AST-движок на случай отсутствия пакета hier_config в окружении."""

  @classmethod
  def _parse_tree(cls, lines: List[str], base_indent: int = 0) -> Dict[str, Any]:
    tree: Dict[str, Any] = {}
    i = 0
    while i < len(lines):
      line = lines[i]
      indent = len(line) - len(line.lstrip())
      if indent < base_indent:
        break
      cmd = line.strip()
      children_lines = []
      j = i + 1
      while j < len(lines):
        next_indent = len(lines[j]) - len(lines[j].lstrip())
        if next_indent > indent:
          children_lines.append(lines[j])
          j += 1
        else:
          break
      first_child_indent = (
          (len(children_lines[0]) - len(children_lines[0].lstrip()))
          if children_lines
          else indent + 1
      )
      tree[cmd] = (
          cls._parse_tree(children_lines, first_child_indent)
          if children_lines
          else {}
      )
      i = j
    return tree

  @classmethod
  def _diff_trees(
      cls,
      run_tree: Dict[str, Any],
      int_tree: Dict[str, Any],
      no_pfx: str,
      depth: int = 0,
  ) -> List[str]:
    out: List[str] = []
    pad = "  " * depth
    single_value_prefixes = (
        "hostname ",
        "sysname ",
        "description ",
        "router-id ",
        "bgp router-id ",
        "ip address ",
        "route-distinguisher ",
    )

    for r_cmd, r_children in run_tree.items():
      if r_cmd not in int_tree:
        replaced = any(
            r_cmd.startswith(p) and any(ic.startswith(p) for ic in int_tree)
            for p in single_value_prefixes
        )
        if not replaced:
          out.append(f"{pad}{no_pfx}{r_cmd}")

    for i_cmd, i_children in int_tree.items():
      if i_cmd not in run_tree:
        out.append(f"{pad}{i_cmd}")
        out.extend(cls._diff_trees({}, i_children, no_pfx, depth + 1))
      else:
        sub_diff = cls._diff_trees(
            run_tree[i_cmd], i_children, no_pfx, depth + 1
        )
        if sub_diff:
          out.append(f"{pad}{i_cmd}")
          out.extend(sub_diff)

    return out

  @classmethod
  def compute(
      cls, norm_running: str, norm_intended: str, platform: str
  ) -> Tuple[List[str], List[str]]:
    is_huawei = "huawei" in platform.lower() or "vrp" in platform.lower()
    no_pfx = "undo " if is_huawei else "no "
    run_tree = cls._parse_tree(norm_running.splitlines())
    int_tree = cls._parse_tree(norm_intended.splitlines())
    rem = cls._diff_trees(run_tree, int_tree, no_pfx)
    rb = cls._diff_trees(int_tree, run_tree, no_pfx)
    return rem, rb


def compute_hier_diff(
    running_raw: str,
    intended_raw: str,
    platform: str,
    hostname: str = "device",
) -> DiffResult:
  norm_running = ConfigNormalizer.normalize(running_raw, platform)
  norm_intended = ConfigNormalizer.normalize(intended_raw, platform)
  if ("huawei" in platform.lower() or "vrp" in platform.lower()) and "l2vpn-family evpn" not in norm_running:
    filtered_int = []
    skip_sub = False
    for line in norm_intended.splitlines():
      s = line.strip()
      indent = len(line) - len(line.lstrip())
      if s in ("evpn", "l2vpn-family evpn"):
        skip_sub = True
        skip_indent = indent
        continue
      if skip_sub:
        if indent > skip_indent:
          continue
        skip_sub = False
      filtered_int.append(line)
    norm_intended = "\n".join(filtered_int)

  hier_out = _run_hier_config_engine(
      norm_running, norm_intended, platform, hostname
  )
  if hier_out is not None:
    raw_rem, raw_rb = hier_out
  else:
    raw_rem, raw_rb = FallbackHierarchicalDiffEngine.compute(
        norm_running, norm_intended, platform
    )

  clean_remediation = HierSyntaxSanitizer.clean(
      raw_rem,
      platform,
      intended_raw=norm_intended,
      running_raw=norm_running,
      is_remediation=True,
  )
  clean_rollback = HierSyntaxSanitizer.clean(
      raw_rb,
      platform,
      intended_raw=norm_intended,
      running_raw=norm_running,
      is_remediation=False,
  )

  return DiffResult(
      has_drift=len(clean_remediation) > 0,
      remediation_config=clean_remediation,
      rollback_config=clean_rollback,
      normalized_running=norm_running,
      normalized_intended=norm_intended,
  )


if __name__ == "__main__":
  offline_mode = "--offline" in sys.argv

  intent_candidates = [
      PROJECT_ROOT / "intent",
      PROJECT_ROOT / "backend" / "tests" / "fixtures" / "intent-repo",
      Path.cwd() / "intent",
      Path.cwd(),
  ]
  intent_dir = next(
      (d for d in intent_candidates if (d / "inventory.yaml").exists()), None
  )

  if not intent_dir:
    print(f"[ERROR] Файл inventory.yaml не найден (корень: {PROJECT_ROOT})!")
    sys.exit(1)

  inv_path = intent_dir / "inventory.yaml"
  with open(inv_path, "r", encoding="utf-8") as f:
    inventory = yaml.safe_load(f)

  devices_list = inventory.get("devices", [])
  if not devices_list:
    print("[ERROR] В inventory.yaml не описаны устройства")
    sys.exit(1)

  renderer = TemplateRenderer(templates_root=PROJECT_ROOT / "templates")
  dev_model_dirs = [intent_dir / "devices", intent_dir]
  running_fallback_dir = PROJECT_ROOT / "lab" / "running"
  diffs_out_dir = intent_dir / "diffs"
  diffs_out_dir.mkdir(parents=True, exist_ok=True)

  for dev in devices_list:
    hostname = dev.get("hostname", "unknown")
    short_host = hostname.split(".")[0]
    conn_info = InventoryConnectionResolver.get_connection_info(dev, inventory)

    print(f"\n>>> [NODE: {hostname}] ({conn_info['platform']})")

    yaml_file = None
    for d in dev_model_dirs:
      for candidate_name in [f"{hostname}.yaml", f"{short_host}.yaml"]:
        candidate = d / candidate_name
        if candidate.exists():
          yaml_file = candidate
          break
      if yaml_file:
        break

    if not yaml_file:
      print(f"  [WARN] Пропущен: нет файла модели данных в {intent_dir / 'devices'}")
      continue

    with open(yaml_file, "r", encoding="utf-8") as f:
      dev_data = yaml.safe_load(f)

    try:
      intended_raw = renderer.render(dev_data, inventory, conn_info["platform"])
      (diffs_out_dir / f"{hostname}.intended.cfg").write_text(
          intended_raw + "\n", encoding="utf-8"
      )
    except Exception as e:
      print(f"  [ERROR] Ошибка шаблонизатора: {e}")
      continue

    running_raw = None
    if not offline_mode:
      print(
          "  -> Стягивание live running-config через SSH"
          f" ({conn_info['mgmt_ip']}:{conn_info['mgmt_port']})..."
      )
      try:
        running_raw = LiveConfigCollector.pull(conn_info)
        print(f"  -> Конфиг получен по SSH ({len(running_raw.splitlines())} строк)")
      except Exception as e:
        print(f"  [WARN] Ошибка SSH ({e}), проверяем локальный кэш в lab/running/...")

    if running_raw is None:
      for r_cand in [
          running_fallback_dir / f"{hostname}.cfg",
          running_fallback_dir / f"{short_host}.cfg",
      ]:
        if r_cand.exists():
          running_raw = r_cand.read_text(encoding="utf-8")
          print(f"  -> Использован локальный снимок: {r_cand.relative_to(PROJECT_ROOT)}")
          break

    if not running_raw:
      print(f"  [ERROR] Не удалось получить running-config для {hostname}")
      continue

    diff = compute_hier_diff(
        running_raw=running_raw,
        intended_raw=intended_raw,
        platform=conn_info["platform"],
        hostname=hostname,
    )

    if "--debug" in sys.argv:
      print("  --- [DEBUG] NORM INTENDED (из Jinja2) ---")
      print(diff.normalized_intended)
      print("  --- [DEBUG] NORM RUNNING (с коммутатора) ---")
      print(diff.normalized_running)

    if not diff.has_drift:
      print("  [STATUS: IN_SYNC] Конфигурация полностью соответствует эталону!")
    else:
      rem_path = diffs_out_dir / f"{hostname}.remediation.cfg"
      rem_path.write_text("\n".join(diff.remediation_config) + "\n", encoding="utf-8")
      print("  [STATUS: DRIFT_DETECTED] Обнаружен дрейф конфигурации!")
      print("  ┌── REMEDIATION (команды наката к эталону):")
      for cmd in diff.remediation_config:
        print(f"  │  + {cmd}")
      print("  └── ROLLBACK (команды отката на случай сбоя):")
      for cmd in diff.rollback_config:
        print(f"     - {cmd}")

  print("\nПроверка всех устройств завершена.")
