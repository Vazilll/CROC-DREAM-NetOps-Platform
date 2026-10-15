from __future__ import annotations

from pathlib import Path

import pytest

from netops.intent import IntentRepository
from netops.network import JinjaConfigRenderer, RenderError

# Данные стенда в корне репозитория: intent и шаблоны, которые смонтирует docker compose.
REPO_ROOT = Path(__file__).resolve().parents[3]
INTENT = REPO_ROOT / "intent"
INTENT_LIVE = REPO_ROOT / "intent-live"
TEMPLATES = REPO_ROOT / "templates"

pytestmark = pytest.mark.skipif(
    not (INTENT / "inventory.yaml").is_file(), reason="в репозитории пока нет intent/inventory.yaml"
)


def test_intent_passes_lint() -> None:
    assert IntentRepository(INTENT).lint() == []


def test_templates_render_for_every_device() -> None:
    snapshot = IntentRepository(INTENT).load()
    renderer = JinjaConfigRenderer(TEMPLATES)
    errors: dict[str, str] = {}
    for device in snapshot.inventory.devices:
        # Платформы без шаблонов (пока Huawei) пропускаем: dry-run на них падает с понятной ошибкой.
        if not (TEMPLATES / device.platform.value).is_dir():
            continue
        intent = snapshot.intent_for(device.hostname)
        if intent is None:
            errors[device.hostname] = "нет файла в intent/devices"
            continue
        try:
            renderer.render(device, intent)
        except RenderError as exc:
            errors[device.hostname] = str(exc)
    assert errors == {}


# Инвентарь живого стенда: 6 узлов, три вендора. Проверяем теми же правилами, что и офлайн-демо,
# чтобы переключение NETOPS_NETWORK_DRIVER=scrapli не упиралось в сломанные данные.
@pytest.mark.skipif(
    not (INTENT_LIVE / "inventory.yaml").is_file(), reason="нет intent-live/inventory.yaml"
)
def test_live_intent_passes_lint_and_renders() -> None:
    assert IntentRepository(INTENT_LIVE).lint() == []
    snapshot = IntentRepository(INTENT_LIVE).load()
    renderer = JinjaConfigRenderer(TEMPLATES)
    errors: dict[str, str] = {}
    for device in snapshot.inventory.devices:
        intent = snapshot.intent_for(device.hostname)
        if intent is None:
            errors[device.hostname] = "нет файла в intent-live/devices"
            continue
        try:
            renderer.render(device, intent)
        except RenderError as exc:
            errors[device.hostname] = str(exc)
    assert errors == {}
    assert len(snapshot.inventory.devices) == 6
