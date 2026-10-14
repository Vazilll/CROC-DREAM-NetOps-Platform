"""AI-assisted insights: metric forecasts, predicted threshold breaches and the Copilot chat."""

from __future__ import annotations

import asyncio
import re
from typing import Annotated, Any, Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from netops.api.deps import ContainerDep, DeviceServiceDep, Viewer
from netops.services.forecast import ForecastRead, build_forecast
from netops.services.llm import chat_with_llm
from netops.services.telemetry import METRICS

router = APIRouter(tags=["insights"])

Metric = Annotated[str, Query(pattern="^(" + "|".join(METRICS) + ")$")]
Horizon = Annotated[int, Query(ge=12, le=288)]


class ForecastAlert(BaseModel):
    device_id: int
    hostname: str
    metric: str
    label: str
    threshold: float
    breach_in_minutes: int


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
    screen: str | None = Field(
        default=None,
        description="Active UI screen: dashboard, topology, devices, device, diff, drift, jobs",
    )


class CopilotReply(BaseModel):
    answer: str
    provider: str
    action: CopilotAction | None = None


COPILOT_SYSTEM = (
    "Ты — AI Copilot платформы автоматизации сетей CLOS (Spine-Leaf). "
    "Отвечай по-русски, кратко и по делу, опираясь только на переданный контекст сети. "
    "Если данных не хватает — скажи об этом. "
    "Не предлагай применять изменения без dry-run и проверки diff.\n\n"
    "Если ситуация требует действия оператора (устранение дрейфа, запуск dry-run, "
    "просмотр diff, переход к проблемному узлу или сканирование), в конце ответа на отдельной "
    "строке укажи действие:\n"
    "ACTION: <type>|<label>|<device_id>\n"
    "Допустимые типы: remediate, dry_run, open_device, scan_drift, open_diff.\n"
    "Примеры:\n"
    "ACTION: remediate|Устранить дрейф|1\n"
    "ACTION: dry_run|Запустить Dry-Run|2\n"
    "ACTION: open_device|Перейти к leaf-1|1\n"
    "ACTION: scan_drift|Сканировать дрейф|\n"
    "Если действие не требуется, не добавляй строку ACTION."
)


def extract_copilot_action(
    text: str, default_device_id: int | None = None
) -> tuple[str, CopilotAction | None]:
    """Parse trailing ACTION: type|label|device_id tag from LLM output."""
    match = re.search(
        r"(?:^|\n)ACTION:\s*(dry_run|remediate|open_device|scan_drift|open_diff)\s*\|\s*([^|\n]+?)(?:\s*\|\s*(\d+)?)?\s*$",
        text.strip(),
        re.MULTILINE,
    )
    if not match:
        return text.strip(), None

    act_type = match.group(1).strip()
    label = match.group(2).strip()
    raw_id = match.group(3)
    dev_id = int(raw_id) if raw_id and raw_id.isdigit() else default_device_id
    clean_text = text[: match.start()].rstrip()
    try:
        return clean_text, CopilotAction(type=act_type, label=label, device_id=dev_id)  # type: ignore[arg-type]
    except Exception:
        return clean_text, None


def _device_fallback_action(
    selected: Any,
    alerts: list[ForecastAlert],
) -> tuple[str, CopilotAction | None]:
    if str(selected.status) == "DRIFT_DETECTED":
        return (
            f"Устройство {selected.hostname}: обнаружен дрейф конфигурации относительно "
            f"эталона Git SoT. Рекомендуется применить исправление HierConfig.",
            CopilotAction(
                type="remediate",
                label=f"Устранить дрейф на {selected.hostname}",
                device_id=selected.id,
            ),
        )
    dev_alerts = [a for a in alerts if a.device_id == selected.id]
    if dev_alerts:
        a = dev_alerts[0]
        return (
            f"Устройство {selected.hostname}: прогнозируется превышение порога {a.threshold:g}% "
            f"по «{a.label}» через ~{a.breach_in_minutes} мин. Рекомендуется префлайт-проверка.",
            CopilotAction(
                type="dry_run",
                label=f"Запустить Dry-Run для {selected.hostname}",
                device_id=selected.id,
            ),
        )
    return (
        f"Устройство {selected.hostname} ({selected.role}, {selected.platform}): "
        f"статус {selected.status}. Конфигурация синхронизирована с эталоном.",
        CopilotAction(
            type="open_diff",
            label=f"Посмотреть Diff {selected.hostname}",
            device_id=selected.id,
        ),
    )


