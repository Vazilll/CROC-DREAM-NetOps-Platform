"""AI-assisted insights: metric forecasts, predicted threshold breaches and the Copilot chat."""

from __future__ import annotations

import asyncio
import re
from dataclasses import dataclass
from typing import Annotated, Any, Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from netops.api.deps import ContainerDep, DeviceServiceDep, Operator, Viewer
from netops.enums import UserRole
from netops.services.forecast import ForecastRead, build_forecast
from netops.services.llm import chat_with_llm
from netops.services.telemetry import METRICS

_SYNONYMS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("huawei_vrp", ("huawei", "vrp", "хуавей", "хуавее", "хуавея", "cloudengine")),
    ("cisco_iosxe", ("cisco", "ios", "iosxe", "nxos", "циско", "циске", "nexus")),
    ("arista_eos", ("arista", "eos", "ариста", "аристе", "ceos")),
    ("juniper_junos", ("juniper", "junos", "джунипер", "vqfx", "vmx")),
    ("eltex_mes", ("eltex", "mes", "esr", "элтекс")),
    ("yadro_kornfe", ("yadro", "kornfe", "ядро", "корнфе")),
    ("linux_server", ("linux", "server", "ubuntu", "линукс", "сервер")),
    ("role_spine", ("spine", "спайн", "спайне", "спайны", "ядро", "магистрал", "core")),
    ("role_leaf", ("leaf", "лиф", "лифе", "лифы", "tor", "тор", "доступ")),
    ("role_border", ("border", "бордер", "границ", "fw", "firewall", "межсетев")),
    ("state_drift", ("drift", "дрейф", "рассинхрон", "расхожд", "изменен")),
    ("state_down", ("unreachable", "down", "недоступ", "упал", "лежит", "ssh")),
    ("state_anomaly", ("anomaly", "alert", "degraded", "blackhole", "storm", "bgp", "аномал", "авария", "проблем", "блэкхол", "шторм", "бгп", "риск")),
)


@dataclass(frozen=True, slots=True)
class RankedDevice:
    device: Any
    rrf_score: float
    lexical_score: float
    semantic_score: float
    lexical_rank: int
    semantic_rank: int
    match_reason: str


def _concepts(text: str) -> set[str]:
    low = text.lower()
    return {tag for tag, roots in _SYNONYMS if any(r in low for r in roots)}


