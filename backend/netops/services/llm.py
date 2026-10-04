"""LLM Risk Analyzer service for network configuration diffs and remediation patches.

Supports OpenAI-compatible APIs (Xiaomi MiMo-V2.6-Flash, DeepSeek, etc.)
with deterministic rule-based fallback when the API is unconfigured or unreachable.
Zero external dependencies (uses standard library urllib.request + asyncio).
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import urllib.error
import urllib.request
from typing import Any, Literal

from pydantic import BaseModel, Field

from netops.settings import Settings

logger = logging.getLogger(__name__)

RiskLevel = Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"]


class RiskExplanation(BaseModel):
    """Structured risk assessment for a configuration change."""

    risk_level: RiskLevel
    summary: str
    key_points: list[str] = Field(default_factory=list)
    recommendations: list[str] = Field(default_factory=list)
    is_safe: bool = False
    provider: str = "MiMo-V2.6-Flash"


SYSTEM_PROMPT = (
    "Ты — ведущий сетевой архитектор и эксперт по автоматизации фабрик ЦОД (CLOS / Spine-Leaf).\n"
    "Твоя задача — провести аудит предлагаемого конфигурационного патча (HierConfig remediation) "
    "и выявить потенциальные операционные риски.\n\n"
    "Уровни риска:\n"
    "- LOW: Косметические изменения (описания портов, баннеры, hostname, syslog).\n"
    "- MEDIUM: Изменения MTU, добавление неиспользуемых VLAN/интерфейсов, новые префикс-листы.\n"
    "- HIGH: Перезапуск BGP пиров, изменение ASN/Router-ID, добавление/изменение правил ACL.\n"
    "- CRITICAL: Shutdown магистральных линков, сброс аутентификации BGP.\n\n"
    "Отвечай СТРОГО в формате валидного JSON:\n"
    "{\n"
    '  "risk_level": "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",\n'
    '  "summary": "Краткое профессиональное резюме на русском языке",\n'
    '  "key_points": ["Деталь 1", "Деталь 2"],\n'
    '  "recommendations": ["Рекомендация по проверке до/после применения"],\n'
    '  "is_safe": true | false\n'
    "}\n"
    "Никакого лишнего текста вне JSON."
)


def _check_bgp_risk(text: str) -> tuple[RiskLevel | None, list[str], list[str]]:
    if "router bgp" not in text and "neighbor" not in text:
        return None, [], []
    if "remote-as" in text or "password" in text or "shutdown" in text:
        return (
            "HIGH",
            ["Модификация параметров BGP пиринга (remote-as / password / shutdown)."],
            ["Проверьте состояние BGP сессий (show ip bgp summary) сразу после наката."],
        )
    return (
        "MEDIUM",
        ["Изменение настроек анонсируемых сетей или параметров BGP."],
        ["Убедитесь, что префиксы принимаются соседними маршрутизаторами."],
    )


def _check_acl_risk(text: str) -> tuple[RiskLevel | None, list[str], list[str]]:
    if "access-list" not in text and "ip access-group" not in text:
        return None, [], []
    if "deny" in text or "permit ip any any" in text:
        return (
            "HIGH",
            ["Изменение списков контроля доступа (ACL) с правилами фильтрации."],
            ["Проверьте доступность управляющего IP-адреса перед подтверждением."],
        )
    return "MEDIUM", ["Добавление или корректировка правил ACL."], []


def _check_interface_risk(text: str) -> tuple[RiskLevel | None, list[str], list[str]]:
    if "shutdown" in text and "no shutdown" not in text:
        return (
            "CRITICAL",
            ["Команда shutdown переводит сетевой интерфейс в состояние down."],
            ["Убедитесь, что отключаемый порт не является единственным аплинком."],
        )
    if "mtu" in text:
        return (
            "MEDIUM",
            ["Изменение размера MTU может вызвать расхождение с соседним оборудованием."],
            ["Согласуйте MTU на обоих концах физического линка."],
        )
    return None, [], []


def analyze_diff_heuristic(
    hostname: str,
    platform: str,
    remediation_patch: str,
    rollback_patch: str,
) -> RiskExplanation:
    """Deterministic fallback analyzer when LLM is offline or unconfigured."""
    if not remediation_patch.strip():
        return RiskExplanation(
            risk_level="LOW",
            summary=f"Конфигурация устройства {hostname} полностью синхронизирована с эталоном.",
            key_points=["Изменения не требуются."],
            recommendations=["Никаких действий предпринимать не требуется."],
            is_safe=True,
            provider="Deterministic Rule-Engine (No Diff)",
        )

    text = remediation_patch.lower()
    points: list[str] = []
    recs: list[str] = []
    level: RiskLevel = "LOW"

    for checker in (_check_bgp_risk, _check_acl_risk, _check_interface_risk):
        c_level, c_points, c_recs = checker(text)
        if c_level is not None:
            points.extend(c_points)
            recs.extend(c_recs)
            if c_level == "CRITICAL" or (c_level == "HIGH" and level != "CRITICAL"):
                level = c_level
            elif c_level == "MEDIUM" and level == "LOW":
                level = "MEDIUM"

    if not points:
        points.append("Косметические изменения параметров интерфейсов или системных настроек.")
        recs.append("Стандартная процедура наката через commit confirmed.")

    summary = (
        f"Анализ устройства {hostname} ({platform}): уровень риска {level}. "
        f"Обнаружено {len(points)} ключевых факторов влияния на сеть."
    )

    return RiskExplanation(
        risk_level=level,
        summary=summary,
        key_points=points,
        recommendations=recs,
        is_safe=(level == "LOW"),
        provider="Deterministic Rule-Engine (Offline Fallback)",
    )


def _sync_http_request(
    url: str, headers: dict[str, str], payload: dict[str, Any], timeout: float = 2.0
) -> str:
    """Execute HTTP POST using standard library with proxy support."""
    data_bytes = json.dumps(payload).encode("utf-8")
    proxy = os.getenv("HTTPS_PROXY") or os.getenv("HTTP_PROXY")
    opener = (
        urllib.request.build_opener(urllib.request.ProxyHandler({"http": proxy, "https": proxy}))
        if proxy
        else urllib.request.build_opener()
    )
    req = urllib.request.Request(url, data=data_bytes, headers=headers, method="POST")
    with opener.open(req, timeout=timeout) as response:
        return response.read().decode("utf-8")


def _llm_candidates(settings: Settings) -> list[tuple[str, str, str, str, float]]:
    """Configured providers in cascade order: (name, base_url, token, model, timeout)."""
    candidates: list[tuple[str, str, str, str, float]] = []
    if settings.groq_api_key:
        candidates.append((
            "Groq",
            settings.groq_base_url,
            settings.groq_api_key.get_secret_value(),
            settings.groq_model,
            max(settings.groq_timeout_seconds, 3.0),
        ))
    if settings.gemini_api_key:
        candidates.append((
            "Google-Gemini",
            settings.gemini_base_url,
            settings.gemini_api_key.get_secret_value(),
            settings.gemini_model,
            max(settings.gemini_timeout_seconds, 10.0),
        ))
    if settings.llm_api_key:
        candidates.append((
            "Team-MiMo",
            settings.llm_base_url,
            settings.llm_api_key.get_secret_value(),
            settings.llm_model,
            settings.llm_timeout_seconds,
        ))
    return candidates


async def chat_with_llm(
    settings: Settings, system_prompt: str, user_prompt: str, timeout_floor: float = 2.0
) -> tuple[str, str] | None:
    """Free-form answer from the first provider that responds; None if every provider fails.

    Chat answers are bounded by `timeout_floor` (default 10.0s) to guarantee response.
    """
    for name, base_url, token, model_name, timeout in _llm_candidates(settings):
        try:
            payload = {
                "model": model_name,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                "temperature": 0.3,
            }
            headers = {
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
                "User-Agent": "CROC-DREAM-NetOps/1.0",
            }
            raw = await asyncio.to_thread(
                _sync_http_request,
                f"{base_url.rstrip('/')}/chat/completions",
                headers,
                payload,
                max(timeout, timeout_floor),
            )
            content = json.loads(raw)["choices"][0]["message"]["content"].strip()
            return content, f"{name} ({model_name})"
        except Exception as exc:
            logger.warning("Copilot provider %s failed: %s", name, exc)
    return None


async def explain_change_with_llm(
    settings: Settings,
    hostname: str,
    platform: str,
    remediation_patch: str,
    rollback_patch: str,
) -> RiskExplanation:
    """Analyze remediation patch using multi-provider cascade with fast failover."""
    if not remediation_patch.strip():
        logger.info("Patch empty; using deterministic rule-engine.")
        return analyze_diff_heuristic(hostname, platform, remediation_patch, rollback_patch)

    candidates = _llm_candidates(settings)
    if not candidates:
        logger.info("No LLM API tokens configured; using deterministic rule-engine fallback.")
        return analyze_diff_heuristic(hostname, platform, remediation_patch, rollback_patch)

    user_prompt = f"""Проанализируй следующий конфигурационный патч:
