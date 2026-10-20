"""AI Copilot chat, AI Guard runtime anomaly endpoints, and fallback rule-engine."""

from __future__ import annotations

import asyncio
import re
from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from netops.api.deps import ContainerDep, DeviceServiceDep, Operator, Viewer
from netops.enums import UserRole
from netops.services.llm import chat_with_llm

router = APIRouter(tags=["insights"])

CopilotActionType = Literal["dry_run", "remediate", "open_device", "scan_drift", "open_diff"]


class CopilotAction(BaseModel):
    type: CopilotActionType = Field(..., description="Action type for 1-click action or navigation")
    label: str = Field(..., description="Action button display label")
    device_id: int | None = Field(default=None, description="Target device ID if applicable")
    device_ids: list[int] = Field(default_factory=list, description="Target device IDs if multiple")
    payload: dict[str, Any] = Field(default_factory=dict, description="Parameters for execution")


class CopilotRequest(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    device_id: int | None = None
    screen: str | None = Field(default=None)


class CopilotReply(BaseModel):
    answer: str
    provider: str
    action: CopilotAction | None = None


COPILOT_SYSTEM = (
    "Ты — AI Copilot платформы автоматизации сетей CLOS (Spine-Leaf). "
    "Отвечай по-русски, кратко и по делу, опираясь только на переданный контекст сети. "
    "Не предлагай применять изменения без dry-run и проверки diff.\n\n"
    "Если ситуация требует действия оператора, в конце ответа на отдельной строке укажи:\n"
    "ACTION: <type>|<label>|<device_id>\n"
    "Допустимые типы: remediate, dry_run, open_device, scan_drift, open_diff."
)


def extract_copilot_action(
    text: str,
    default_device_id: int | None = None,
    devices: list[Any] | None = None,
) -> tuple[str, CopilotAction | None]:
    """Parse trailing ACTION: type|label|device_id_or_hostname tag from LLM output."""
    match = re.search(
        r"(?:^|\n)ACTION:\s*(dry_run|remediate|open_device|scan_drift|open_diff)\s*\|\s*([^|\n]+?)(?:\s*\|\s*([^|\n]+?))?\s*$",
        text.strip(),
        re.MULTILINE,
    )
    if not match:
        return text.strip(), None

    act_type, label, raw_target = (
        match.group(1).strip(),
        match.group(2).strip(),
        (match.group(3) or "").strip(),
    )
    dev_id = default_device_id
    if raw_target:
        if raw_target.isdigit():
            dev_id = int(raw_target)
        elif devices:
            raw_low = raw_target.lower()
            matched_dev = next(
                (
                    d
                    for d in devices
                    if str(getattr(d, "hostname", "")).lower() == raw_low
                    or str(getattr(d, "hostname", "")).lower().split(".")[0] == raw_low
                ),
                None,
            )
            if matched_dev is not None:
                dev_id = getattr(matched_dev, "id", default_device_id)
    clean_text = text[: match.start()].rstrip()
    try:
        return clean_text, CopilotAction(type=act_type, label=label, device_id=dev_id)  # type: ignore[arg-type]
    except Exception:
        return clean_text, None


def _sanitize_action_for_role(
    action: CopilotAction | None, role: UserRole
) -> CopilotAction | None:
    """Ensure read-only (Viewer) users only receive non-mutating navigation actions."""
    if action is None or role.grants(UserRole.OPERATOR):
        return action
    if action.type in ("remediate", "dry_run", "scan_drift"):
        target_id = action.device_id or (action.device_ids[0] if action.device_ids else None)
        return (
            CopilotAction(type="open_diff", label="Посмотреть Diff (только чтение)", device_id=target_id)
            if target_id is not None
            else None
        )
    return action


def _device_fallback_action(
    selected: Any,
    alerts: list[Any],
    ai_anomalies: dict[str, str] | None = None,
) -> tuple[str, CopilotAction | None]:
    if str(selected.status) == "DRIFT_DETECTED":
        return (
            f"Устройство {selected.hostname}: обнаружен дрейф конфигурации относительно эталона Git SoT. Рекомендуется применить исправление HierConfig.",
            CopilotAction(type="remediate", label=f"Устранить дрейф на {selected.hostname}", device_id=selected.id),
        )
    if ai_anomalies and selected.hostname in ai_anomalies:
        return (
            f"КРИТИЧЕСКАЯ АНОМАЛИЯ ТЕЛЕМЕТРИИ (AI Guard) на {selected.hostname}: {ai_anomalies[selected.hostname]} Проверьте состояние интерфейсов и BGP-сессий.",
            CopilotAction(type="open_device", label=f"Проверить телеметрию {selected.hostname}", device_id=selected.id),
        )
    dev_alerts = [a for a in alerts if a.device_id == selected.id]
    if dev_alerts:
        a = dev_alerts[0]
        return (
            f"Устройство {selected.hostname}: прогнозируется превышение порога {a.threshold:g}% по «{a.label}» через ~{a.breach_in_minutes} мин. Рекомендуется префлайт-проверка.",
            CopilotAction(type="dry_run", label=f"Запустить Dry-Run для {selected.hostname}", device_id=selected.id),
        )
    return (
        f"Устройство {selected.hostname} ({selected.role}, {selected.platform}): статус {selected.status}. Конфигурация синхронизирована с эталоном.",
        CopilotAction(type="open_diff", label=f"Посмотреть Diff {selected.hostname}", device_id=selected.id),
    )


def _screen_fallback_action(
    screen: str | None,
    alerts: list[Any],
) -> tuple[str, CopilotAction | None] | None:
    if screen == "drift":
        return (
            "Все устройства в синхронизации с Git SoT. Доступно внеочередное сканирование фабрики.",
            CopilotAction(type="scan_drift", label="Запустить сканирование дрейфа"),
        )
    if screen == "diff":
        if alerts:
            f = alerts[0]
            return (
                f"Экран верификации изменений (Diff): прогнозируется нагрузка на {f.hostname} («{f.label}», пробой через ~{f.breach_in_minutes} мин). Рекомендуется Dry-Run.",
                CopilotAction(type="dry_run", label=f"Запустить Dry-Run для {f.hostname}", device_id=f.device_id),
            )
        return (
            "Экран верификации изменений (Diff/Dry-Run). Расхождений нет, доступен префлайт-прогон.",
            CopilotAction(type="dry_run", label="Запустить префлайт Dry-Run"),
        )
    if screen in ("topology", "devices") and alerts:
        f = alerts[0]
        return (
            f"Прогнозируется превышение порога на узле {f.hostname} («{f.label}», пробой через ~{f.breach_in_minutes} мин).",
            CopilotAction(type="open_device", label=f"Перейти к {f.hostname}", device_id=f.device_id),
        )
    return None


def _nominal_fallback_action(screen: str | None, total_devices: int) -> tuple[str, CopilotAction | None]:
    return (
        f"Сеть в штатном режиме. Всего устройств: {total_devices}, дрейф отсутствует, аномалий не прогнозируется.",
        CopilotAction(type="dry_run", label="Запустить префлайт Dry-Run"),
    )


def generate_fallback_action(
    data: CopilotRequest,
    devices: list[Any],
    alerts: list[Any],
    ai_anomalies: dict[str, str] | None = None,
) -> tuple[str, CopilotAction | None]:
    """Deterministic rule-based reply and actionable button generator when LLM is offline."""
    from netops.api.routes.insights import hybrid_rank_devices

    drifting = [d for d in devices if str(d.status) == "DRIFT_DETECTED"]
    selected = None
    if data.device_id is not None:
        selected = next((d for d in devices if d.id == data.device_id), None)

    msg = data.message.lower().strip()
    if any(msg.startswith(g) for g in ["ghbdtn", "привет", "здравствуй", "hello", "hi", "добрый"]):
        return (
            "Привет! Я AI Copilot платформы NetOps. Я анализирую риски конфигураций, "
            "дрейф в сетевой фабрике и помогаю запускать безопасный Dry-Run. "
            "Задайте вопрос по устройствам или выберите действие.",
            CopilotAction(type="dry_run", label="Запустить префлайт Dry-Run"),
        )
    if any(w in msg for w in ["готовност", "деплой", "deploy", "проверк"]):
        if ai_anomalies:
            first_anom_host, first_anom_prob = next(iter(ai_anomalies.items()))
            anom_dev = next((d for d in devices if d.hostname == first_anom_host), None)
            return (
                f"Внимание: деплой заблокирован AI Telemetry Guard — на {first_anom_host} "
                f"зафиксирована аномалия ({first_anom_prob}).",
                CopilotAction(
                    type="open_device",
                    label=f"Проверить {first_anom_host}",
                    device_id=anom_dev.id if anom_dev else None,
                ),
            )
        return (
            "Проверка готовности к деплою: фабрика находится в стабильном состоянии. "
            "Рекомендуется выполнить предварительную верификацию через Dry-Run перед наездом конфигурации.",
            CopilotAction(type="dry_run", label="Запустить префлайт Dry-Run"),
        )
    ranked = hybrid_rank_devices(msg, devices, alerts=alerts, ai_anomalies=ai_anomalies)
    top_match = (
        ranked[0].device
        if ranked and (ranked[0].lexical_score >= 3.5 or ranked[0].semantic_score >= 4.0)
        else None
    )

    if any(w in msg for w in ["dry-run", "dry_run", "dry run", "префлайт", "холостой"]):
        target_dev = selected or top_match
        if target_dev:
            return (
                f"Подготовлен запуск префлайт-проверки Dry-Run для {target_dev.hostname}.",
                CopilotAction(
                    type="dry_run",
                    label=f"Запустить Dry-Run для {target_dev.hostname}",
                    device_id=target_dev.id,
                ),
            )
        return (
            "Подготовлен запуск префлайт-проверки Dry-Run для сетевой фабрики.",
            CopilotAction(type="dry_run", label="Запустить префлайт Dry-Run"),
        )

    if selected is None and ranked and ranked[0].lexical_score >= 4.5:
        selected = ranked[0].device
    if selected is not None:
        return _device_fallback_action(selected, alerts, ai_anomalies=ai_anomalies)

    if drifting:
        drift_names = ", ".join(d.hostname for d in drifting)
        if len(drifting) == 1:
            return (
                f"В фабрике обнаружен дрейф конфигурации на устройстве {drift_names}. "
                f"Рекомендуется устранить расхождение.",
                CopilotAction(
                    type="remediate",
                    label=f"Устранить дрейф на {drifting[0].hostname}",
                    device_id=drifting[0].id,
                ),
            )
        return (
            f"В фабрике обнаружен дрейф конфигурации на {len(drifting)} устройствах "
            f"({drift_names}).",
            CopilotAction(
                type="remediate",
                label=f"Устранить дрейф ({len(drifting)} устр.)",
                device_ids=[d.id for d in drifting],
            ),
        )

    if ai_anomalies:
        anom_host, anom_problem = next(iter(ai_anomalies.items()))
        anom_dev = next((d for d in devices if d.hostname == anom_host), None)
        return (
            f"Внимание (AI Telemetry Guard): зафиксирована операционная аномалия на {anom_host} — "
            f"{anom_problem}",
            CopilotAction(
                type="open_device",
                label=f"Открыть {anom_host}",
                device_id=anom_dev.id if anom_dev else None,
            ),
        )

    screen_action = _screen_fallback_action(data.screen, alerts)
    if screen_action is not None:
        return screen_action

    if alerts:
        first = alerts[0]
        return (
            f"Конфигурация синхронизирована. Ближайший риск: {first.hostname}, "
            f"метрика «{first.label}», пробой через ~{first.breach_in_minutes} мин.",
            CopilotAction(
                type="open_device",
                label=f"Открыть {first.hostname}",
                device_id=first.device_id,
            ),
        )

    return _nominal_fallback_action(data.screen, len(devices))


@router.post("/copilot/chat", response_model=CopilotReply, summary="Ask the AI Copilot")
async def copilot_chat(
    data: CopilotRequest, service: DeviceServiceDep, container: ContainerDep, user: Viewer
) -> CopilotReply:
    from netops.api.routes.devices import device_allowed
    from netops.api.routes.insights import (
        _check_rate_limit,
        _compute_forecast_alerts_sync,
        select_rag_devices,
    )
    from netops.services.ai_guard import AiTelemetryGuard

    _check_rate_limit(f"copilot:{user.username}", limit=30, window_seconds=60.0)
    devices = [
        d for d in service.list_devices(limit=500) if device_allowed(d, user.allowed_system)
    ]
    alerts = await asyncio.to_thread(
        _compute_forecast_alerts_sync, container.settings, devices, 72
    )
    guard = AiTelemetryGuard(container.settings)
    verdicts = await asyncio.to_thread(
        lambda: [guard.verify_execution(d) for d in devices]
    )
    ai_anomalies: dict[str, str] = {
        d.hostname: (v.problem or v.message)
        for d, v in zip(devices, verdicts, strict=True)
        if not v.healthy
    }

    rag_devices = select_rag_devices(
        data.message,
        devices,
        selected_device_id=data.device_id,
        alerts=alerts,
        ai_anomalies=ai_anomalies,
        top_k=12,
    )
    from netops.telemetry import targets

    plan_devices = (targets.last_collector_plan() or {}).get("devices") or {}
    lines: list[str] = []
    for d in rag_devices:
        p_info = plan_devices.get(d.hostname) or {}
        active_proto = p_info.get("protocol", "ssh_cli")
        sup_map = p_info.get("supported_protocols") or {}
        sup_list = [k for k, v in sup_map.items() if isinstance(v, dict) and v.get("supported")] or [active_proto]
        lines.append(
            f"- {d.hostname}: {d.role}, {d.platform}, статус {d.status}, "
            f"протокол сбора={active_proto} (поддерживаются: {', '.join(sup_list)})"
        )
    if len(rag_devices) < len(devices):
        lines.insert(
            0,
            f"Всего устройств в фабрике: {len(devices)} "
            f"(показаны {len(rag_devices)} наиболее релевантных по гибридному RRF-поиску):",
        )
    lines += [
        f"КРИТИЧЕСКАЯ АНОМАЛИЯ ТЕЛЕМЕТРИИ (AI Guard): {host} — {prob}"
        for host, prob in ai_anomalies.items()
    ]
    lines += [
        f"Прогноз: {a.hostname} достигнет порога {a.threshold:g}% по «{a.label}» "
        f"через ~{a.breach_in_minutes} мин"
        for a in alerts
    ]
    if data.screen:
        lines.insert(0, f"Текущий экран оператора: {data.screen}.")
    if data.device_id is not None:
        selected = next((d for d in devices if d.id == data.device_id), None)
        if selected is None:
            raise HTTPException(status_code=404, detail="Device not found")
        lines.insert(
            0, f"Пользователь смотрит устройство {selected.hostname} ({selected.management_ip})."
        )
    context = "\n".join(lines)

    llm_prompt = f"Контекст:\n{context}\n\nВопрос: {data.message}"
    reply = await chat_with_llm(container.settings, COPILOT_SYSTEM, llm_prompt)
    if reply is not None:
        answer_text, action = extract_copilot_action(
            reply[0], default_device_id=data.device_id, devices=devices
        )
        msg_lower = data.message.lower()
        if any(w in msg_lower for w in ["dry-run", "dry_run", "dry run", "префлайт", "холостой"]):
            _, fallback_act = generate_fallback_action(
                data, devices, alerts, ai_anomalies=ai_anomalies
            )
            action = fallback_act
        elif action is None:
            _, fallback_act = generate_fallback_action(
                data, devices, alerts, ai_anomalies=ai_anomalies
            )
            if any(w in msg_lower for w in ["дрейф", "drift", "remediat", "устрани", "исправ"]):
                action = fallback_act
        return CopilotReply(
            answer=answer_text,
            provider=reply[1],
            action=_sanitize_action_for_role(action, user.role),
        )

    summary, fallback_action = generate_fallback_action(
        data, devices, alerts, ai_anomalies=ai_anomalies
    )
    return CopilotReply(
        answer=f"{summary}\n\n(LLM недоступна — автоматическая рекомендация Rule-Engine.)",
        provider="Rule-Engine (offline)",
        action=_sanitize_action_for_role(fallback_action, user.role),
    )


class AiGuardSimulateRequest(BaseModel):
    hostname: str
    anomaly_type: Literal["blackhole", "storm", "clear"]


class AiGuardResponse(BaseModel):
    hostname: str
    healthy: bool
    metric: str
    observed_value: float
    expected_range: tuple[float, float]
    deviation_pct: float
    problem: str | None = None
    message: str = ""
    provider: str = ""
    injected_simulation: str | None = None


@router.get("/ai-guard/check/{device_id}", response_model=AiGuardResponse, summary="Runtime error & anomaly detection via statistical quantile guard")
@router.get("/insights/ai-guard/check/{device_id}", response_model=AiGuardResponse, include_in_schema=False)
async def ai_guard_check_device(
    device_id: int, service: DeviceServiceDep, container: ContainerDep, user: Viewer
) -> AiGuardResponse:
    from netops.api.routes.devices import assert_device_allowed
    from netops.services.ai_guard import AiTelemetryGuard

    device = service.get(device_id)
    assert_device_allowed(device, user.allowed_system)
    guard = AiTelemetryGuard(container.settings)
    verdict = await asyncio.to_thread(guard.verify_execution, device)
    return AiGuardResponse(
        hostname=device.hostname,
        healthy=verdict.healthy,
        metric=verdict.metric,
        observed_value=verdict.observed_value,
        expected_range=verdict.expected_range,
        deviation_pct=verdict.deviation_pct,
        problem=verdict.problem,
        message=verdict.message,
        provider=verdict.provider,
        injected_simulation=guard.get_injected_anomaly(device.hostname),
    )


@router.post("/ai-guard/simulate", summary="Inject simulated operational anomaly (blackhole/storm) for demo (Operator/Admin)")
@router.post("/insights/ai-guard/simulate", include_in_schema=False)
async def ai_guard_simulate_anomaly(
    data: AiGuardSimulateRequest, service: DeviceServiceDep, user: Operator
) -> dict[str, str]:
    from netops.api.routes.devices import assert_device_allowed
    from netops.services.ai_guard import AiTelemetryGuard

    device = service.get_by_hostname(data.hostname)
    if device is not None:
        assert_device_allowed(device, user.allowed_system)
    AiTelemetryGuard.inject_anomaly(data.hostname, data.anomaly_type)
    return {
        "status": "ok",
        "hostname": data.hostname,
        "anomaly": data.anomaly_type,
        "message": f"Simulated {data.anomaly_type} set on {data.hostname}",
    }


@router.get("/ai-guard/overview", response_model=list[AiGuardResponse], summary="AI Guard health overview across all network devices")
@router.get("/insights/ai-guard/overview", response_model=list[AiGuardResponse], include_in_schema=False)
async def ai_guard_overview(
    service: DeviceServiceDep, container: ContainerDep, user: Viewer
) -> list[AiGuardResponse]:
    from netops.api.routes.devices import device_allowed
    from netops.services.ai_guard import AiTelemetryGuard

    devices = [
        d for d in service.list_devices(limit=500) if device_allowed(d, user.allowed_system)
    ]
    guard = AiTelemetryGuard(container.settings)
    verdicts = await asyncio.to_thread(lambda: [guard.verify_execution(d) for d in devices])
    return [
        AiGuardResponse(
            hostname=d.hostname,
            healthy=verdict.healthy,
            metric=verdict.metric,
            observed_value=verdict.observed_value,
            expected_range=verdict.expected_range,
            deviation_pct=verdict.deviation_pct,
            problem=verdict.problem,
            message=verdict.message,
            provider=verdict.provider,
            injected_simulation=guard.get_injected_anomaly(d.hostname),
        )
        for d, verdict in zip(devices, verdicts, strict=True)
    ]


@router.post("/insights/telegram/broadcast", summary="Broadcast AI network executive summary to Telegram chat (Operator/Admin)")
async def broadcast_to_telegram(
    service: DeviceServiceDep, container: ContainerDep, _: Operator
) -> dict[str, Any]:
    from netops.api.routes.insights import get_fabric_summary
    from netops.services.notifier import send_telegram_message

    summary_data = await get_fabric_summary(service, container, _)
    tg_text = (
        "<b>[NetOps Platform] Оперативная сводка фабрики</b>\n\n"
        f"<b>Статус:</b> Всего {summary_data.total_devices} | "
        f"Sync: {summary_data.in_sync_count} | "
        f"Drift: {summary_data.drift_count} | "
        f"Unreachable: {summary_data.unreachable_count}\n\n"
        f"<b>AI Резюме:</b>\n{summary_data.ai_executive_summary}\n\n"
        f"<i>Провайдер: {summary_data.ai_provider}</i>"
    )
    sent = await asyncio.to_thread(send_telegram_message, container.settings, tg_text)
    return {
        "status": "ok" if sent else "skipped",
        "delivered": sent,
        "configured": summary_data.telegram_configured,
        "message": "Broadcast sent to Telegram" if sent else "Telegram unconfigured or send failed",
    }