def hybrid_rank_devices(
    query: str,
    devices: list[Any],
    *,
    alerts: list[Any] | None = None,
    ai_anomalies: dict[str, str] | None = None,
    k: int = 60,
) -> list[RankedDevice]:
    """Rank devices using lexical token matching and concept synonyms."""
    if not devices:
        return []
    q = query.strip().lower()
    q_tokens = [t for t in re.split(r"[^a-zа-яё0-9._-]+", q) if len(t) >= 2]
    q_conc = _concepts(q)
    alert_ids = {getattr(a, "device_id", None) for a in (alerts or [])}
    anomalies = ai_anomalies or {}

    lex_scores: list[float] = []
    sem_scores: list[float] = []
    for d in devices:
        host = str(getattr(d, "hostname", "")).lower()
        short = host.split(".")[0]
        ip = str(getattr(d, "management_ip", "")).lower()
        plat = str(getattr(d, "platform", "")).lower()
        role = str(getattr(d, "role", "")).lower()
        status = str(getattr(d, "status", "")).lower()
        site = str(getattr(d, "site", "") or "").lower()
        anom = anomalies.get(getattr(d, "hostname", ""), "").lower()
        doc = f"{host} {ip} {plat} {role} {status} {site} {anom}"

        ls = 12.0 if (host and (host in q or q in (short, ip))) else (9.0 if short in q_tokens else 0.0)
        for tok in q_tokens:
            ls += 8.0 if tok in (host, short, ip) else (4.5 if (tok in host or tok in ip) else (3.5 if tok in (plat, role, status, site) else (1.5 if tok in doc else 0.0)))
        lex_scores.append(ls)

        d_conc = _concepts(doc)
        if "drift" in status:
            d_conc |= {"state_drift", "state_anomaly"}
        if "unreachable" in status:
            d_conc |= {"state_down", "state_anomaly"}
        if getattr(d, "hostname", "") in anomalies or getattr(d, "id", None) in alert_ids:
            d_conc.add("state_anomaly")
        ss = len(q_conc & d_conc) * 4.0 + (3.5 if (q_conc & {"state_anomaly", "state_drift", "state_down"} and getattr(d, "hostname", "") in anomalies) else 0.0)
        sem_scores.append(ss)

    lex_rank = {idx: r for r, idx in enumerate(sorted(range(len(devices)), key=lambda i: (-lex_scores[i], i)))}
    sem_rank = {idx: r for r, idx in enumerate(sorted(range(len(devices)), key=lambda i: (-sem_scores[i], i)))}
    ranked = [
        RankedDevice(
            device=d,
            rrf_score=round((1.0 / (k + lex_rank[i] + 1) if lex_scores[i] > 0 else 0.0) + (1.0 / (k + sem_rank[i] + 1) if sem_scores[i] > 0 else 0.0), 6),
            lexical_score=round(lex_scores[i], 3),
            semantic_score=round(sem_scores[i], 3),
            lexical_rank=lex_rank[i] + 1,
            semantic_rank=sem_rank[i] + 1,
            match_reason="hybrid" if (lex_scores[i] > 0 and sem_scores[i] > 0) else ("lexical" if lex_scores[i] > 0 else ("semantic" if sem_scores[i] > 0 else "baseline")),
        )
        for i, d in enumerate(devices)
    ]
    ranked.sort(key=lambda r: (-r.rrf_score, -r.lexical_score, -r.semantic_score, str(getattr(r.device, "hostname", ""))))
    return ranked


def select_rag_devices(
    query: str,
    devices: list[Any],
    *,
    selected_device_id: int | None = None,
    alerts: list[Any] | None = None,
    ai_anomalies: dict[str, str] | None = None,
    top_k: int = 12,
) -> list[Any]:
    """Select Top-K relevant devices + unhealthy/selected nodes for LLM context."""
    if len(devices) <= top_k:
        return list(devices)
    ranked = hybrid_rank_devices(query, devices, alerts=alerts, ai_anomalies=ai_anomalies)
    alert_ids = {getattr(a, "device_id", None) for a in (alerts or [])}
    anom_hosts = set((ai_anomalies or {}).keys())
    chosen: list[Any] = []
    seen: set[Any] = set()

    def _add(dev: Any) -> None:
        key = getattr(dev, "id", None) or getattr(dev, "hostname", id(dev))
        if key not in seen:
            seen.add(key)
            chosen.append(dev)

    for d in devices:
        st = str(getattr(d, "status", "")).upper()
        if getattr(d, "id", None) == selected_device_id or "DRIFT" in st or "UNREACHABLE" in st or getattr(d, "hostname", "") in anom_hosts or getattr(d, "id", None) in alert_ids:
            _add(d)
    for r in ranked:
        if len(chosen) >= top_k and r.lexical_score == 0 and r.semantic_score < 2.0:
            break
        _add(r.device)
        if len(chosen) >= max(top_k, len(seen)):
            break
    return chosen


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

    act_type, label, raw_id = match.group(1).strip(), match.group(2).strip(), match.group(3)
    dev_id = int(raw_id) if raw_id and raw_id.isdigit() else default_device_id
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
    alerts: list[ForecastAlert],
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
    alerts: list[ForecastAlert],
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
    alerts: list[ForecastAlert],
    ai_anomalies: dict[str, str] | None = None,
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
    ranked = hybrid_rank_devices(
        msg, devices, alerts=alerts, ai_anomalies=ai_anomalies
    )
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

    # 1. Device-specific context (explicitly selected or matched via Hybrid RRF)
    if selected is None and ranked and ranked[0].lexical_score >= 4.5:
        selected = ranked[0].device
    if selected is not None:
        return _device_fallback_action(selected, alerts, ai_anomalies=ai_anomalies)

    # 2. Network-wide context (Drift or Runtime AI Guard Anomalies)
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