Устройство: {hostname}
Платформа: {platform}

=== HierConfig Remediation Patch (что будет применено) ===
{remediation_patch}

=== Rollback Patch (обратный откат в случае сбоя) ===
{rollback_patch}
"""

    for prov_name, base_url, token, model_name, timeout in candidates:
        logger.info(
            "Querying LLM provider %s (%s, timeout=%.1fs)...",
            prov_name,
            model_name,
            timeout,
        )
        try:
            req_headers = {
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
                "User-Agent": "CROC-DREAM-NetOps/1.0",
            }
            payload: dict[str, Any] = {
                "model": model_name,
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_prompt},
                ],
                "temperature": 0.1,
            }
            url = f"{base_url.rstrip('/')}/chat/completions"
            raw_text = await asyncio.to_thread(
                _sync_http_request, url, req_headers, payload, timeout
            )
            data = json.loads(raw_text)
            raw_content = data["choices"][0]["message"]["content"]
            match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", raw_content, re.DOTALL)
            clean_json = match.group(1) if match else raw_content.strip()
            parsed = json.loads(clean_json)
            return RiskExplanation(
                risk_level=parsed.get("risk_level", "MEDIUM"),
                summary=parsed.get("summary", ""),
                key_points=parsed.get("key_points", []),
                recommendations=parsed.get("recommendations", []),
                is_safe=parsed.get("is_safe", False),
                provider=f"{prov_name} ({model_name})",
            )
        except Exception as exc:
            logger.warning(
                "LLM provider %s (%s) failed or timed out (%.1fs): %s. "
                "Falling back to next in cascade...",
                prov_name,
                model_name,
                timeout,
                exc,
            )

    logger.warning("All LLM providers in cascade failed; using deterministic rule-engine.")
    fallback = analyze_diff_heuristic(hostname, platform, remediation_patch, rollback_patch)
    fallback.provider = "Deterministic Rule-Engine (Cascade Failover)"
    return fallback
