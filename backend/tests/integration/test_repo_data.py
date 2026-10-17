from __future__ import annotations

import re
from pathlib import Path

import pytest
import yaml
from fastapi.testclient import TestClient

from netops.intent import IntentRepository
from netops.network import JinjaConfigRenderer, RenderError

# Данные стенда в корне репозитория: intent и шаблоны, которые смонтирует docker compose.
REPO_ROOT = Path(__file__).resolve().parents[3]
INTENT = REPO_ROOT / "intent"
TEMPLATES = REPO_ROOT / "templates"
LAB_RUNNING = REPO_ROOT / "lab" / "running"

pytestmark = pytest.mark.skipif(
    not (INTENT / "inventory.yaml").is_file(), reason="в репозитории пока нет intent/inventory.yaml"
)


def test_intent_passes_lint() -> None:
    assert IntentRepository(INTENT).lint() == []


def test_templates_render_for_every_device_and_sync_running_lab() -> None:
    snapshot = IntentRepository(INTENT).load()
    renderer = JinjaConfigRenderer(TEMPLATES)
    errors: dict[str, str] = {}
    for device in snapshot.inventory.devices:
        assert (TEMPLATES / device.platform.value).is_dir(), f"Нет шаблонов для {device.platform}"
        intent = snapshot.intent_for(device.hostname)
        if intent is None:
            errors[device.hostname] = "нет файла в intent/devices"
            continue
        try:
            rendered = renderer.render(device, intent)
            assert rendered.strip()
        except RenderError as exc:
            errors[device.hostname] = str(exc)
            continue
        running_file = LAB_RUNNING / f"{device.hostname}.cfg"
        assert running_file.is_file(), f"Нет {running_file}"
    assert errors == {}
    assert len(snapshot.inventory.devices) >= 4


def test_no_hardcoded_secrets_or_duplicate_ports() -> None:
    forbidden = re.compile(r"F5ga6jfkig|dev-(owner|admin|operator|viewer|jury)-token")
    scan_paths = [
        *list((REPO_ROOT / "backend" / "netops").rglob("*.py")),
        *list((REPO_ROOT / "frontend" / "src").rglob("*.ts")),
        *list((REPO_ROOT / "frontend" / "src").rglob("*.tsx")),
        REPO_ROOT / "frontend" / "nginx.conf",
        REPO_ROOT / "lab" / "reset_lab.sh",
    ]
    env_file = REPO_ROOT / "backend" / ".env"
    if env_file.is_file():
        scan_paths.append(env_file)

    hits: list[str] = []
    for path in scan_paths:
        if path.is_file():
            text = path.read_text(encoding="utf-8", errors="ignore")
            if forbidden.search(text):
                hits.append(str(path.relative_to(REPO_ROOT)))
    assert hits == [], f"Найдены захардкоженные пароли или dev-токены: {hits}"

    compose = yaml.safe_load((REPO_ROOT / "docker-compose.yml").read_text(encoding="utf-8"))
    for svc_name, svc in (compose.get("services") or {}).items():
        if svc_name == "frontend":
            continue
        ports = svc.get("ports") or []
        assert len(ports) <= 1, f"Сервис {svc_name} пробрасывает более 1 порта: {ports}"


def test_local_owner_console_rejects_remote_and_role_ports(client: TestClient) -> None:
    # Local loopback on primary console succeeds
    ok = client.post(
        "/api/v1/auth/login",
        json={"token": "local-owner-console"},
        headers={"Host": "localhost:5173"},
    )
    assert ok.status_code == 200
    assert ok.json()["role"] == "owner"

    # Dedicated Jury/Operator/Admin ports or external tunnel hosts are rejected
    for bad_headers in (
        {"Host": "localhost:5176"},
        {"Host": "198.51.100.10:5174"},
        {"Host": "localhost:5173", "X-Forwarded-Host": "demo.trycloudflare.com"},
        {"Host": "localhost:5173", "Origin": "https://demo.trycloudflare.com"},
    ):
        resp = client.post(
            "/api/v1/auth/login",
            json={"token": "local-owner-console"},
            headers=bad_headers,
        )
        assert resp.status_code == 401



def test_constants_yaml_is_single_source_of_ports() -> None:
    from netops.constants import console_ports, const

    assert len(set(console_ports())) == 4
    assert const("console.local_owner_login_token")

    literal = re.compile(r"(?<![\d.])517[3-6](?![\d])")
    hits: list[str] = []
    skip = {"constants.py"}
    for root in ((REPO_ROOT / "backend" / "netops"), (REPO_ROOT / "frontend" / "src")):
        for path in [*root.rglob("*.py"), *root.rglob("*.ts"), *root.rglob("*.tsx")]:
            if path.name in skip:
                continue
            for line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
                code = line.split("#")[0] if path.suffix == ".py" else line.split("//")[0]
                stripped = code.strip()
                if stripped.startswith(("*", "/*", '"""')):
                    continue
                if literal.search(code):
                    hits.append(f"{path.relative_to(REPO_ROOT)}: {stripped}")
    assert hits == [], f"Порты консолей зашиты в коде, вынесите в config/constants.yaml: {hits}"


def test_public_console_config_endpoint(client: TestClient) -> None:
    resp = client.get("/api/v1/config/console")
    assert resp.status_code == 200
    body = resp.json()
    assert set(body["role_ports"]) == {"admin", "operator", "viewer"}
    assert body["owner_port"] not in body["role_ports"].values()
