from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from netops.api import create_app
from netops.enums import UserRole
from netops.settings import Settings
from tests.conftest import RecordingDispatcher, auth


def test_probes_do_not_require_auth(client: TestClient) -> None:
    assert client.get("/healthz").json() == {"status": "ok"}
    assert client.get("/readyz").json() == {"status": "ok", "database": "ok"}


@pytest.mark.parametrize(
    "headers",
    [{}, {"Authorization": "Bearer wrong"}, {"Authorization": "Basic YWRtaW46YWRtaW4="}],
)
def test_missing_or_invalid_token(client: TestClient, headers: dict[str, str]) -> None:
    response = client.get("/api/v1/devices", headers=headers)
    assert response.status_code == 401
    assert response.headers["WWW-Authenticate"] == "Bearer"


@pytest.mark.parametrize("role", list(UserRole))
def test_me(client: TestClient, role: UserRole) -> None:
    response = client.get("/api/v1/auth/me", headers=auth(role))
    assert response.status_code == 200
    assert response.json() == {"username": f"{role.value}-user", "role": role.value}


@pytest.mark.parametrize(
    ("method", "url", "minimum"),
    [
        ("GET", "/api/v1/devices", UserRole.VIEWER),
        ("GET", "/api/v1/jobs", UserRole.VIEWER),
        ("GET", "/api/v1/drift/report", UserRole.VIEWER),
        ("GET", "/api/v1/intent/lint", UserRole.VIEWER),
        ("POST", "/api/v1/jobs/dry-run", UserRole.OPERATOR),
        ("POST", "/api/v1/jobs/deploy", UserRole.OPERATOR),
        ("POST", "/api/v1/drift/scan", UserRole.OPERATOR),
        ("POST", "/api/v1/drift/remediate", UserRole.OPERATOR),
        ("POST", "/api/v1/devices", UserRole.ADMIN),
        ("PATCH", "/api/v1/devices/1", UserRole.ADMIN),
        ("DELETE", "/api/v1/devices/1", UserRole.ADMIN),
        ("POST", "/api/v1/inventory/sync", UserRole.ADMIN),
    ],
)
def test_rbac_matrix(client: TestClient, method: str, url: str, minimum: UserRole) -> None:
    for role in UserRole:
        response = client.request(method, url, headers=auth(role), json={})
        if role.grants(minimum):
            assert response.status_code != 403, (role, response.text)
        else:
            assert response.status_code == 403, (role, response.text)
            assert response.json() == {"detail": f"The {minimum} role is required"}


def test_openapi_documents_every_endpoint(client: TestClient) -> None:
    paths = client.get("/openapi.json").json()["paths"]
    assert {
        "/api/v1/devices",
        "/api/v1/devices/{device_id}",
        "/api/v1/jobs/dry-run",
        "/api/v1/jobs/{job_id}",
        "/api/v1/jobs/{job_id}/diff",
        "/api/v1/jobs/deploy",
        "/api/v1/drift/scan",
        "/api/v1/drift/report",
        "/api/v1/drift/remediate",
    } <= set(paths)


def test_readiness_reports_database_outage(settings: Settings, tmp_path: Path) -> None:
    broken = settings.model_copy(
        update={"database_url": f"sqlite:///{tmp_path / 'missing' / 'dir' / 'db.sqlite'}"}
    )
    app = create_app(broken, dispatcher=RecordingDispatcher())
    with TestClient(app) as client:
        response = client.get("/readyz")
    assert response.status_code == 503
    assert response.json() == {"status": "unavailable", "database": "unreachable"}
