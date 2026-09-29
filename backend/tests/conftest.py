from __future__ import annotations

import shutil
from pathlib import Path

import pytest

from netops.network import ConfigNormalizer

FIXTURES = Path(__file__).parent / "fixtures"
TEMPLATES = FIXTURES / "templates"


@pytest.fixture
def intent_repo(tmp_path: Path) -> Path:
    return Path(shutil.copytree(FIXTURES / "intent-repo", tmp_path / "intent"))


@pytest.fixture
def normalizer() -> ConfigNormalizer:
    return ConfigNormalizer()
