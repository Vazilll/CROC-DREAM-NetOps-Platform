"""Normalization of configuration text before diffing (spec 2.2.2).

Both the running-config and the rendered intended config pass through the same
rules, so that timestamps, byte counters, banners, locally generated
certificates and indentation differences never show up as drift.

The built-in rules can be extended without code changes via a YAML file
(``NETOPS_NORMALIZATION_RULES_PATH``)::

    cisco_iosxe:
      ignore_lines: ['^ntp clock-period']
      ignore_sections: ['^crypto pki certificate chain']
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Iterator, Mapping
from dataclasses import dataclass, replace
from pathlib import Path
from types import MappingProxyType

import yaml

from netops.enums import Platform


@dataclass(frozen=True, slots=True)
class NormalizationRules:
    indent_unit: int
    comment_prefixes: tuple[str, ...]
    terminators: tuple[str, ...] = ()
    # Lines matching any pattern are dropped.
    ignore_lines: tuple[re.Pattern[str], ...] = ()
    # Lines matching any pattern are dropped together with their indented children.
    ignore_sections: tuple[re.Pattern[str], ...] = ()

    def extended(
        self, *, ignore_lines: Iterable[str] = (), ignore_sections: Iterable[str] = ()
    ) -> NormalizationRules:
        return replace(
            self,
            ignore_lines=self.ignore_lines + _compile(ignore_lines),
            ignore_sections=self.ignore_sections + _compile(ignore_sections),
        )


def _compile(patterns: Iterable[str]) -> tuple[re.Pattern[str], ...]:
    return tuple(re.compile(pattern) for pattern in patterns)


DEFAULT_RULES: Mapping[Platform, NormalizationRules] = MappingProxyType(
    {
        Platform.CISCO_IOSXE: NormalizationRules(
            indent_unit=1,
            comment_prefixes=("!",),
            terminators=("end",),
            ignore_lines=_compile(
                [
                    r"^Building configuration",
                    r"^Current configuration\s*:",
                    r"^version \d",  # reflects the installed IOS-XE image, not intent
                    r"^ntp clock-period\b",
                ]
            ),
            ignore_sections=_compile(
                [
                    r"^crypto pki certificate chain\b",
                    r"^crypto pki trustpoint TP-self-signed-",
                ]
            ),
        ),
        Platform.ARISTA_EOS: NormalizationRules(
            indent_unit=3,
            comment_prefixes=("!",),
            terminators=("end",),
        ),
        Platform.HUAWEI_VRP: NormalizationRules(
            indent_unit=1,
            comment_prefixes=("#",),
            terminators=("return",),
        ),
        Platform.JUNIPER_JUNOS: NormalizationRules(
            indent_unit=4,
            comment_prefixes=("#", "/*"),
            terminators=(),
        ),
        Platform.ELTEX_MES: NormalizationRules(
            indent_unit=1,
            comment_prefixes=("!",),
            terminators=("exit",),
        ),
        Platform.YADRO_KORNFE: NormalizationRules(
            indent_unit=2,
            comment_prefixes=("!", "#"),
            terminators=(),
        ),
    }
)


class ConfigNormalizer:
    def __init__(self, rules: Mapping[Platform, NormalizationRules] = DEFAULT_RULES) -> None:
        self._rules = dict(rules)

    @classmethod
    def from_file(cls, path: Path | None) -> ConfigNormalizer:
        """Built-in rules extended with the patterns from a YAML file, if given."""
        if path is None:
            return cls()
        raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        if not isinstance(raw, dict):
            raise ValueError(f"{path}: expected a mapping of platform -> rules")
        rules = dict(DEFAULT_RULES)
        for platform_name, extra in raw.items():
            platform = Platform(platform_name)
            patterns = extra or {}
            rules[platform] = rules[platform].extended(
                ignore_lines=patterns.get("ignore_lines", ()),
                ignore_sections=patterns.get("ignore_sections", ()),
            )
        return cls(rules)

    def rules_for(self, platform: Platform) -> NormalizationRules:
        return self._rules.get(
            platform,
            NormalizationRules(indent_unit=2, comment_prefixes=("!", "#"), terminators=()),
        )

    def normalize(self, platform: Platform, text: str) -> str:
        rules = self.rules_for(platform)
        entries = list(_filter_lines(text, rules))
        if not entries:
            return ""
        return "\n".join(_reindent(entries, rules.indent_unit)) + "\n"


def _filter_lines(text: str, rules: NormalizationRules) -> Iterator[tuple[int, str]]:
    """Yield ``(indent, content)`` of every meaningful line."""
    skip_deeper_than: int | None = None
    for raw_line in text.replace("\r\n", "\n").replace("\r", "\n").expandtabs(8).split("\n"):
        line = raw_line.rstrip()
        content = line.lstrip()
        if not content:
            continue
        indent = len(line) - len(content)
        if skip_deeper_than is not None:
            if indent > skip_deeper_than:
                continue
            skip_deeper_than = None
        if content.startswith(rules.comment_prefixes):
            continue
        if indent == 0 and content in rules.terminators:
            continue
        if any(pattern.search(content) for pattern in rules.ignore_lines):
            continue
        if any(pattern.search(content) for pattern in rules.ignore_sections):
            skip_deeper_than = indent
            continue
        yield indent, content


def _reindent(entries: Iterable[tuple[int, str]], unit: int) -> Iterator[str]:
    """Re-indent lines to ``unit`` spaces per nesting level.

    Nesting is inferred from relative indentation, so a template indented with
    four spaces and a device output indented with three produce the same text.
    """
    open_levels: list[int] = []
    for indent, content in entries:
        while open_levels and open_levels[-1] > indent:
            open_levels.pop()
        if not open_levels or open_levels[-1] < indent:
            open_levels.append(indent)
        depth = len(open_levels) - 1
        yield " " * (unit * depth) + content
