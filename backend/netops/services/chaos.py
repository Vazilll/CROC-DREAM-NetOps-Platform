"""Chaos Engineering simulation service for CROC DREAM NetOps Platform.

Extracted from `api/routes/system.py` to keep HTTP controllers thin.
"""

from __future__ import annotations

from typing import Any

from netops.network import JinjaConfigRenderer
from netops.services.forecast import record_chaos_event


from pathlib import Path


def _push_live_configs(container: Any, hostname: str, lines: list[str]) -> str:
    """Push CLI lines over SSH when running in live Scrapli mode."""
    if container.settings.network_driver != "scrapli":
        return ""
    try:
        from netops.network.scrapli_driver import _ParamikoConnAdapter  # noqa: PLC0415
        from netops.toolchain import build_toolchain  # noqa: PLC0415

        toolchain = build_toolchain(container.settings)
        snapshot = container.intents.load()
        dev = next((d for d in snapshot.inventory.devices if d.hostname == hostname), None)
        if dev is None:
            return f" (не найден в инвентаре: {hostname})"
        target = toolchain.target_for(dev)
        with _ParamikoConnAdapter(target, timeout=15) as conn:
            conn.send_configs(lines)
        return " [применено по SSH]"
    except Exception as exc:
        return f" [ошибка SSH: {exc}]"


def _inventory_devices(container: Any) -> list[Any]:
    try:
        return list(container.intents.load().inventory.devices)
    except Exception:
        return []


def _device_platform(container: Any, hostname: str, lab_dir: Path) -> str:
    for d in _inventory_devices(container):
        if str(d.hostname) == hostname:
            return d.platform.value if hasattr(d.platform, "value") else str(d.platform)
    cfg_path = lab_dir / f"{hostname}.cfg"
    if cfg_path.exists():
        text = cfg_path.read_text(encoding="utf-8", errors="ignore")
        if "sysname " in text or "undo portswitch" in text:
            return "huawei_vrp"
    return "cisco_iosxe"


def _pick_target(
    container: Any,
    lab_dir: Path,
    *,
    preferred_platform: str | None = None,
    index: int = 0,
    fallback: str = "leaf-1.croc.lab",
) -> str:
    devs = _inventory_devices(container)
    if container.settings.network_driver == "scrapli" and preferred_platform:
        for d in devs:
            plat = d.platform.value if hasattr(d.platform, "value") else str(d.platform)
            if plat == preferred_platform:
                return str(d.hostname)
    if (lab_dir / f"{fallback}.cfg").exists():
        return fallback
    if preferred_platform:
        for d in devs:
            plat = d.platform.value if hasattr(d.platform, "value") else str(d.platform)
            if plat == preferred_platform:
                return str(d.hostname)
    if devs:
        return str(devs[index % len(devs)].hostname)
    return fallback


def _scenario_acl_drift(container: Any, lab_dir: Path) -> dict[str, str]:
    target_host = _pick_target(
        container, lab_dir, preferred_platform="cisco_iosxe", index=0, fallback="leaf-1.croc.lab"
    )
    target_cfg = lab_dir / f"{target_host}.cfg"
    if target_cfg.exists():
        content = target_cfg.read_text(encoding="utf-8")
        if "20 deny ip any any" in content and "15 permit ip any any" not in content:
            content = content.replace(
                "20 deny ip any any", "15 permit ip any any\n 20 deny ip any any"
            )
            target_cfg.write_text(content, encoding="utf-8")
        elif (
            "rule 20 deny ip source any destination any" in content
            and "rule 15 permit ip" not in content
        ):
            content = content.replace(
                "rule 20 deny ip source any destination any",
                "rule 15 permit ip source any destination any\n rule 20 deny ip source any destination any",
            )
            target_cfg.write_text(content, encoding="utf-8")
    plat = _device_platform(container, target_host, lab_dir)
    if plat == "huawei_vrp":
        cli_lines = ["acl number 3001", "rule 15 permit ip source any destination any"]
    else:
        cli_lines = ["ip access-list extended FABRIC_IN", "15 permit ip any any"]
    ssh_note = _push_live_configs(container, target_host, cli_lines)
    msg = f"Внедрен несанкционированный ACL в {target_host}{ssh_note}"
    record_chaos_event(
        scenario="acl_drift",
        target_hostnames=[target_host, target_host.split(".")[0]],
        title="Chaos: Внедрение несанкционированного ACL",
        description=msg,
        severity="warning",
        lab_dir=lab_dir,
    )
    return {"status": "ok", "message": msg}