def _screen_fallback_action(
    screen: str | None,
    alerts: list[ForecastAlert],
) -> tuple[str, CopilotAction | None] | None:
    """Screen-specific recommendations when configuration is synchronized."""
    if screen == "drift":
        return (
            "Все устройства в синхронизации с Git SoT. Доступно внеочередное сканирование фабрики.",
            CopilotAction(type="scan_drift", label="Запустить сканирование дрейфа"),
        )

    if screen == "diff":
        if alerts:
            first = alerts[0]
            return (
                f"Экран верификации изменений (Diff): прогнозируется нагрузка на {first.hostname} "
                f"(«{first.label}», пробой через ~{first.breach_in_minutes} мин). "
                f"Рекомендуется Dry-Run.",
                CopilotAction(
                    type="dry_run",
                    label=f"Запустить Dry-Run для {first.hostname}",
                    device_id=first.device_id,
                ),
            )
        return (
            "Экран верификации изменений (Diff/Dry-Run). "
            "Расхождений нет, доступен префлайт-прогон.",
            CopilotAction(type="dry_run", label="Запустить префлайт Dry-Run"),
        )

    if screen == "topology" and alerts:
        first = alerts[0]
        return (
            f"Топология фабрики: прогнозируется превышение порога на узле {first.hostname} "
            f"(«{first.label}», пробой через ~{first.breach_in_minutes} мин).",
            CopilotAction(
                type="open_device",
                label=f"Перейти к {first.hostname}",
                device_id=first.device_id,
            ),
        )

    if screen == "devices" and alerts:
        first = alerts[0]
        return (
            f"Инвентарь устройств: прогнозируется риск на узле {first.hostname} "
            f"(«{first.label}», пробой через ~{first.breach_in_minutes} мин).",
            CopilotAction(
                type="open_device",
                label=f"Открыть {first.hostname}",
                device_id=first.device_id,
            ),
        )

    return None


def _nominal_fallback_action(
    screen: str | None,
    total_devices: int,
) -> tuple[str, CopilotAction | None]:
    """Quiet / nominal state fallback actions."""
    if screen == "topology":
        return (
            f"Топология фабрики стабильна ({total_devices} узлов). Загрузка линков в норме, "
            f"дрейф отсутствует.",
            CopilotAction(type="dry_run", label="Запустить префлайт Dry-Run"),
        )
    if screen == "devices":
        return (
            f"Инвентарь устройств в норме: {total_devices} узлов синхронизированы с Git SoT, "
            f"аномалий не прогнозируется.",
            CopilotAction(type="dry_run", label="Запустить префлайт Dry-Run"),
        )
    return (
        f"Сеть в штатном режиме. Всего устройств: {total_devices}, дрейф отсутствует, "
        f"аномалий не прогнозируется.",
        CopilotAction(type="dry_run", label="Запустить префлайт Dry-Run"),
    )


