"""Chaos Engineering simulation service for CROC DREAM NetOps Platform.

Extracted from `api/routes/system.py` to keep HTTP controllers thin.
"""

from __future__ import annotations

from typing import Any

from netops.network import JinjaConfigRenderer
from netops.services.forecast import record_chaos_event


def execute_chaos_scenario(scenario: str, container: Any) -> dict[str, str]:
    lab_dir = container.settings.offline_lab_path
    is_live = container.settings.network_driver == "scrapli"

    def _push_live(hostname: str, lines: list[str]) -> str:
        if not is_live:
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

    if scenario == "acl_drift":
        leaf1_cfg = lab_dir / "leaf-1.croc.lab.cfg"
        if leaf1_cfg.exists():
            content = leaf1_cfg.read_text(encoding="utf-8")
            if "20 deny ip any any" in content and "15 permit ip any any" not in content:
                content = content.replace(
                    "20 deny ip any any", "15 permit ip any any\n 20 deny ip any any"
                )
                leaf1_cfg.write_text(content, encoding="utf-8")
            elif (
                "rule 20 deny ip source any destination any" in content
                and "rule 15 permit ip" not in content
            ):
                content = content.replace(
                    "rule 20 deny ip source any destination any",
                    "rule 15 permit ip source any destination any\n rule 20 deny ip source any destination any",
                )
                leaf1_cfg.write_text(content, encoding="utf-8")
        ssh_note = _push_live(
            "leaf-1.croc.lab",
            ["ip access-list extended FABRIC_IN", "15 permit ip any any"],
        )
        record_chaos_event(
            scenario="acl_drift",
            target_hostnames=["leaf-1.croc.lab", "leaf-1"],
            title="Chaos: Внедрение несанкционированного ACL",
            description=f"Внедрен несанкционированный ACL в leaf-1.croc.lab{ssh_note}",
            severity="warning",
            lab_dir=lab_dir,
        )
        return {
            "status": "ok",
            "message": f"Внедрен несанкционированный ACL в leaf-1.croc.lab{ssh_note}",
        }

    if scenario == "port_down":
        leaf2_cfg = lab_dir / "leaf-2.croc.lab.cfg"
        if leaf2_cfg.exists():
            content = leaf2_cfg.read_text(encoding="utf-8")
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
            leaf2_cfg.write_text(content, encoding="utf-8")
        ssh_note = _push_live("leaf-2.croc.lab", ["interface GigabitEthernet3", "shutdown"])
        record_chaos_event(
            scenario="port_down",
            target_hostnames=["leaf-2.croc.lab", "leaf-2"],
            title="Chaos: Отключение Uplink-интерфейса на leaf-2",
            description=f"Uplink-интерфейс к spine-2 на leaf-2 переведен в shutdown{ssh_note}",
            severity="critical",
            lab_dir=lab_dir,
        )
        return {
            "status": "ok",
            "message": f"Интерфейс GigabitEthernet3 / GE1/0/1 на leaf-2 переведен в shutdown{ssh_note}",
        }

    if scenario == "huawei_drift":
        target_cfg = lab_dir / "leaf-3.croc.lab.cfg"
        target_host = "leaf-3.croc.lab"
        if not target_cfg.exists():
            target_cfg = lab_dir / "leaf-1.croc.lab.cfg"
            target_host = "leaf-1.croc.lab"
        if target_cfg.exists():
            content = target_cfg.read_text(encoding="utf-8")
            if "rule 15 permit ip source 10.99.0.0" not in content:
                content = content.replace(
                    "rule 20 deny ip source any destination any",
                    "rule 15 permit ip source 10.99.0.0 0.0.255.255 destination any\n rule 20 deny ip source any destination any",
                )
                target_cfg.write_text(content, encoding="utf-8")
        ssh_note = _push_live(
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
            "message": f"Внедрен несанкционированный ACL в {target_host} (Huawei VRP){ssh_note}",
        }

    if scenario == "ai_blackhole":
        from netops.services.ai_guard import AiTelemetryGuard  # noqa: PLC0415

        AiTelemetryGuard.inject_anomaly("leaf-2.croc.lab", "blackhole")
        AiTelemetryGuard.inject_anomaly("leaf-3.croc.lab", "blackhole")
        record_chaos_event(
            scenario="ai_blackhole",
            target_hostnames=["leaf-2.croc.lab", "leaf-2", "leaf-3.croc.lab", "leaf-3"],
            title="Chaos: Моделирование 'тихой аварии' (Blackhole / 0 трафика)",
            description="Имитация падения трафика при статусе портов up/up для проверки TimesFM 3.0",
            severity="critical",
            lab_dir=lab_dir,
        )
        return {
            "status": "ok",
            "message": "Смоделирована 'тихая авария' (TimesFM 3.0 обнаружит дроп)",
        }

    if scenario == "ai_storm":
        from netops.services.ai_guard import AiTelemetryGuard  # noqa: PLC0415

        AiTelemetryGuard.inject_anomaly("leaf-1.croc.lab", "storm")
        record_chaos_event(
            scenario="ai_storm",
            target_hostnames=["leaf-1.croc.lab", "leaf-1"],
            title="Chaos: Моделирование шторма нагрузки / петли маршрутизации",
            description="Имитация аномального всплеска трафика и CPU для проверки TimesFM 3.0",
            severity="critical",
            lab_dir=lab_dir,
        )
        return {
            "status": "ok",
            "message": "Смоделирован шторм трафика на leaf-1.croc.lab (TimesFM 3.0 обнаружит аномалию)",
        }

    if scenario == "reset_lab":
        from netops.services.ai_guard import AiTelemetryGuard  # noqa: PLC0415

        for host in ("leaf-1.croc.lab", "leaf-2.croc.lab", "leaf-3.croc.lab", "leaf-4.croc.lab"):
            AiTelemetryGuard.inject_anomaly(host, "clear")
        renderer = JinjaConfigRenderer(container.settings.templates_path)
        snapshot = container.intents.load()
        for dev in snapshot.inventory.devices:
            intent = snapshot.intent_for(dev.hostname)
            if intent is None:
                continue
            cfg = renderer.render(dev, intent)
            (lab_dir / f"{dev.hostname}.cfg").write_text(cfg, encoding="utf-8")
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
            "message": "Все 4 устройства успешно сброшены к чистому эталону Git SoT",
        }

    record_chaos_event(
        scenario=scenario,
        target_hostnames=["*"],
        title=f"Chaos: {scenario}",
        description=f"Неизвестный сценарий: {scenario}",
        severity="info",
        lab_dir=lab_dir,
    )
    return {"status": "ok", "message": "Неизвестный сценарий"}
