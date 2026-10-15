from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from netops.enums import DeviceStatus, UserRole
from netops.models import Device, EmergencyAction
from tests.conftest import auth

ADMIN = auth(UserRole.ADMIN)
OPERATOR = auth(UserRole.OPERATOR)


def _audit(session: Session) -> list[EmergencyAction]:
    return list(session.query(EmergencyAction).order_by(EmergencyAction.id))


def test_only_admin_sees_the_audit_log(client: TestClient) -> None:
    assert client.get("/api/v1/emergency/audit", headers=OPERATOR).status_code == 403
    assert client.get("/api/v1/emergency/audit", headers=ADMIN).json() == []


def test_write_command_is_refused_and_recorded(
    client: TestClient, session: Session, devices: dict[str, Device]
) -> None:
    response = client.post(
        "/api/v1/emergency/command",
        json={"device": "leaf-1.croc.lab", "command": "configure terminal"},
        headers=ADMIN,
    )
    assert response.status_code == 409
    assert "только команды чтения" in response.json()["detail"]

    [record] = _audit(session)
    assert (record.action, record.success, record.device) == ("command", False, "leaf-1.croc.lab")


def test_read_command_needs_a_live_driver(
    client: TestClient, session: Session, devices: dict[str, Device]
) -> None:
    response = client.post(
        "/api/v1/emergency/command",
        json={"device": "leaf-1.croc.lab", "command": "display bgp peer"},
        headers=ADMIN,
    )
    assert response.status_code == 409
    assert "scrapli" in response.json()["detail"]
    assert _audit(session)[-1].output_preview == "нет драйвера"


def test_unknown_device(client: TestClient) -> None:
    response = client.post(
        "/api/v1/emergency/command",
        json={"device": "nope.croc.lab", "command": "show version"},
        headers=ADMIN,
    )
    assert response.status_code == 404


def test_soft_reset_starts_a_drift_scan(
    client: TestClient, session: Session, devices: dict[str, Device]
) -> None:
    response = client.post("/api/v1/emergency/soft-reset", headers=ADMIN)
    assert response.status_code == 200
    assert response.json()["status"] == "accepted"
    assert _audit(session)[-1].action == "soft-reset"


def test_hard_reset_remediates_only_drifted_devices(
    client: TestClient, session: Session, devices: dict[str, Device]
) -> None:
    assert client.post("/api/v1/emergency/hard-reset", headers=ADMIN).json()["status"] == "noop"

    session.get_one(Device, devices["leaf-2.croc.lab"].id).status = DeviceStatus.DRIFT_DETECTED
    session.commit()
    body = client.post("/api/v1/emergency/hard-reset", headers=ADMIN).json()

    assert body["status"] == "accepted"
    assert body["details"] == "leaf-2.croc.lab"


def test_manual_patch_is_rejected_with_an_explanation(client: TestClient, session: Session) -> None:
    response = client.post(
        "/api/v1/emergency/patch",
        json={"device": "leaf-1.croc.lab", "patch": "hostname hacked", "reason": "демо"},
        headers=ADMIN,
    )
    assert response.status_code == 501
    assert "dry-run" in response.json()["details"]
    assert _audit(session)[-1].payload == "hostname hacked"
