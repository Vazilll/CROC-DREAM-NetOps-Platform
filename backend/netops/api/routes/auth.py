from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import select

from netops.api.deps import ContainerDep, UserServiceDep, Viewer
from netops.models import User
from netops.services.sessions import create_session, destroy_session
from netops.services.users import DeviceBoundConflictError

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginRequest(BaseModel):
    token: str = Field(min_length=8, max_length=256)


@router.post("/login", summary="Обменять токен/инвайт на HttpOnly cookie-сессию")
def login(
    req: LoginRequest,
    request: Request,
    response: Response,
    container: ContainerDep,
    users: UserServiceDep,
) -> dict[str, Any]:
    settings = container.settings
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
            )
        except DeviceBoundConflictError as exc:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    if principal is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    u = (
        users._session.scalar(select(User).where(User.username == principal.username))
        if db_user
        else None
    )
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