def _scenario_port_down(container: Any, lab_dir: Path) -> dict[str, str]:
    target_host = _pick_target(container, lab_dir, index=1, fallback="leaf-2.croc.lab")
    target_cfg = lab_dir / f"{target_host}.cfg"
    if target_cfg.exists():
        content = target_cfg.read_text(encoding="utf-8")
        old_cisco = (
            "interface GigabitEthernet3\n description Uplink to spine-2\n"
            " mtu 9000\n ip address 10.0.2.3 255.255.255.254\n no shutdown"
        )
        new_cisco = (
            "interface GigabitEthernet3\n description Uplink to spine-2\n"
            " mtu 9000\n ip address 10.0.2.3 255.255.255.254\n shutdown"
        )
        old_huawei = (
            "interface GE1/0/1\n description Uplink to spine-2\n"
            " undo portswitch\n mtu 9000\n ip address 10.0.2.3 255.255.255.254"
        )
        new_huawei = (
            "interface GE1/0/1\n description Uplink to spine-2\n"
            " undo portswitch\n mtu 9000\n ip address 10.0.2.3 255.255.255.254\n shutdown"
        )
        if old_cisco in content:
            content = content.replace(old_cisco, new_cisco)
        elif old_huawei in content and "shutdown\n#" not in content:
            content = content.replace(old_huawei, new_huawei)
        target_cfg.write_text(content, encoding="utf-8")
    plat = _device_platform(container, target_host, lab_dir)
    if plat == "huawei_vrp":
        cli_lines = ["interface GE1/0/1", "shutdown"]
    elif plat == "arista_eos":
        cli_lines = ["interface Ethernet2", "shutdown"]
    else:
        cli_lines = ["interface GigabitEthernet3", "shutdown"]
    ssh_note = _push_live_configs(container, target_host, cli_lines)
    record_chaos_event(
        scenario="port_down",
        target_hostnames=[target_host, target_host.split(".")[0]],
        title=f"Chaos: Отключение Uplink-интерфейса на {target_host}",
        description=f"Uplink-интерфейс на {target_host} переведен в shutdown{ssh_note}",
        severity="critical",
        lab_dir=lab_dir,
    )
    return {
        "status": "ok",
        "message": f"Интерфейс GigabitEthernet3 / GE1/0/1 на {target_host} переведен в shutdown{ssh_note}",
    }


def _scenario_huawei_drift(container: Any, lab_dir: Path) -> dict[str, str]:
    target_host = _pick_target(
        container, lab_dir, preferred_platform="huawei_vrp", index=1, fallback="leaf-1.croc.lab"
    )
    if (lab_dir / "leaf-3.croc.lab.cfg").exists():
        target_host = "leaf-3.croc.lab"
    target_cfg = lab_dir / f"{target_host}.cfg"
    if target_cfg.exists():
        content = target_cfg.read_text(encoding="utf-8")
        if "rule 15 permit ip source 10.99.0.0" not in content:
            content = content.replace(
                "rule 20 deny ip source any destination any",
                "rule 15 permit ip source 10.99.0.0 0.0.255.255 destination any\n rule 20 deny ip source any destination any",
            )
            target_cfg.write_text(content, encoding="utf-8")
    ssh_note = _push_live_configs(
        container,
        target_host,
        ["acl number 3001", "rule 15 permit ip source 10.99.0.0 0.0.255.255 destination any"],
    )
    record_chaos_event(
        scenario="huawei_drift",
        target_hostnames=[target_host, target_host.split(".")[0]],
        title="Chaos: Внедрение несанкционированного правила в Huawei VRP",
        description=f"Внедрен дрейф ACL rule 15 в {target_host}{ssh_note}",
        severity="warning",
        lab_dir=lab_dir,
    )
    return {
        "status": "ok",
        "message": f"Внедрен несанкционированный ACL в {target_host}{ssh_note}",
    }


