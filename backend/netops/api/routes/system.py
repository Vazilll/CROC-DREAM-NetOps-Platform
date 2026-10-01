from __future__ import annotations

from fastapi import APIRouter, status
from fastapi.responses import JSONResponse
from sqlalchemy import inspect
from sqlalchemy.exc import SQLAlchemyError

from netops.api.deps import ContainerDep, SessionDep, Viewer
from netops.db import Base
from netops.schemas.intent import IntentIssueRead, IntentLintReport
from netops.settings import ApiPrincipal

router = APIRouter()


@router.get("/healthz", tags=["system"], summary="Liveness probe")
def liveness() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/readyz", tags=["system"], summary="Готовность: база доступна и миграции применены")
def readiness(session: SessionDep) -> JSONResponse:
    try:
        existing = set(inspect(session.connection()).get_table_names())
    except SQLAlchemyError:
        return _unavailable("unreachable")
    if not set(Base.metadata.tables) <= existing:
        return _unavailable("migrations not applied")
    return JSONResponse(content={"status": "ok", "database": "ok"})


def _unavailable(reason: str) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        content={"status": "unavailable", "database": reason},
    )


api_router = APIRouter()


@api_router.get("/auth/me", response_model=ApiPrincipal, tags=["auth"], summary="Current user")
def current_user(user: Viewer) -> ApiPrincipal:
    return user


@api_router.get(
    "/intent/lint",
    response_model=IntentLintReport,
    tags=["intent"],
    summary="Pre-flight lint of the intent repository",
)
def lint_intent(container: ContainerDep, _: Viewer) -> IntentLintReport:
    issues = container.intents.lint()
    return IntentLintReport(
        valid=not issues, issues=[IntentIssueRead.model_validate(issue) for issue in issues]
    )
