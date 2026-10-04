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
    ignore_lines: tuple[re.Pattern[str], ...] = ()
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
                    r"^version \d",
                    r"^ntp clock-period\b",
                    r"^service timestamps\b",
                    r"^service password-encryption\b",
                    r"^service call-home\b",
                    r"^platform \b",
                    r"^boot-start-marker\b",
                    r"^boot-end-marker\b",
                    r"^no aaa\b",
                    r"^aaa\b",
                    r"^login on-success\b",
                    r"^subscriber templating\b",
                    r"^multilink\b",
                    r"^spanning-tree\b",
                    r"^redundancy\b",
                    r"^username admin\b",
                    r"^enable secret\b",
                    r"^ip domain name\b",
                    r"^ip ssh\b",
                    r"^license boot\b",
                    r"^show running-config\b",
                    r"^.+[#>]",
                ]
            ),
            ignore_sections=_compile(
                [
                    r"^crypto pki certificate chain\b",
                    r"^crypto pki trustpoint\b",
                    r"^vrf definition clab-mgmt\b",
                    r"^line con\b",
                    r"^line vty\b",
                    r"^interface GigabitEthernet1\b",
                    r"^interface GigabitEthernet4\b",
                    r"^ip forward-protocol\b",
                    r"^ip http\b",
                ]
            ),
        ),
        Platform.ARISTA_EOS: NormalizationRules(
            indent_unit=3,
            comment_prefixes=("!",),
            terminators=("end",),
            ignore_lines=_compile(
                [
                    r"^no aaa root\b",
                    r"^aaa root\b",
                    r"^username admin\b",
                    r"^transceiver qsfp\b",
                    r"^service routing protocols\b",
                    r"^spanning-tree\b",
                    r"^system l1\b",
                    r"^ip route 0\.0\.0\.0/0\b",
                    r"^show running-config\b",
                    r"^.+[#>]",
                ]
            ),
            ignore_sections=_compile(
                [
                    r"^management api\b",
                    r"^management ssh\b",
                    r"^interface Management0\b",
                    r"^aaa authentication\b",
                    r"^aaa authorization\b",
                ]
            ),
        ),
        Platform.HUAWEI_VRP: NormalizationRules(
            indent_unit=1,
            comment_prefixes=("#",),
            terminators=("return",),
            ignore_lines=_compile(
                [
                    r"^device board\b",
                    r"^device\b",
                    r"^header\b",
                    r"^ssh\b",
                    r"^stelnet\b",
                    r"^snetconf\b",
                    r"^rsa local-key-pair\b",
                    r"^sftp server\b",
                    r"^clock timezone\b",
                    r"^display current-configuration\b",
                    r"^ip route-static\b",
                    r"^<.+>",
                    r"^\[.+\]",
                ]
            ),
            ignore_sections=_compile(
                [
                    r"^interface MEth0/0/0\b",
                    r"^interface NULL0\b",
                    r"^user-interface\b",
                    r"^aaa\b",
                    r"^ip vpn-instance __MGMT_VPN__\b",
                    r"^ip vpn-instance\b",
                    r"^interface GE1/0/0\b",
                    r"^interface GE1/0/[3-9]\b",
                ]
            ),
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
    # Строка из ignore_sections выбрасывается вместе со всеми вложенными строками.
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


# Вложенность определяем по относительным отступам, поэтому шаблон с 4 пробелами
# и вывод Arista с 3 пробелами дают одинаковый текст.
def _reindent(entries: Iterable[tuple[int, str]], unit: int) -> Iterator[str]:
    open_levels: list[int] = []
    for indent, content in entries:
        while open_levels and open_levels[-1] > indent:
            open_levels.pop()
        if not open_levels or open_levels[-1] < indent:
            open_levels.append(indent)
        depth = len(open_levels) - 1
        yield " " * (unit * depth) + content