def generate_fallback_action(
    data: CopilotRequest,
    devices: list[Any],
    alerts: list[ForecastAlert],
) -> tuple[str, CopilotAction | None]:
    """Deterministic rule-based reply and actionable button generator when LLM is offline."""
    drifting = [d for d in devices if str(d.status) == "DRIFT_DETECTED"]
    selected = None
    if data.device_id is not None:
        selected = next((d for d in devices if d.id == data.device_id), None)

    # 0. User Intent Check (Greetings, Deploy Checks, Help)
    msg = data.message.lower().strip()
    if any(msg.startswith(g) for g in ["ghbdtn", "привет", "здравствуй", "hello", "hi", "добрый"]):
        return (
            "Привет! Я AI Copilot платформы NetOps. Я анализирую риски конфигураций, "
            "дрейф в сетевой фабрике и помогаю запускать безопасный Dry-Run. "
            "Задайте вопрос по устройствам или выберите действие.",
            CopilotAction(type="dry_run", label="Запустить префлайт Dry-Run"),
        )
    if any(w in msg for w in ["готовност", "деплой", "deploy", "проверк"]):
        return (
            "Проверка готовности к деплою: фабрика находится в стабильном состоянии. "
            "Рекомендуется выполнить предварительную верификацию через Dry-Run перед наездом конфигурации.",
            CopilotAction(type="dry_run", label="Запустить префлайт Dry-Run"),
        )
    if any(w in msg for w in ["dry-run", "dry_run", "dry run", "префлайт", "холостой"]):
        target_dev = None
        for d in devices:
            host_prefix = d.hostname.split(".")[0].lower()
            if d.hostname.lower() in msg or host_prefix in msg:
                target_dev = d
                break
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

    # 1. Device-specific context
    if selected is not None:
        return _device_fallback_action(selected, alerts)

    # 2. Network-wide context
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

    # 3. Screen-specific context (when configuration is synchronized)
    screen_action = _screen_fallback_action(data.screen, alerts)
    if screen_action is not None:
        return screen_action

    # 4. Global forecast alert fallback (Dashboard or general context)
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

    # 5. Quiet / nominal state fallback
    return _nominal_fallback_action(data.screen, len(devices))


@router.get(
    "/devices/{device_id}/forecast",
    response_model=ForecastRead,
    summary="Metric history and statistical telemetry forecast of a device",
)
async def device_forecast(
    device_id: int,
    service: DeviceServiceDep,
    container: ContainerDep,
    _: Viewer,
    metric: Metric = "uplink_util_pct",
    horizon: Horizon = 72,
) -> ForecastRead:
    device = service.get(device_id)
    return await asyncio.to_thread(
        build_forecast,
        container.settings,
        device.id,
        device.hostname,
        str(device.role),
        metric,
        horizon,
        session_factory=container.session_factory,
    )


@router.get(
    "/insights/forecast/{hostname}",
    response_model=ForecastRead,
    summary="Metric history and statistical telemetry forecast of a device by hostname",
)
async def device_forecast_by_hostname(
    hostname: str,
    service: DeviceServiceDep,
    container: ContainerDep,
    _: Viewer,
    metric: Metric = "uplink_util_pct",
    horizon: Horizon = 72,
) -> ForecastRead:
    dev_obj = (
        service.get(int(hostname))
        if hostname.isdigit()
        else next((d for d in service.list_devices(limit=500) if d.hostname == hostname), None)
    )
    if dev_obj is None:
        raise HTTPException(status_code=404, detail=f"Device '{hostname}' not found")
    return await asyncio.to_thread(
        build_forecast,
        container.settings,
        dev_obj.id,
        dev_obj.hostname,
        str(dev_obj.role),
        metric,
        horizon,
        session_factory=container.session_factory,
    )


@router.get(
    "/forecast/alerts",
    response_model=list[ForecastAlert],
    summary="Devices predicted to cross a metric threshold within the horizon",
)
async def forecast_alerts(
    service: DeviceServiceDep, container: ContainerDep, _: Viewer, horizon: Horizon = 72
) -> list[ForecastAlert]:
    devices = list(service.list_devices(limit=500))
    tasks = [
        asyncio.to_thread(
            build_forecast,
            container.settings,
            device.id,
            device.hostname,
            str(device.role),
            metric,
            horizon,
            session_factory=container.session_factory,
        )
        for device in devices
        for metric in METRICS
    ]
    forecasts = await asyncio.gather(*tasks)
    alerts = [
        ForecastAlert(
            device_id=f.device_id,
            hostname=f.hostname,
            metric=f.metric,
            label=f.label,
            threshold=f.threshold,
            breach_in_minutes=f.breach_in_minutes,
        )
        for f in forecasts
        if f.breach_in_minutes is not None
    ]
    return sorted(alerts, key=lambda a: a.breach_in_minutes)


