"""Unified Redis state manager with seamless thread-safe in-memory fallback.

Provides shared hot state (live telemetry time-series, Git SoT cache, rendered template cache,
and Factory Freeze) as well as distributed sync locks (two-phase rollback protection and
emergency patch safety) across API replicas and background workers.
"""

from __future__ import annotations

import json
import logging
import threading
import time
from datetime import UTC, datetime
from typing import Any

from netops.settings import Settings, get_settings

logger = logging.getLogger(__name__)


class _ManagerHolder:
    instance: StateManager | None = None
    lock = threading.Lock()


class StateManager:
    """Singleton state manager providing Redis connectivity with circuit breaker.

    When Redis is offline or unreachable, operations fall back to an internal
    thread-safe in-memory store with zero latency overhead.
    """

    def __init__(
        self,
        settings: Settings | None = None,
        redis_url: str | None = None,
        enable_redis: bool | None = None,
        probe_cooldown_seconds: float = 30.0,
        socket_timeout: float = 0.2,
    ) -> None:
        import os

        self._settings = settings or get_settings()
        self._redis_url = redis_url if redis_url is not None else self._settings.redis_url
        if enable_redis is None:
            self._enable_redis = not ("PYTEST_CURRENT_TEST" in os.environ and redis_url is None)
        else:
            self._enable_redis = enable_redis
        self._probe_cooldown_seconds = probe_cooldown_seconds
        self._socket_timeout = socket_timeout

        self._client: Any = None
        self._is_redis_online: bool | None = None
        self._last_probe_time: float = 0.0

        # Thread-safe in-memory stores
        self._lock = threading.RLock()
        self._local_kv: dict[str, tuple[float | None, str]] = {}
        self._local_locks: dict[str, tuple[float, dict[str, Any]]] = {}
        self._local_telemetry: dict[str, dict[str, list[float]]] = {}
        self._local_git_sot: dict[str, tuple[float, dict[str, Any]]] = {}
        self._local_templates: dict[str, tuple[float, str]] = {}
        self._local_freeze: dict[str, Any] = {
            "frozen": False,
            "reason": "Штатная эксплуатация (заморозка выключена)",
            "timestamp": None,
            "user": None,
            "updated_by": None,
        }
        self._local_fabric_freeze: dict[str, dict[str, Any]] = {}

    def _get_redis(self) -> Any:
        """Return connected Redis client, or None if disabled, unreachable, or in cooldown."""
        if not self._enable_redis or not self._redis_url:
            return None

        now = time.monotonic()
        # Fast-fail circuit breaker: skip network attempt if in probe cooldown window
        cooldown_active = (now - self._last_probe_time) < self._probe_cooldown_seconds
        if self._is_redis_online is False and cooldown_active:
            return None

        if self._client is not None and self._is_redis_online:
            return self._client

        try:
            import redis

            client = redis.Redis.from_url(
                self._redis_url,
                decode_responses=True,
                socket_timeout=self._socket_timeout,
                socket_connect_timeout=self._socket_timeout,
            )
            client.ping()
            self._client = client
            self._is_redis_online = True
            logger.info("Connected to Redis shared state store at %s", self._redis_url)
            return self._client
        except Exception as exc:
            self._is_redis_online = False
            self._last_probe_time = now
            self._client = None
            logger.debug(
                "Redis unavailable (%s); using thread-safe in-memory state store (cooldown %ss)",
                exc,
                self._probe_cooldown_seconds,
            )
            return None

    def _handle_redis_error(self, exc: Exception) -> None:
        self._is_redis_online = False
        self._last_probe_time = time.monotonic()
        self._client = None
        logger.debug("Redis operation failed (%s); failing over to in-memory state", exc)

    @property
    def is_redis_connected(self) -> bool:
        """Check if currently connected to a live Redis instance."""
        return bool(self._get_redis() is not None)

    # -------------------------------------------------------------------------
    # Primitive Key-Value Operations with TTL
    # -------------------------------------------------------------------------

    def get(self, key: str) -> str | None:
        client = self._get_redis()
        if client:
            try:
                return client.get(key)
            except Exception as exc:
                self._handle_redis_error(exc)

        with self._lock:
            entry = self._local_kv.get(key)
            if entry is None:
                return None
            expires_at, val = entry
            if expires_at is not None and time.time() > expires_at:
                self._local_kv.pop(key, None)
                return None
            return val

    def set(self, key: str, value: str, ex: int | None = None) -> bool:
        client = self._get_redis()
        if client:
            try:
                return bool(client.set(key, value, ex=ex))
            except Exception as exc:
                self._handle_redis_error(exc)

        with self._lock:
            expires_at = (time.time() + ex) if ex else None
            self._local_kv[key] = (expires_at, value)
            return True

    def delete(self, key: str) -> bool:
        client = self._get_redis()
        if client:
            try:
                return bool(client.delete(key))
            except Exception as exc:
                self._handle_redis_error(exc)

        with self._lock:
            return bool(self._local_kv.pop(key, None))

    def get_json(self, key: str) -> Any | None:
        raw = self.get(key)
        if raw is None:
            return None
        try:
            return json.loads(raw)
        except Exception:
            return None

    def set_json(self, key: str, value: Any, ex: int | None = None) -> bool:
        return self.set(key, json.dumps(value, ensure_ascii=False), ex=ex)

    # Hot ephemeral keys stored exclusively in Redis (never written to heavy PostgreSQL)
    _HOT_REDIS_KEYS: frozenset[str] = frozenset(
        {
            "prometheus_snmp_targets",
            "prometheus_exporter_targets",
            "netops:telemetry:protocols",
            "chaos_events",
            "grafana_noc_dashboard",
        }
    )
    _NULL_SENTINEL = "__netops_db_null__"

    def _get_db_engine(self, database_url: str | None = None) -> Any | None:
        import os

        db_url = database_url or getattr(self._settings, "database_url", "") or ""
        if not db_url:
            return None
        if (
            "PYTEST_CURRENT_TEST" in os.environ
            and db_url.startswith("postgresql")
            and "localhost" in db_url
        ):
            return None
        eng_cache: dict[str, Any] = getattr(self, "_db_engines", {})
        if db_url not in eng_cache:
            try:
                import contextlib

                from netops.db import build_engine
                from netops.models.system_state import SystemState

                eng = build_engine(db_url)
                with contextlib.suppress(Exception):
                    SystemState.__table__.create(bind=eng, checkfirst=True)
                eng_cache[db_url] = eng
                self._db_engines = eng_cache
            except Exception:
                return None
        return eng_cache.get(db_url)

    def get_db_state(
        self, key: str, default: Any = None, *, database_url: str | None = None
    ) -> Any:
        cache_key = f"netops:db_state:{key}"
        cached = self.get_json(cache_key)
        if cached is not None:
            if isinstance(cached, dict) and cached.get(self._NULL_SENTINEL) is True:
                return default
            return cached
        engine = self._get_db_engine(database_url)
        if engine is not None:
            try:
                from sqlalchemy.orm import Session

                from netops.models.system_state import SystemState

                with Session(engine) as sess:
                    row = sess.get(SystemState, key)
                    if row is not None and row.value is not None:
                        self.set_json(cache_key, row.value, ex=600)
                        return row.value
                    if key != "runtime_settings":
                        self.set_json(cache_key, {self._NULL_SENTINEL: True}, ex=60)
            except Exception:
                pass
        return default

    def set_db_state(
        self, key: str, value: Any, *, database_url: str | None = None
    ) -> bool:
        cache_key = f"netops:db_state:{key}"
        ttl = 86400 if key in self._HOT_REDIS_KEYS else 3600
        self.set_json(cache_key, value, ex=ttl)
        engine = self._get_db_engine(database_url)
        if engine is not None:
            try:
                from sqlalchemy.orm import Session

                from netops.db import utcnow
                from netops.models.system_state import SystemState

                with Session(engine) as sess:
                    sess.merge(SystemState(key=key, value=value, updated_at=utcnow()))
                    sess.commit()
            except Exception as exc:
                logger.debug("Failed to persist SystemState[%s] to DB: %s", key, exc)
        return True

    # -------------------------------------------------------------------------
    # Distributed Sync Locks (Two-Phase Rollback Protection & Emergency Patches)
    # -------------------------------------------------------------------------

    def acquire_sync_lock(
        self,
        target: str,
        holder: str,
        ttl: int = 600,
        reason: str = "",
    ) -> bool:
        """Acquire a distributed sync lock for target (e.g. 'device:1', 'fabric:pod1').

        Returns True if the lock was acquired, False if already held by another active process.
        """
        now_ts = time.time()
        payload = {
            "target": target,
            "holder": holder,
            "reason": reason or "Active deployment or rollback",
            "acquired_at": datetime.now(UTC).isoformat(),
            "expires_at": datetime.fromtimestamp(now_ts + ttl, UTC).isoformat(),
            "ttl": ttl,
        }
        raw = json.dumps(payload, ensure_ascii=False)
        key = f"netops:sync_lock:{target}"

        client = self._get_redis()
        if client:
            try:
                acquired = bool(client.set(key, raw, nx=True, ex=ttl))
                if acquired:
                    with self._lock:
                        self._local_locks[target] = (now_ts + ttl, payload)
                    return True
                return False
            except Exception as exc:
                self._handle_redis_error(exc)

        with self._lock:
            existing = self._local_locks.get(target)
            if existing:
                exp, _ = existing
                if exp > now_ts:
                    return False
            self._local_locks[target] = (now_ts + ttl, payload)
            return True

    def _release_redis_lock(self, client: Any, key: str, holder: str | None) -> bool | None:
        try:
            raw = client.get(key)
            if not raw:
                return False
            try:
                data = json.loads(raw)
                if holder is not None and data.get("holder") != holder:
                    return False
            except Exception:
                pass
            return bool(client.delete(key))
        except Exception as exc:
            self._handle_redis_error(exc)
            return None

    def release_sync_lock(self, target: str, holder: str | None = None) -> bool:
        """Release a distributed sync lock for target.

        If holder is specified, verifies that the caller owns the lock before releasing.
        Returns True if released, False if not locked or holder mismatch.
        """
        key = f"netops:sync_lock:{target}"
        client = self._get_redis()
        if client:
            redis_res = self._release_redis_lock(client, key, holder)
            if redis_res is not None:
                with self._lock:
                    self._local_locks.pop(target, None)
                return redis_res

        with self._lock:
            existing = self._local_locks.get(target)
            if not existing:
                return False
            exp, data = existing
            if time.time() > exp:
                self._local_locks.pop(target, None)
                return False
            if holder is not None and data.get("holder") != holder:
                return False
            self._local_locks.pop(target, None)
            return True

    def get_sync_lock_info(self, target: str) -> dict[str, Any] | None:
        """Return active lock metadata dictionary for target, or None if unlocked or expired."""
        key = f"netops:sync_lock:{target}"
        client = self._get_redis()
        if client:
            try:
                raw = client.get(key)
                if raw:
                    return json.loads(raw)
                return None
            except Exception as exc:
                self._handle_redis_error(exc)

        with self._lock:
            existing = self._local_locks.get(target)
            if not existing:
                return None
            exp, payload = existing
            if time.time() > exp:
                self._local_locks.pop(target, None)
                return None
            return dict(payload)

    def is_sync_locked(self, target: str) -> bool:
        """Check whether target is currently locked."""
        return self.get_sync_lock_info(target) is not None

    # -------------------------------------------------------------------------
    # Telemetry Cache
    # -------------------------------------------------------------------------

    def append_telemetry(
        self, hostname: str, metric: str, value: float, max_points: int = 288
    ) -> None:
        """Append a metric reading to telemetry time-series."""
        is_pct = metric.endswith(("_pct", "percent", "utilization"))
        clamped = (
            round(max(0.0, min(100.0, float(value))), 2)
            if is_pct
            else round(max(0.0, float(value)), 2)
        )
        key = f"netops:telemetry:{hostname}:{metric}"

        client = self._get_redis()
        if client:
            try:
                pipe = client.pipeline()
                pipe.rpush(key, str(clamped))
                pipe.ltrim(key, -max_points, -1)
                pipe.expire(key, 86400 * 7)
                pipe.execute()
            except Exception as exc:
                self._handle_redis_error(exc)

        with self._lock:
            series = self._local_telemetry.setdefault(hostname, {}).setdefault(metric, [])
            series.append(clamped)
            if len(series) > max_points:
                series.pop(0)

    def get_telemetry_series(
        self, hostname: str, metric: str, points: int = 24
    ) -> list[float]:
        """Fetch the most recent readings for given hostname and metric."""
        key = f"netops:telemetry:{hostname}:{metric}"
        client = self._get_redis()
        if client:
            try:
                raw_items = client.lrange(key, -points, -1)
                if raw_items:
                    return [float(x) for x in raw_items]
            except Exception as exc:
                self._handle_redis_error(exc)

        with self._lock:
            series = self._local_telemetry.get(hostname, {}).get(metric, [])
            return list(series[-points:])

    def set_telemetry_series(
        self, hostname: str, metric: str, series: list[float], ttl: int = 86400 * 7
    ) -> None:
        """Explicitly set time-series data for a metric."""
        is_pct = metric.endswith(("_pct", "percent", "utilization"))
        clamped_series = [
            round(max(0.0, min(100.0, float(x))), 2)
            if is_pct
            else round(max(0.0, float(x)), 2)
            for x in series
        ]
        key = f"netops:telemetry:{hostname}:{metric}"

        client = self._get_redis()
        if client:
            try:
                pipe = client.pipeline()
                pipe.delete(key)
                if clamped_series:
                    pipe.rpush(key, *[str(x) for x in clamped_series])
                pipe.expire(key, ttl)
                pipe.execute()
            except Exception as exc:
                self._handle_redis_error(exc)

        with self._lock:
            self._local_telemetry.setdefault(hostname, {})[metric] = list(clamped_series)

    def clear_telemetry(self, hostname: str | None = None) -> None:
        """Clear telemetry cache for a single host or all hosts."""
        client = self._get_redis()
        pattern = f"netops:telemetry:{hostname or '*'}:*"
        if client:
            try:
                keys = list(client.scan_iter(pattern))
                if keys:
                    client.delete(*keys)
            except Exception as exc:
                self._handle_redis_error(exc)

        with self._lock:
            if hostname is None:
                self._local_telemetry.clear()
            else:
                self._local_telemetry.pop(hostname, None)

    # -------------------------------------------------------------------------
    # Git SoT Metadata Cache
    # -------------------------------------------------------------------------

    def get_git_sot_meta(self, cache_key: str) -> dict[str, Any] | None:
        """Get cached Git SoT repository metadata if still valid."""
        key = f"netops:git_sot:{cache_key}"
        client = self._get_redis()
        if client:
            try:
                raw = client.get(key)
                if raw:
                    return json.loads(raw)
            except Exception as exc:
                self._handle_redis_error(exc)

        with self._lock:
            entry = self._local_git_sot.get(cache_key)
            if not entry:
                return None
            expires_at, val = entry
            if time.time() > expires_at:
                self._local_git_sot.pop(cache_key, None)
                return None
            return dict(val)

    def set_git_sot_meta(self, cache_key: str, data: dict[str, Any], ttl: int = 10) -> None:
        """Cache Git SoT repository metadata with TTL."""
        key = f"netops:git_sot:{cache_key}"
        raw = json.dumps(data, ensure_ascii=False)
        client = self._get_redis()
        if client:
            try:
                client.set(key, raw, ex=ttl)
            except Exception as exc:
                self._handle_redis_error(exc)

        with self._lock:
            self._local_git_sot[cache_key] = (time.time() + ttl, dict(data))

    def clear_git_sot_meta(self) -> None:
        """Invalidate all Git SoT cache entries."""
        client = self._get_redis()
        if client:
            try:
                keys = list(client.scan_iter("netops:git_sot:*"))
                if keys:
                    client.delete(*keys)
            except Exception as exc:
                self._handle_redis_error(exc)

        with self._lock:
            self._local_git_sot.clear()

    # -------------------------------------------------------------------------
    # Rendered Template Cache
    # -------------------------------------------------------------------------

    def get_rendered_template(self, key: str) -> str | None:
        """Get cached rendered configuration template if present."""
        redis_key = f"netops:template:{key}"
        client = self._get_redis()
        if client:
            try:
                return client.get(redis_key)
            except Exception as exc:
                self._handle_redis_error(exc)

        with self._lock:
            entry = self._local_templates.get(key)
            if not entry:
                return None
            expires_at, val = entry
            if time.time() > expires_at:
                self._local_templates.pop(key, None)
                return None
            return val

    def set_rendered_template(self, key: str, content: str, ttl: int = 300) -> None:
        """Cache rendered configuration template with TTL."""
        redis_key = f"netops:template:{key}"
        client = self._get_redis()
        if client:
            try:
                client.set(redis_key, content, ex=ttl)
            except Exception as exc:
                self._handle_redis_error(exc)

        with self._lock:
            self._local_templates[key] = (time.time() + ttl, content)

    # -------------------------------------------------------------------------
    # Factory Freeze State (Global and Per-Stand Fabric Isolation)
    # -------------------------------------------------------------------------

    def _get_global_factory_freeze(self, client: Any) -> dict[str, Any]:
        state = dict(self._local_freeze)
        if client:
            try:
                raw = client.get("netops:factory_freeze")
                if raw:
                    state = json.loads(raw)
            except Exception as exc:
                self._handle_redis_error(exc)

        frozen_fabrics: dict[str, Any] = {}
        if client:
            try:
                prefix = "netops:factory_freeze:fabric:"
                for k in client.scan_iter(f"{prefix}*"):
                    fab_id = k.removeprefix(prefix)
                    fab_raw = client.get(k)
                    if fab_raw:
                        val = json.loads(fab_raw)
                        if val.get("frozen"):
                            frozen_fabrics[fab_id] = val
            except Exception as exc:
                self._handle_redis_error(exc)

        with self._lock:
            for fab_id, val in self._local_fabric_freeze.items():
                if val.get("frozen") and fab_id not in frozen_fabrics:
                    frozen_fabrics[fab_id] = val

        state["fabrics"] = frozen_fabrics
        return state

    def get_factory_freeze(self, fabric_id: str | None = None) -> dict[str, Any]:
        """Fetch Factory Freeze state for a specific stand or global fabric."""
        client = self._get_redis()
        if fabric_id:
            key = f"netops:factory_freeze:fabric:{fabric_id}"
            if client:
                try:
                    raw = client.get(key)
                    if raw:
                        return json.loads(raw)
                except Exception as exc:
                    self._handle_redis_error(exc)

            with self._lock:
                default_msg = f"Штатная эксплуатация стенда {fabric_id}"
                return dict(
                    self._local_fabric_freeze.get(
                        fabric_id,
                        {
                            "frozen": False,
                            "reason": default_msg,
                            "fabric_id": fabric_id,
                            "timestamp": None,
                            "user": None,
                            "updated_by": None,
                        },
                    )
                )

        return self._get_global_factory_freeze(client)

    def set_factory_freeze(
        self,
        frozen: bool,
        reason: str = "",
        user: str = "operator",
        fabric_id: str | None = None,
    ) -> dict[str, Any]:
        """Set Factory Freeze state globally or for a specific stand fabric_id."""
        actor = user or "operator"
        timestamp = datetime.now(UTC).isoformat()

        if fabric_id:
            default_reason = (
                f"Заморозка стенда {fabric_id} активирована оператором"
                if frozen
                else f"Штатная эксплуатация стенда {fabric_id}"
            )
            state = {
                "frozen": frozen,
                "reason": reason or default_reason,
                "fabric_id": fabric_id,
                "timestamp": timestamp,
                "user": actor,
                "updated_by": actor,
            }
            with self._lock:
                self._local_fabric_freeze[fabric_id] = state

            client = self._get_redis()
            if client:
                try:
                    client.set(
                        f"netops:factory_freeze:fabric:{fabric_id}",
                        json.dumps(state, ensure_ascii=False),
                    )
                except Exception as exc:
                    self._handle_redis_error(exc)

            if frozen:
                logger.warning(
                    "EMERGENCY STAND FREEZE ACTIVATED for %s by %s: %s", fabric_id, actor, reason
                )
            else:
                logger.info("Stand freeze for %s deactivated by %s", fabric_id, actor)
            return dict(state)

        default_reason = (
            "Заморозка активирована оператором" if frozen else "Штатная эксплуатация"
        )
        state = {
            "frozen": frozen,
            "reason": reason or default_reason,
            "timestamp": timestamp,
            "user": actor,
            "updated_by": actor,
        }
        with self._lock:
            self._local_freeze.update(state)

        client = self._get_redis()
        if client:
            try:
                client.set("netops:factory_freeze", json.dumps(state, ensure_ascii=False))
            except Exception as exc:
                self._handle_redis_error(exc)

        if frozen:
            logger.warning("EMERGENCY FACTORY FREEZE ACTIVATED by %s: %s", actor, reason)
        else:
            logger.info("Factory freeze deactivated by %s", actor)
        return dict(state)

    def is_factory_frozen(self, fabric_id: str | None = None) -> bool:
        """Return True if global factory freeze or stand-specific freeze is active."""
        if bool(self.get_factory_freeze().get("frozen", False)):
            return True
        if fabric_id:
            return bool(self.get_factory_freeze(fabric_id=fabric_id).get("frozen", False))
        return False

    def reset_factory_freeze(self) -> None:
        """Reset all factory freeze state (global and stands)."""
        with self._lock:
            self._local_freeze.update({
                "frozen": False,
                "reason": "Штатная эксплуатация (заморозка выключена)",
                "timestamp": None,
                "user": None,
                "updated_by": None,
            })
            self._local_fabric_freeze.clear()

        client = self._get_redis()
        if client:
            try:
                keys = list(client.scan_iter("netops:factory_freeze*"))
                if keys:
                    client.delete(*keys)
            except Exception as exc:
                self._handle_redis_error(exc)

    def reset(self) -> None:
        """Reset all in-memory local state (useful for test isolation)."""
        with self._lock:
            self._local_kv.clear()
            self._local_locks.clear()
            self._local_telemetry.clear()
            self._local_git_sot.clear()
            self._local_templates.clear()
            self._local_freeze.update({
                "frozen": False,
                "reason": "Штатная эксплуатация (заморозка выключена)",
                "timestamp": None,
                "user": None,
                "updated_by": None,
            })
            self._local_fabric_freeze.clear()
            for eng in getattr(self, "_db_engines", {}).values():
                try:
                    eng.dispose()
                except Exception:
                    pass
            self._db_engines = {}


def get_state_manager(
    settings: Settings | None = None,
    force_refresh: bool = False,
    **kwargs: Any,
) -> StateManager:
    """Return the global StateManager singleton."""
    with _ManagerHolder.lock:
        if _ManagerHolder.instance is None or force_refresh:
            _ManagerHolder.instance = StateManager(settings=settings, **kwargs)
        return _ManagerHolder.instance


def reset_state_manager() -> None:
    """Reset the global singleton and its internal state."""
    with _ManagerHolder.lock:
        if _ManagerHolder.instance is not None:
            _ManagerHolder.instance.reset()
        _ManagerHolder.instance = None