def _scenario_ai_blackhole(container: Any, lab_dir: Path) -> dict[str, str]:
    from netops.services.ai_guard import AiTelemetryGuard  # noqa: PLC0415

    target_host = _pick_target(container, lab_dir, index=1, fallback="leaf-2.croc.lab")
    AiTelemetryGuard.inject_anomaly(target_host, "blackhole")
    record_chaos_event(
        scenario="ai_blackhole",
        target_hostnames=[target_host, target_host.split(".")[0]],
        title="Chaos: Моделирование 'тихой аварии' (Blackhole / 0 трафика)",
        description=f"Имитация падения трафика на {target_host} при статусе портов up/up",
        severity="critical",
        lab_dir=lab_dir,
    )
    return {
        "status": "ok",
        "message": f"Смоделирована 'тихая авария' на {target_host} (мониторинг телеметрии обнаружит дроп)",
    }


def _scenario_ai_storm(container: Any, lab_dir: Path) -> dict[str, str]:
    from netops.services.ai_guard import AiTelemetryGuard  # noqa: PLC0415

    target_host = _pick_target(container, lab_dir, index=0, fallback="leaf-1.croc.lab")
    AiTelemetryGuard.inject_anomaly(target_host, "storm")
    record_chaos_event(
        scenario="ai_storm",
        target_hostnames=[target_host, target_host.split(".")[0]],
        title="Chaos: Моделирование шторма нагрузки / петли маршрутизации",
        description=f"Имитация аномального всплеска трафика и CPU на {target_host}",
        severity="critical",
        lab_dir=lab_dir,
    )
    return {
        "status": "ok",
        "message": f"Смоделирован шторм трафика на {target_host} (мониторинг телеметрии обнаружит аномалию)",
    }


def _scenario_reset_lab(container: Any, lab_dir: Path) -> dict[str, str]:
    from netops.services.ai_guard import AiTelemetryGuard  # noqa: PLC0415

    renderer = JinjaConfigRenderer(container.settings.templates_path)
    snapshot = container.intents.load()
    for dev in snapshot.inventory.devices:
        AiTelemetryGuard.inject_anomaly(dev.hostname, "clear")
        intent = snapshot.intent_for(dev.hostname)
        if intent is None:
            continue
        cfg = renderer.render(dev, intent)
        (lab_dir / f"{dev.hostname}.cfg").write_text(cfg, encoding="utf-8")
        if container.settings.network_driver == "scrapli":
            plat = dev.platform.value if hasattr(dev.platform, "value") else str(dev.platform)
            if plat == "huawei_vrp":
                _push_live_configs(
                    container,
                    dev.hostname,
                    ["acl number 3001", "undo rule 15", "quit", "interface GE1/0/1", "undo shutdown"],
                )
            elif plat == "cisco_iosxe":
                _push_live_configs(
                    container,
                    dev.hostname,
                    ["ip access-list extended FABRIC_IN", "no 15", "exit", "interface GigabitEthernet3", "no shutdown"],
                )
            elif plat == "arista_eos":
                _push_live_configs(
                    container,
                    dev.hostname,
                    ["interface Ethernet2", "no shutdown"],
                )
    record_chaos_event(
        scenario="reset_lab",
        target_hostnames=["*"],
        title="Chaos: Сброс фабрики к Git SoT",
        description="Устройства успешно сброшены к чистому эталону Git SoT",
        severity="info",
        lab_dir=lab_dir,
    )
    return {
        "status": "ok",
        "message": f"Все устройства ({len(snapshot.inventory.devices)}) успешно сброшены к чистому эталону Git SoT",
    }


def execute_chaos_scenario(scenario: str, container: Any) -> dict[str, str]:
    lab_dir = container.settings.offline_lab_path
    if scenario == "acl_drift":
        return _scenario_acl_drift(container, lab_dir)
    if scenario == "port_down":
        return _scenario_port_down(container, lab_dir)
    if scenario == "huawei_drift":
        return _scenario_huawei_drift(container, lab_dir)
    if scenario == "ai_blackhole":
        return _scenario_ai_blackhole(container, lab_dir)
    if scenario == "ai_storm":
        return _scenario_ai_storm(container, lab_dir)
    if scenario == "reset_lab":
        return _scenario_reset_lab(container, lab_dir)

    record_chaos_event(
        scenario=scenario,
        target_hostnames=["*"],
        title=f"Chaos: {scenario}",
        description=f"Неизвестный сценарий: {scenario}",
        severity="info",
        lab_dir=lab_dir,
    )
    return {"status": "ok", "message": "Неизвестный сценарий"}

