"""Local standalone launcher for CROC DREAM NetOps Platform.

Runs FastAPI with SQLite and an in-process threaded background dispatcher,
allowing full UI, dry-run, deploy, and drift workflows without Docker or Redis.
"""

from __future__ import annotations

import concurrent.futures
import logging
import os
import sys
import uuid
from pathlib import Path

# Add backend directory to sys.path
BACKEND_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BACKEND_DIR.parent
sys.path.insert(0, str(BACKEND_DIR))

# Read .env so NETOPS_NETWORK_DRIVER / NETOPS_MODE from .env are respected before setting defaults
_env_file = BACKEND_DIR / ".env"
if _env_file.is_file():
    for _line in _env_file.read_text(encoding="utf-8").splitlines():
        _s = _line.strip()
        if _s and not _s.startswith("#") and "=" in _s:
            _k, _v = _s.split("=", 1)
            os.environ.setdefault(_k.strip(), _v.strip().strip('"').strip("'"))

_mode = os.environ.get("NETOPS_MODE", "").strip().lower()
_drv = os.environ.get("NETOPS_NETWORK_DRIVER", "").strip().lower()
if "--live" in sys.argv or os.environ.get("NETOPS_LIVE", "") == "1" or _mode in ("online", "live"):
    is_live = True
elif "--offline" in sys.argv or _mode == "offline":
    is_live = False
elif _drv in ("scrapli", "offline"):
    is_live = _drv == "scrapli"
else:
    is_live = False

is_offline = not is_live
default_driver = "scrapli" if is_live else "offline"
default_inventory = "inventory.yaml"

# Default environment variables for standalone local run
os.environ.setdefault("NETOPS_DATABASE_URL", "postgresql+psycopg://netops:netops@127.0.0.1:5432/netops")
os.environ.setdefault("NETOPS_INTENT_REPO_PATH", str(PROJECT_ROOT / "intent"))
os.environ["NETOPS_INVENTORY_FILE"] = os.environ.get("NETOPS_INVENTORY_FILE", default_inventory)
os.environ.setdefault("NETOPS_TEMPLATES_PATH", str(PROJECT_ROOT / "templates"))
os.environ.setdefault("NETOPS_OFFLINE_LAB_PATH", str(PROJECT_ROOT / "lab" / "running"))
os.environ["NETOPS_NETWORK_DRIVER"] = default_driver
os.environ.setdefault("NETOPS_DRIFT_SCAN_INTERVAL_SECONDS", "3600")
os.environ.setdefault("NETOPS_METRICS_INTERVAL_SECONDS", "3600")

os.environ.setdefault("NETOPS_CORS_ORIGINS", '["*"]')
os.environ.setdefault(
    "NETOPS_API_TOKENS",
    '{"dev-owner-token": {"username": "owner", "role": "owner"}, "dev-admin-token": {"username": "admin", "role": "admin"}, "dev-operator-token": {"username": "operator", "role": "operator"}, "dev-viewer-token": {"username": "viewer", "role": "viewer"}, "dev-jury-token": {"username": "jury", "role": "viewer"}, "croc-admin-token": {"username": "admin", "role": "admin"}, "croc-demo-jury": {"username": "jury", "role": "viewer"}}',
)
if is_live:
    os.environ.setdefault("NETOPS_CLAB_PORT", "221")
    os.environ.setdefault("NETOPS_CLAB_USER", "crocdream")
    os.environ.setdefault("NETOPS_CLAB_KEY_PATH", os.path.expanduser("~/.ssh/id_ed25519"))
    os.environ.setdefault("NETOPS_CLAB_TOPOLOGY_PATH", "/home/crocdream/clab-quickstart/fabric.clab.yaml")
    os.environ.setdefault("NETOPS_PROMETHEUS_URL", "http://127.0.0.1:9090")



import uvicorn

from netops.api.app import create_app
from netops.db import Base, build_engine, build_session_factory
from netops.intent.repository import IntentRepository
from netops.network.rendering import JinjaConfigRenderer
from netops.pipeline import JobRunner
from netops.services import DeviceService
from netops.settings import get_settings
from netops.toolchain import build_toolchain

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("netops.local")