_RATE_LIMIT_BUCKETS: dict[str, list[float]] = {}


def _check_rate_limit(key: str, limit: int = 30, window_seconds: float = 60.0) -> None:
    """Sliding-window rate limiter for expensive AI/broadcast endpoints."""
    import time

    now = time.monotonic()
    if len(_RATE_LIMIT_BUCKETS) > 1024:
        stale_keys = [
            k
            for k, ts_list in _RATE_LIMIT_BUCKETS.items()
            if not ts_list or (now - ts_list[-1]) >= window_seconds
        ]
        for k in stale_keys:
            _RATE_LIMIT_BUCKETS.pop(k, None)
        if len(_RATE_LIMIT_BUCKETS) > 1024:
            _RATE_LIMIT_BUCKETS.clear()
    bucket = [ts for ts in _RATE_LIMIT_BUCKETS.get(key, []) if now - ts < window_seconds]
    if len(bucket) >= limit:
        _RATE_LIMIT_BUCKETS[key] = bucket
        raise HTTPException(
            status_code=429,
            detail=f"Rate limit exceeded ({limit} requests per {int(window_seconds)}s). Please wait.",
        )
    bucket.append(now)
    _RATE_LIMIT_BUCKETS[key] = bucket


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


def _compute_forecast_alerts_sync(
    settings: Any, devices: list[Any], horizon: int
) -> list[ForecastAlert]:
    alerts: list[ForecastAlert] = []
    for device in devices:
        role_str = str(device.role)
        for metric in METRICS:
            f = build_forecast(
                settings,
                device.id,
                device.hostname,
                role_str,
                metric,
                horizon,
                include_events=False,
            )
            if f.breach_in_minutes is not None:
                alerts.append(
                    ForecastAlert(
                        device_id=f.device_id,
                        hostname=f.hostname,
                        metric=f.metric,
                        label=f.label,
                        threshold=f.threshold,
                        breach_in_minutes=f.breach_in_minutes,
                    )
                )
    return sorted(alerts, key=lambda a: a.breach_in_minutes)


@router.get(
    "/forecast/alerts",
    response_model=list[ForecastAlert],
    summary="Devices predicted to cross a metric threshold within the horizon",
)
async def forecast_alerts(
    service: DeviceServiceDep, container: ContainerDep, _: Viewer, horizon: Horizon = 72
) -> list[ForecastAlert]:
    devices = list(service.list_devices(limit=500))
    return await asyncio.to_thread(
        _compute_forecast_alerts_sync, container.settings, devices, horizon
    )


@router.post("/copilot/chat", response_model=CopilotReply, summary="Ask the AI Copilot")
async def copilot_chat(
    data: CopilotRequest, service: DeviceServiceDep, container: ContainerDep, user: Viewer
) -> CopilotReply:
    from netops.services.ai_guard import AiTelemetryGuard

    _check_rate_limit(f"copilot:{user.username}", limit=30, window_seconds=60.0)
    devices = list(service.list_devices(limit=500))
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
    lines = [
        f"- {d.hostname}: {d.role}, {d.platform}, статус {d.status}"
        for d in rag_devices
    ]
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
        answer_text, action = extract_copilot_action(reply[0], default_device_id=data.device_id)
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


