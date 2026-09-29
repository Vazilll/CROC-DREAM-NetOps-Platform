"""Jinja2 rendering of intended configurations (spec 2.2.1).

Templates live in ``<templates_path>/<platform>/<section>.j2`` and receive two
variables: ``device`` (:class:`InventoryDevice`) and ``intent``
(:class:`DeviceIntent`). Sections are concatenated in a fixed order; a
missing section file is simply skipped.
"""

from __future__ import annotations

from pathlib import Path

import jinja2

from netops.errors import NetOpsError
from netops.intent.models import DeviceIntent, InventoryDevice

SECTIONS = ("base", "interfaces", "acls", "bgp")


class RenderError(NetOpsError):
    pass


class JinjaConfigRenderer:
    def __init__(self, templates_path: Path) -> None:
        self._root = templates_path
        self._env = jinja2.Environment(
            loader=jinja2.FileSystemLoader(templates_path),
            undefined=jinja2.StrictUndefined,
            trim_blocks=True,
            lstrip_blocks=True,
            keep_trailing_newline=True,
            autoescape=False,  # CLI configuration, not HTML
        )

    def render(self, device: InventoryDevice, intent: DeviceIntent) -> str:
        platform_dir = self._root / device.platform.value
        templates = [
            f"{device.platform.value}/{section}.j2"
            for section in SECTIONS
            if (platform_dir / f"{section}.j2").is_file()
        ]
        if not templates:
            raise RenderError(
                f"No templates found for platform {device.platform} in {platform_dir}"
            )

        parts: list[str] = []
        for name in templates:
            try:
                rendered = self._env.get_template(name).render(device=device, intent=intent)
            except jinja2.TemplateError as exc:
                raise RenderError(f"{name}: {exc}") from exc
            parts.append(rendered.rstrip("\n"))
        return "\n".join(part for part in parts if part) + "\n"