class ThreadedJobDispatcher:
    """Dispatches jobs to a background thread pool instead of Celery."""

    def __init__(self, runner_factory) -> None:
        self._runner_factory = runner_factory
        self._executor = concurrent.futures.ThreadPoolExecutor(max_workers=4, thread_name_prefix="netops-worker")

    def dispatch(self, job_id: uuid.UUID) -> None:
        logger.info("Dispatching job %s to background thread...", job_id)
        self._executor.submit(self._run_job, job_id)

    def _run_job(self, job_id: uuid.UUID) -> None:
        try:
            runner = self._runner_factory()
            status = runner.run(job_id)
            logger.info("Job %s completed with status: %s", job_id, status)
        except Exception:
            logger.exception("Error executing job %s in background thread", job_id)


def init_local_environment() -> None:
    settings = get_settings()
    engine = build_engine(settings.database_url)
    session_factory = build_session_factory(engine)

    logger.info("Initializing database schema at %s...", settings.database_url)
    Base.metadata.create_all(engine)

    # Make sure lab running configs exist
    lab_dir = Path(settings.offline_lab_path)
    lab_dir.mkdir(parents=True, exist_ok=True)

    intent_repo = IntentRepository(Path(settings.intent_repo_path), inventory_file=settings.inventory_file)
    templates_dir = Path(settings.templates_path)
    renderer = JinjaConfigRenderer(templates_dir)

    # Continuous GitOps: Reconcile inventory on boot only after Owner bootstrap is completed
    rt_overlay = settings.apply_runtime_overlay()
    if rt_overlay.get("bootstrap_completed"):
        try:
            snapshot = intent_repo.load()
            with session_factory() as session:
                device_svc = DeviceService(session)
                sync_res = device_svc.sync_inventory(snapshot.inventory)
                logger.info(
                    "GitOps inventory reconcile on boot: created=%s, updated=%s, unchanged=%s",
                    sync_res.created,
                    sync_res.updated,
                    sync_res.unchanged,
                )
        except Exception:
            logger.exception("Failed to reconcile inventory from %s", settings.intent_repo_path)
    else:
        logger.info("Fresh uninitialized database: waiting for Owner Matryoshka Bootstrap Wizard in Web UI")

    # Ensure initial running .cfg files exist for each device
    if rt_overlay.get("bootstrap_completed") or "--offline" in sys.argv:
        try:
            snapshot = intent_repo.load()
            for dev in snapshot.inventory.devices:
                cfg_file = lab_dir / f"{dev.hostname}.cfg"
                if not cfg_file.exists():
                    intent = snapshot.intent_for(dev.hostname)
                    cfg = renderer.render(dev, intent)
                    cfg_file.write_text(cfg, encoding="utf-8")
                    logger.info("Generated initial running config: %s", cfg_file.name)
        except Exception:
            logger.exception("Failed to ensure running configs in %s", lab_dir)