@router.get(
    "/ai-guard/check/{device_id}",
    response_model=AiGuardResponse,
    summary="Runtime error & anomaly detection via statistical quantile guard",
)
@router.get("/insights/ai-guard/check/{device_id}", response_model=AiGuardResponse, include_in_schema=False)
async def ai_guard_check_device(
    device_id: int, service: DeviceServiceDep, container: ContainerDep, _: Viewer
) -> AiGuardResponse:
    from netops.services.ai_guard import AiTelemetryGuard

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
    summary="Inject simulated operational anomaly (blackhole/storm) for demo (Operator/Admin)",
)
@router.post("/insights/ai-guard/simulate", include_in_schema=False)
async def ai_guard_simulate_anomaly(
    data: AiGuardSimulateRequest, _: Operator
) -> dict[str, str]:
    from netops.services.ai_guard import AiTelemetryGuard

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
    from netops.services.ai_guard import AiTelemetryGuard

    devices = list(service.list_devices(limit=500))
    guard = AiTelemetryGuard(container.settings)
    verdicts = await asyncio.to_thread(
        lambda: [guard.verify_execution(d) for d in devices]
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
    from netops.enums import DeviceStatus
    from netops.services.ai_guard import AiTelemetryGuard

    devices = list(service.list_devices(limit=500))
    total = len(devices)
    in_sync = sum(1 for d in devices if d.status == DeviceStatus.IN_SYNC)
    drift = sum(1 for d in devices if d.status == DeviceStatus.DRIFT_DETECTED)
    unreachable = sum(1 for d in devices if d.status == DeviceStatus.UNREACHABLE)

    guard = AiTelemetryGuard(container.settings)
    verdicts = await asyncio.to_thread(
        lambda: [guard.verify_execution(d) for d in devices]
    )

    alarms = []
    if drift > 0:
        drift_devs = [d.hostname for d in devices if d.status == DeviceStatus.DRIFT_DETECTED]
        alarms.append(f"Дрейф конфигурации на узлах: {', '.join(drift_devs)}")
    if unreachable > 0:
        unreach_devs = [d.hostname for d in devices if d.status == DeviceStatus.UNREACHABLE]
        alarms.append(f"Недоступны по SSH: {', '.join(unreach_devs)}")
    for d, v in zip(devices, verdicts, strict=True):
        if not v.healthy and (v.problem or v.message):
            alarms.append(f"AI Guard ({d.hostname}): {v.problem or v.message}")

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
        if drift == 0 and unreachable == 0 and not alarms:
            ai_summary = "Фабрика полностью синхронизирована с Git-эталоном. Аномалий и расхождений не зафиксировано."
        elif drift == 0 and unreachable == 0 and alarms:
            ai_summary = f"Конфигурации синхронизированы, но зафиксирована аномалия телеметрии: {'; '.join(alarms)}."
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
    summary="Broadcast AI network executive summary to Telegram chat (Operator/Admin)",
)
async def broadcast_to_telegram(
    service: DeviceServiceDep,
    container: ContainerDep,
    _: Operator,
) -> dict[str, Any]:
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


class HybridSearchHit(BaseModel):
    device_id: int
    hostname: str
    management_ip: str
    platform: str
    role: str
    status: str
    rrf_score: float
    lexical_score: float
    semantic_score: float
    lexical_rank: int
    semantic_rank: int
    match_reason: str


@router.get(
    "/insights/search",
    response_model=list[HybridSearchHit],
    summary="Hybrid Search (Lexical + Semantic/Synonym RRF) across network devices",
)
@router.get("/search", response_model=list[HybridSearchHit], include_in_schema=False)
async def hybrid_search_endpoint(
    service: DeviceServiceDep,
    _: Viewer,
    q: str = Query(default="", max_length=200),
    limit: int = Query(default=10, ge=1, le=50),
) -> list[HybridSearchHit]:
    devices = list(service.list_devices(limit=500))
    ranked = hybrid_rank_devices(q, devices)
    if q.strip():
        ranked = [r for r in ranked if r.rrf_score > 0]
    return [
        HybridSearchHit(
            device_id=r.device.id,
            hostname=r.device.hostname,
            management_ip=str(r.device.management_ip),
            platform=str(r.device.platform),
            role=str(r.device.role),
            status=str(r.device.status),
            rrf_score=r.rrf_score,
            lexical_score=r.lexical_score,
            semantic_score=r.semantic_score,
            lexical_rank=r.lexical_rank,
            semantic_rank=r.semantic_rank,
            match_reason=r.match_reason,
        )
        for r in ranked[:limit]
    ]
