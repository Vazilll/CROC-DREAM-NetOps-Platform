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

is_offline = "--offline" in sys.argv or os.environ.get("NETOPS_OFFLINE", "0") == "1"
is_live = not is_offline
default_driver = "scrapli" if is_live else "offline"
default_inventory = "inventory.live.yaml" if is_live else "inventory.yaml"

# Default environment variables for standalone local run
os.environ.setdefault("NETOPS_DATABASE_URL", f"sqlite:///{BACKEND_DIR / 'netops_local.db'}")
os.environ.setdefault("NETOPS_INTENT_REPO_PATH", str(PROJECT_ROOT / "intent"))
os.environ.setdefault("NETOPS_INVENTORY_FILE", default_inventory)
os.environ.setdefault("NETOPS_TEMPLATES_PATH", str(PROJECT_ROOT / "templates"))
os.environ.setdefault("NETOPS_OFFLINE_LAB_PATH", str(PROJECT_ROOT / "lab" / "running"))
os.environ.setdefault("NETOPS_NETWORK_DRIVER", default_driver)
os.environ.setdefault("NETOPS_DRIFT_SCAN_INTERVAL_SECONDS", "120")

os.environ.setdefault("NETOPS_CORS_ORIGINS", '["*"]')
os.environ.setdefault(
    "NETOPS_API_TOKENS",
    '{"dev-owner-token": {"username": "owner", "role": "owner"}, "dev-admin-token": {"username": "admin", "role": "admin"}, "dev-operator-token": {"username": "operator", "role": "operator"}, "dev-viewer-token": {"username": "viewer", "role": "viewer"}}',
)
os.environ.setdefault(
    "NETOPS_AUTH_PROFILES",
    '{"lab": {"username": "admin", "password": "admin"}}',
)

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

    # Continuous GitOps: Reconcile inventory on boot from Git repository
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

    # Ensure initial running .cfg files exist for each device
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
    import threading  # noqa: PLC0415
    import time  # noqa: PLC0415
    from datetime import timedelta  # noqa: PLC0415

    from netops.pipeline import fail_stale_jobs  # noqa: PLC0415
    from netops.services import JobService  # noqa: PLC0415

    first_delay = int(os.environ.get("NETOPS_BEAT_FIRST_DELAY_SECONDS", "15"))

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
        except Exception:
            logger.exception("Beat: startup cleanup failed")
        time.sleep(first_delay)
        while True:
            try:
                _cleanup(timedelta(seconds=settings.job_timeout_seconds))
                with session_factory() as session:
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

    logger.info("Starting local NetOps API server on http://127.0.0.1:8000 ...")
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="info")


if __name__ == "__main__":
    main()
