from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import select

from netops.api.deps import ContainerDep, UserServiceDep, Viewer
from netops.constants import const, role_locked_ports
from netops.db import utcnow
from netops.enums import UserRole
from netops.models import User
from netops.security import generate_token, hash_token
from netops.services.sessions import create_session, destroy_session
from netops.services.users import DeviceBoundConflictError
from netops.settings import ApiPrincipal

router = APIRouter(prefix="/auth", tags=["auth"])

_LOOPBACK_HOSTS = frozenset(const("console.loopback_hosts"))
_ROLE_LOCKED_PORTS = role_locked_ports()
_LOCAL_OWNER_TOKEN = str(const("console.local_owner_login_token"))


def _is_local_owner_request(request: Request) -> bool:
    console_port = (request.headers.get("x-console-port") or "").strip()
    if console_port in _ROLE_LOCKED_PORTS:
        return False
    for header in ("x-forwarded-host", "host"):
        raw = (request.headers.get(header) or "").strip().lower()
        if not raw:
            continue
        host, _, port = raw.rpartition(":") if ":" in raw and not raw.endswith("]") else (raw, "", "")
        host = host or raw
        if host not in _LOOPBACK_HOSTS or port in _ROLE_LOCKED_PORTS:
            return False
    origin = (request.headers.get("origin") or request.headers.get("referer") or "").strip().lower()
    if origin:
        from urllib.parse import urlparse

        parsed = urlparse(origin)
        if parsed.hostname and parsed.hostname not in _LOOPBACK_HOSTS:
            return False
        if parsed.port and str(parsed.port) in _ROLE_LOCKED_PORTS:
            return False
    return True


class LoginRequest(BaseModel):
    token: str = Field(min_length=6, max_length=256)


@router.post("/login", summary="Обменять персональный токен или 6-значный код Владельца на HttpOnly cookie-сессию")
def login(
    req: LoginRequest,
    request: Request,
    response: Response,
    container: ContainerDep,
    users: UserServiceDep,
) -> dict[str, Any]:
    settings = container.settings
    session = users._session
    principal: ApiPrincipal | None = None
    db_user = False
    u: User | None = None

    if req.token.strip() == _LOCAL_OWNER_TOKEN:
        if not _is_local_owner_request(request):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Local console only")
        u = session.scalar(select(User).where(User.username == "owner"))
        if u is None:
            tok = f"crk_owner_{generate_token()[:24]}"
            u = User(
                username="owner",
                role=UserRole.OWNER,
                token_sha256=hash_token(tok),
                is_active=True,
                bound_client_id=(request.headers.get("X-Client-ID") or "").strip()[:128] or None,
                bound_ip=request.client.host if request.client else "127.0.0.1",
                bound_at=utcnow(),
                last_seen_at=utcnow(),
            )
            session.add(u)
            session.commit()
        principal = ApiPrincipal(username=u.username, role=UserRole.OWNER, allowed_system=None)
        db_user = True
    else:
        principal = settings.authenticate(req.token)
        db_user = principal is None
        if db_user:
            try:
                principal = users.authenticate(
                    req.token,
                    client_id=request.headers.get("X-Client-ID"),
                    user_agent=request.headers.get("User-Agent"),
                    client_ip=request.client.host if request.client else None,
                    settings=settings,
                    allow_rebind=False,
                )
            except DeviceBoundConflictError as exc:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    if principal is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    auth_header = (request.headers.get("Authorization") or "").strip()
    if auth_header.lower().startswith("bearer "):
        proxy_principal = settings.authenticate(auth_header[7:].strip())
        if proxy_principal is not None and proxy_principal.role != principal.role:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Cannot switch role on a dedicated role-locked console port",
            )
    if db_user and u is None:
        u = session.scalar(select(User).where(User.username == principal.username))
    csrf = create_session(
        response,
        request,
        principal,
        token=req.token,
        settings=settings,
        db_user=db_user,
        token_sha256=u.token_sha256 if u is not None else None,
    )
    return {"username": principal.username, "role": principal.role.value, "csrf_token": csrf}


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT, summary="Завершить сессию")
def logout(request: Request, response: Response, _: Viewer) -> Response:
    destroy_session(request, response)
    response.status_code = status.HTTP_204_NO_CONTENT
    return response
