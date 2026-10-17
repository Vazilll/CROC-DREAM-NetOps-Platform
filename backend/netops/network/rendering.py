from __future__ import annotations

from pathlib import Path

import jinja2
import jinja2.sandbox

from netops.errors import NetOpsError
from netops.intent.models import DeviceIntent, InventoryDevice

SECTIONS = ("base", "interfaces", "acls", "bgp")


class RenderError(NetOpsError):
    pass


class JinjaConfigRenderer:
    def __init__(self, templates_path: Path) -> None:
        self._root = templates_path
        self._env = jinja2.sandbox.SandboxedEnvironment(
            loader=jinja2.FileSystemLoader(templates_path),
            undefined=jinja2.StrictUndefined,
            trim_blocks=True,
            lstrip_blocks=True,
            keep_trailing_newline=True,
            autoescape=False,
        )

    def render(self, device: InventoryDevice, intent: DeviceIntent) -> str:
        import hashlib

        from netops.services.state import get_state_manager

        state_mgr = get_state_manager()
        cache_seed = f"{self._root.resolve()}:{device.platform.value}:{device.model_dump_json()}:{intent.model_dump_json()}"
        cache_key = hashlib.sha256(cache_seed.encode("utf-8")).hexdigest()
        cached = state_mgr.get_rendered_template(cache_key)
        if cached is not None:
            return cached

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
        result = "\n".join(part for part in parts if part) + "\n"
        state_mgr.set_rendered_template(cache_key, result, ttl=300)
        return result