def _start_beat(settings, session_factory, dispatcher) -> None:
    """In-process analogue of Celery Beat (see netops/worker/celery_app.py).

    - drift scan: first run shortly after start, then every drift_scan_interval_seconds;
      every scan refreshes oper/intent status, so a node that comes back is picked up by itself;
    - stale jobs cleanup every STALE_JOBS_CHECK_INTERVAL_SECONDS.
    """
    import threading
    import time
    from datetime import timedelta

    from netops.pipeline import fail_stale_jobs
    from netops.services import JobService

    first_delay = int(os.environ.get("NETOPS_BEAT_FIRST_DELAY_SECONDS", "3600"))

    def _cleanup(timeout: timedelta) -> None:
        with session_factory() as session:
            failed = fail_stale_jobs(session, timeout=timeout)
            if failed:
                logger.warning("Beat: failed stale jobs: %s", failed)

    intent_repo = IntentRepository(Path(settings.intent_repo_path), inventory_file=settings.inventory_file)

    def _loop() -> None:
        # Воркеры локального режима живут в этом процессе: всё, что осталось
        # RUNNING/PENDING от прошлого запуска, уже мертво и блокирует планировщик.
        try:
            _cleanup(timedelta(0))
            if settings.apply_runtime_overlay().get("bootstrap_completed"):
                with session_factory() as session:
                    from netops.telemetry import collector

                    toolchain = build_toolchain(settings)
                    samples = collector.collect(
                        session, toolchain, include_fabric_label=True
                    )
                    collector.publish(
                        samples, ttl_seconds=settings.metrics_interval_seconds * 3
                    )
        except Exception:
            logger.exception("Beat: startup cleanup/metrics failed")
        time.sleep(first_delay)
        while True:
            try:
                _cleanup(timedelta(seconds=settings.job_timeout_seconds))
                if not settings.apply_runtime_overlay().get("bootstrap_completed"):
                    time.sleep(5.0)
                    continue
                with session_factory() as session:
                    try:
                        from netops.telemetry import collector

                        toolchain = build_toolchain(settings)
                        samples = collector.collect(
                            session, toolchain, include_fabric_label=True
                        )
                        collector.publish(
                            samples, ttl_seconds=settings.metrics_interval_seconds * 3
                        )
                    except Exception:
                        logger.warning("Beat: metrics collection skipped due to error")

                    try:
                        snapshot = intent_repo.load()
                        device_svc = DeviceService(session)
                        sync_res = device_svc.sync_inventory(snapshot.inventory)
                        if sync_res.created or sync_res.updated:
                            logger.info(
                                "Beat: GitOps auto-synced inventory: created=%s, updated=%s",
                                sync_res.created,
                                sync_res.updated,
                            )
                    except Exception:
                        logger.warning("Beat: GitOps inventory auto-sync skipped due to error")

                    job = JobService(session, dispatcher).schedule_drift_scan()
                    logger.info("Beat: scheduled drift scan %s", job.id if job else "(skipped)")
            except Exception:
                logger.exception("Beat tick failed")
            time.sleep(settings.drift_scan_interval_seconds)

    threading.Thread(target=_loop, name="netops-beat", daemon=True).start()
    logger.info(
        "Beat started: drift scan every %ss (first run in %ss)",
        settings.drift_scan_interval_seconds,
        first_delay,
    )

    from netops.telemetry.bot import build_bot

    def _bot_loop() -> None:
        alert_interval = int(os.environ.get("NETOPS_DRIFT_SCAN_INTERVAL_SECONDS", "3600"))
        last_alert_ts = time.monotonic()
        active_tok = ""
        bot = None
        while True:
            try:
                settings.apply_runtime_overlay()
                cur_tok = (
                    settings.telegram_bot_token.get_secret_value().strip()
                    if settings.telegram_bot_token
                    else ""
                )
                if not cur_tok:
                    time.sleep(3.0)
                    continue
                if cur_tok != active_tok or bot is None:
                    bot = build_bot(settings, cur_tok)
                    active_tok = cur_tok
                    bot.catch_up()
                    bot.send_startup_audit()
                    logger.info(
                        "Telegram @Croc_Dream_bot started dynamically (chats: %s, verify-code gate: %s)",
                        bot._chat_ids,
                        bot._open_registration,
                    )
                t0 = time.monotonic()
                bot.poll_once()
                now = time.monotonic()
                if now - last_alert_ts >= alert_interval:
                    bot.send_alerts()
                    last_alert_ts = now
                if now - t0 < 2.0:
                    time.sleep(2.0)
            except Exception:
                logger.exception("Telegram MetricsBot loop error, retrying in 5s")
                time.sleep(5.0)

    threading.Thread(target=_bot_loop, name="netops-telegram-bot", daemon=True).start()


def main() -> None:
    init_local_environment()
    settings = get_settings()
    engine = build_engine(settings.database_url)
    session_factory = build_session_factory(engine)

    def _create_runner() -> JobRunner:
        toolchain = build_toolchain(settings)
        return JobRunner(session_factory, lambda: toolchain)

    dispatcher = ThreadedJobDispatcher(_create_runner)
    app = create_app(settings, engine=engine, dispatcher=dispatcher)

    if "--no-beat" not in sys.argv:
        _start_beat(settings, session_factory, dispatcher)

    host = os.environ.get("NETOPS_HOST", "0.0.0.0")
    port = int(os.environ.get("NETOPS_PORT", "8001"))
    logger.info("Starting local NetOps API server on http://%s:%s ...", host, port)
    uvicorn.run(app, host=host, port=port, log_level="info")


if __name__ == "__main__":
    main()
