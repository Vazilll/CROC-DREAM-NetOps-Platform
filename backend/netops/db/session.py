"""Engine and session factory."""

from __future__ import annotations

from typing import Any

from sqlalchemy import Engine, create_engine, event
from sqlalchemy.orm import Session, sessionmaker


def build_engine(database_url: str, **kwargs: Any) -> Engine:
    if database_url.startswith("sqlite"):
        # TestClient and the pipeline touch the same SQLite file from different threads.
        kwargs.setdefault("connect_args", {"check_same_thread": False})
        engine = create_engine(database_url, **kwargs)
        event.listen(engine, "connect", _enable_sqlite_foreign_keys)
        return engine
    return create_engine(database_url, pool_pre_ping=True, **kwargs)


def build_session_factory(engine: Engine) -> sessionmaker[Session]:
    # Objects stay usable after commit: the pipeline commits after every step
    # so that progress and logs are visible to the API in real time.
    return sessionmaker(bind=engine, expire_on_commit=False)


def _enable_sqlite_foreign_keys(dbapi_connection: Any, _record: Any) -> None:
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()
