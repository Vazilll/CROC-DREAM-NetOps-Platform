"""Скрипт локального сброса и очистки лабораторного окружения NetOps.

Сбрасывает базу данных SQLite до чистого состояния (empty state),
очищает аудит-логи и события хаос-инъекций, и восстанавливает чистые
базовые конфигурации устройств в lab/running/.

Учетные данные по умолчанию: admin / admin (по согласованию с Тимофеем,
в дальнейшем подлежат плановой ротации).
"""

from __future__ import annotations

import argparse
import json
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

    # 1. Reset SQLite Database
    if db_file.exists():
        logger.info("Удаление существующей локальной базы: %s", db_file.name)
        try:
            db_file.unlink()
        except Exception as e:
            logger.warning("Не удалось удалить файл БД напрямую (%s), очищаем через drop_all", e)

    engine = build_engine(f"sqlite:///{db_file}")
    logger.info("Инициализация чистой схемы БД (Alembic Base.metadata)...")
    Base.metadata.create_all(engine)
    session_factory = build_session_factory(engine)

    # 2. Reset Chaos Events & Emergency Audit Logs
    chaos_file = lab_dir / "chaos_events.json"
    if chaos_file.exists():
        logger.info("Очистка chaos_events.json...")
        chaos_file.write_text("[]\n", encoding="utf-8")

    audit_file = lab_dir / "emergency_audit.jsonl"
    if audit_file.exists():
        logger.info("Очистка emergency_audit.jsonl...")
        audit_file.write_text("", encoding="utf-8")

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
            logger.info("  [OK] Vosstanovlen baseline config: %s", cfg_file.name)

        # 4. Optional Pre-seeding
        if seed:
            logger.info("Flag --seed active: import 6 devices into SQLite inventory...")
            with session_factory() as session:
                svc = DeviceService(session)
                res = svc.sync_inventory(snapshot.inventory)
                logger.info("Imported devices: %s", len(res.created))
        else:
            logger.info("Clean start (Empty-State): database is empty, ready for first structure onboarding.")

    except Exception as exc:
        logger.error("Error generating configs: %s", exc)

    print("=================================================================")
    print("  [OK] Sbros okruzheniya uspeshno zavershen!")
    print(f"  [OK] Database: {db_file} (clean schema)")
    print(f"  [OK] Default credentials: admin / admin")
    print(f"  [OK] Configs in {lab_dir} synchronized with baseline.")
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