@router.post("/copilot/chat", response_model=CopilotReply, summary="Ask the AI Copilot")
async def copilot_chat(
    data: CopilotRequest, service: DeviceServiceDep, container: ContainerDep, user: Viewer
) -> CopilotReply:
    devices = list(service.list_devices(limit=500))
    alerts = await forecast_alerts(service, container, user)
    lines = [f"- {d.hostname}: {d.role}, {d.platform}, статус {d.status}" for d in devices]
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
        answer_text, action = extract_copilot_action(reply[0], default_device_id=data.device_id)
        msg_lower = data.message.lower()
        if any(w in msg_lower for w in ["dry-run", "dry_run", "dry run", "префлайт", "холостой"]):
            _, fallback_act = generate_fallback_action(data, devices, alerts)
            action = fallback_act
        elif action is None:
            _, fallback_act = generate_fallback_action(data, devices, alerts)
            if any(w in msg_lower for w in ["дрейф", "drift", "remediat", "устрани", "исправ"]):
                action = fallback_act
        return CopilotReply(answer=answer_text, provider=reply[1], action=action)

    summary, fallback_action = generate_fallback_action(data, devices, alerts)
    return CopilotReply(
        answer=f"{summary}\n\n(LLM недоступна — автоматическая рекомендация Rule-Engine.)",
        provider="Rule-Engine (offline)",
        action=fallback_action,
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


@router.get(
    "/ai-guard/check/{device_id}",
    response_model=AiGuardResponse,
    summary="Runtime error & anomaly detection via statistical quantile guard",
)
@router.get("/insights/ai-guard/check/{device_id}", response_model=AiGuardResponse, include_in_schema=False)
async def ai_guard_check_device(
    device_id: int, service: DeviceServiceDep, container: ContainerDep, _: Viewer
) -> AiGuardResponse:
    from netops.services.ai_guard import AiTelemetryGuard  # noqa: PLC0415

    device = service.get(device_id)
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


@router.post(
    "/ai-guard/simulate",
    summary="Inject simulated operational anomaly (blackhole/storm) for demo",
)
@router.post("/insights/ai-guard/simulate", include_in_schema=False)
async def ai_guard_simulate_anomaly(
    data: AiGuardSimulateRequest, _: Viewer
) -> dict[str, str]:
    from netops.services.ai_guard import AiTelemetryGuard  # noqa: PLC0415

    AiTelemetryGuard.inject_anomaly(data.hostname, data.anomaly_type)
    return {
        "status": "ok",
        "hostname": data.hostname,
        "anomaly": data.anomaly_type,
        "message": f"Simulated {data.anomaly_type} set on {data.hostname}",
    }


@router.get(
    "/ai-guard/overview",
    response_model=list[AiGuardResponse],
    summary="AI Guard health overview across all network devices",
)
@router.get("/insights/ai-guard/overview", response_model=list[AiGuardResponse], include_in_schema=False)
async def ai_guard_overview(

    service: DeviceServiceDep, container: ContainerDep, _: Viewer
) -> list[AiGuardResponse]:
    from netops.services.ai_guard import AiTelemetryGuard  # noqa: PLC0415

    devices = list(service.list_devices(limit=500))
    guard = AiTelemetryGuard(container.settings)
    verdicts = await asyncio.gather(
        *(asyncio.to_thread(guard.verify_execution, d) for d in devices)
    )
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


class FabricSummaryResponse(BaseModel):
    total_devices: int
    in_sync_count: int
    drift_count: int
    unreachable_count: int
    active_alarms: list[str] = Field(default_factory=list)
    ai_executive_summary: str
    ai_provider: str
    telegram_configured: bool


@router.get(
    "/insights/fabric-summary",
    response_model=FabricSummaryResponse,
    summary="Get aggregated network fabric health and AI executive summary",
)
async def get_fabric_summary(
    service: DeviceServiceDep,
    container: ContainerDep,
    _: Viewer,
) -> FabricSummaryResponse:
    from netops.enums import DeviceStatus  # noqa: PLC0415
    from netops.services.notifier import send_telegram_message  # noqa: PLC0415

    devices = list(service.list_devices(limit=500))
    total = len(devices)
    in_sync = sum(1 for d in devices if d.status == DeviceStatus.IN_SYNC)
    drift = sum(1 for d in devices if d.status == DeviceStatus.DRIFT_DETECTED)
    unreachable = sum(1 for d in devices if d.status == DeviceStatus.UNREACHABLE)

    alarms = []
    if drift > 0:
        drift_devs = [d.hostname for d in devices if d.status == DeviceStatus.DRIFT_DETECTED]
        alarms.append(f"Дрейф конфигурации на узлах: {', '.join(drift_devs)}")
    if unreachable > 0:
        unreach_devs = [d.hostname for d in devices if d.status == DeviceStatus.UNREACHABLE]
        alarms.append(f"Недоступны по SSH: {', '.join(unreach_devs)}")

    prompt = (
        f"Текущее состояние фабрики ЦОД:\n"
        f"- Всего устройств: {total}\n"
        f"- В синхронизации (IN_SYNC): {in_sync}\n"
        f"- Обнаружен дрейф (DRIFT): {drift}\n"
        f"- Недоступны (UNREACHABLE): {unreachable}\n"
        f"Алерты: {'; '.join(alarms) if alarms else 'Нет'}\n\n"
        f"Составь краткую сводку для дежурного сетевого инженера на русском языке (2-3 предложения), "
        f"оцени операционный статус и дай рекомендацию."
    )
    res = await chat_with_llm(
        container.settings,
        system_prompt="Ты — главный сетевой архитектор платформы NetOps. Отвечай кратко, чётко и профессионально.",
        user_prompt=prompt,
        timeout_floor=3.0,
    )

    if res:
        ai_summary, provider = res
    else:
        if drift == 0 and unreachable == 0:
            ai_summary = "Фабрика полностью синхронизирована с Git-эталоном. Аномалий и расхождений не зафиксировано."
        elif drift > 0:
            ai_summary = f"Внимание: обнаружено {drift} устройств с несанкционированными правками. Рекомендуется запустить ремедиацию."
        else:
            ai_summary = f"Внимание: {unreachable} узлов не отвечают по SSH. Проверьте сетевую связность или перезапустите лабу."
        provider = "Deterministic Rule-Engine"

    is_tg = bool(container.settings.telegram_bot_token and container.settings.telegram_chat_id)
    return FabricSummaryResponse(
        total_devices=total,
        in_sync_count=in_sync,
        drift_count=drift,
        unreachable_count=unreachable,
        active_alarms=alarms,
        ai_executive_summary=ai_summary,
        ai_provider=provider,
        telegram_configured=is_tg,
    )


@router.post(
    "/insights/telegram/broadcast",
    summary="Broadcast AI network executive summary to Telegram chat",
)
async def broadcast_to_telegram(
    service: DeviceServiceDep,
    container: ContainerDep,
    _: Viewer,
) -> dict[str, Any]:
    from netops.services.notifier import send_telegram_message  # noqa: PLC0415

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
    sent = send_telegram_message(container.settings, tg_text)
    return {
        "status": "ok" if sent else "skipped",
        "delivered": sent,
        "configured": summary_data.telegram_configured,
        "message": "Broadcast sent to Telegram" if sent else "Telegram unconfigured or send failed",
    }


