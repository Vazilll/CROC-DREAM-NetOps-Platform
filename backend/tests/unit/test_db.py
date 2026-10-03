from __future__ import annotations

from contextlib import AbstractContextManager, nullcontext
from typing import Any

import pytest
from sqlalchemy.exc import OperationalError

from netops.db import wait_for_database


class FlakyEngine:
    def __init__(self, failures: int) -> None:
        self.failures = failures
        self.calls = 0

    def connect(self) -> AbstractContextManager[Any]:
        self.calls += 1
        if self.calls <= self.failures:
            raise OperationalError("SELECT 1", {}, ConnectionRefusedError("refused"))
        return nullcontext()


def test_waits_until_the_database_accepts_connections() -> None:
    engine = FlakyEngine(failures=3)
    wait_for_database(engine, attempts=5, delay=0)  # type: ignore[arg-type]
    assert engine.calls == 4


def test_gives_up_after_the_last_attempt() -> None:
    engine = FlakyEngine(failures=10)
    with pytest.raises(OperationalError):
        wait_for_database(engine, attempts=3, delay=0)  # type: ignore[arg-type]
    assert engine.calls == 3
