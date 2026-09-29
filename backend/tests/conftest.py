from __future__ import annotations

import shutil
from pathlib import Path

import pytest

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture
def intent_repo(tmp_path: Path) -> Path:
    return Path(shutil.copytree(FIXTURES / "intent-repo", tmp_path / "intent"))
