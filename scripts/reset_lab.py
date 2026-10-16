"""Скрипт локального сброса и очистки лабораторного окружения NetOps.

Сбрасывает базу данных SQLite до чистого состояния (empty state),
очищает аудит-логи и события хаос-инъекций, и восстанавливает чистые
базовые конфигурации устройств в lab/running/.

Учетные данные по умолчанию: admin / admin (по согласованию с Тимофеем,
в дальнейшем подлежат плановой ротации).
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
BACKEND_DIR = PROJECT_ROOT / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from netops.db import Base, build_engine, build_session_factory
from netops.intent.repository import IntentRepository
from netops.network.rendering import JinjaConfigRenderer
from netops.services import DeviceService
from netops.settings import get_settings

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("reset_lab")


def reset_environment(seed: bool = False) -> None:
    db_file = BACKEND_DIR / "netops_local.db"
    lab_dir = PROJECT_ROOT / "lab" / "running"
    lab_dir.mkdir(parents=True, exist_ok=True)

    print("=================================================================")
    print("      CROC DREAM NetOps Platform — Lab Environment Reset Tool     ")
    print("=================================================================")

    # 1. Reset SQLite Database (if present) and PostgreSQL Database
    if db_file.exists():
        logger.info("Удаление существующей локальной базы SQLite: %s", db_file.name)
        try:
            db_file.unlink()
        except Exception as e:
            logger.warning("Не удалось удалить файл БД напрямую (%s)", e)

    settings = get_settings()
    target_urls = [f"sqlite:///{db_file}"]
    if "postgresql" in settings.database_url:
        target_urls.append(settings.database_url)
    else:
        target_urls.append("postgresql+psycopg://netops:netops@127.0.0.1:5432/netops")

    session_factory = None
    for url in dict.fromkeys(target_urls):
        try:
            engine = build_engine(url)
            logger.info("Очистка и пересоздание схемы БД: %s", url)
            Base.metadata.drop_all(engine)
            Base.metadata.create_all(engine)
            if "postgresql" in url or session_factory is None:
                session_factory = build_session_factory(engine)
        except Exception as exc:
            logger.warning("Пропуск БД %s: %s", url, exc)

    # 2. Reset Runtime Overlay, User Tokens, Access Registry, Chaos & Audit files
    for fname, empty_val in [
        ("chaos_events.json", "[]\n"),
        ("emergency_audit.jsonl", ""),
        ("runtime_settings.json", "{}\n"),
        ("user_tokens.json", "{}\n"),
        ("access_registry.json", "{}\n"),
        ("telegram_bindings.json", "{}\n"),
        ("telegram_subscribers.json", "[]\n"),
        ("telemetry_cache.json", "{}\n"),
        ("custom_auth_profiles.json", "{}\n"),
    ]:
        fpath = lab_dir / fname
        fpath.write_text(empty_val, encoding="utf-8")

    for b_fname, empty_val in [
        ("user_tokens.json", "{}\n"),
        ("telemetry_cache.json", "{}\n"),
    ]:
        bfpath = BACKEND_DIR / b_fname
        if bfpath.exists():
            bfpath.write_text(empty_val, encoding="utf-8")

    # 3. Restore Clean Baseline Device Configs (admin / admin)
    intent_repo = IntentRepository(PROJECT_ROOT / "intent", inventory_file="inventory.yaml")
    renderer = JinjaConfigRenderer(PROJECT_ROOT / "templates")
    try:
        snapshot = intent_repo.load()
        for dev in snapshot.inventory.devices:
            cfg_file = lab_dir / f"{dev.hostname}.cfg"
            intent = snapshot.intent_for(dev.hostname)
            cfg = renderer.render(dev, intent)
            cfg_file.write_text(cfg, encoding="utf-8")
            logger.info("  [OK] Восстановлен baseline config: %s", cfg_file.name)

        # 4. Optional Pre-seeding
        if seed and session_factory is not None:
            logger.info("Flag --seed active: import devices into inventory...")
            with session_factory() as session:
                svc = DeviceService(session)
                res = svc.sync_inventory(snapshot.inventory)
                logger.info("Imported devices: %s", len(res.created))
        else:
            logger.info("Clean start (Zero-State): database is empty, ready for Matryoshka Wizard onboarding.")

    except Exception as exc:
        logger.error("Error generating configs: %s", exc)

    print("=================================================================")
    print("  [OK] Сброс окружения (PostgreSQL + SQLite + JSON) завершён!")
    print("=================================================================")



def main() -> None:
    parser = argparse.ArgumentParser(description="Сброс и очистка локального окружения NetOps")
    parser.add_argument(
        "--seed",
        action="store_true",
        help="Сразу предзаполнить 6 эталонных устройств в инвентарь (по умолчанию: оставить пустым)",
    )
    args = parser.parse_args()
    reset_environment(seed=args.seed)


if __name__ == "__main__":
    main()
