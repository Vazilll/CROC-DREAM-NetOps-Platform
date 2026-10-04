"""Verification script for the 6-node Containerlab bare metal environment.

Connects to all 6 nodes (2 Arista cEOS, 2 Cisco C8000V, 2 Huawei VRP) on the
live server via ScrapliNetworkDriver and verifies health and running-config retrieval.
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

# Add backend directory to sys.path if not installed
BACKEND_DIR = Path(__file__).resolve().parent.parent / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from netops.intent.repository import IntentRepository
from netops.network.base import Credentials, DeviceTarget
from netops.network.scrapli_driver import ScrapliNetworkDriver


def main() -> int:
    repo_root = Path(__file__).resolve().parent.parent / "intent"
    inventory_file = "inventory.live.yaml"

    print("=================================================================")
    print("  CROC DREAM NetOps Platform — Live 6-Node Lab Verification Tool  ")
    print("=================================================================")
    print(f"Loading inventory from: {repo_root / inventory_file}")

    repo = IntentRepository(repo_root, inventory_file=inventory_file)
    try:
        snapshot = repo.load()
    except Exception as exc:
        print(f"[FATAL] Failed to load inventory: {exc}")
        return 1

    devices = snapshot.inventory.devices
    print(f"Discovered {len(devices)} devices in inventory.")
    print("Target server: 5.228.243.54 (ports 2211..2232)\n")

    creds = Credentials(username="admin", password="admin")
    targets = [
        DeviceTarget(
            hostname=d.hostname,
            platform=d.platform,
            host=str(d.management_ip),
            port=d.management_port,
            credentials=creds,
        )
        for d in devices
    ]

    driver = ScrapliNetworkDriver(max_workers=6, timeout_socket=15)

    print("Connecting to all 6 nodes concurrently...")
    start_time = time.time()
    results = driver.fetch_running_configs(targets)
    elapsed = time.time() - start_time

    success_count = 0
    print("\n--- Live Nodes Connection Report ---")
    print(f"{'Hostname':<20} | {'Platform':<15} | {'Port':<6} | {'Status':<10} | {'Config Size'}")
    print("-" * 75)

    for target in targets:
        result = results.get(target.hostname)
        if result and result.config:
            success_count += 1
            lines = len(result.config.splitlines())
            status = "UP / OK"
            size_info = f"{lines} lines ({len(result.config)} bytes)"
        else:
            status = "FAILED"
            size_info = (result.error if result else "No response")[:35]

        print(f"{target.hostname:<20} | {target.platform.value:<15} | {target.port:<6} | {status:<10} | {size_info}")

    print("-" * 75)
    print(f"Summary: {success_count}/{len(targets)} nodes accessible in {elapsed:.2f}s.\n")

    if success_count == len(targets):
        print("[SUCCESS] All 6 Bare Metal lab nodes are operational and connected to NetOps!")
        return 0
    else:
        print("[WARN] Some nodes failed to respond. Review logs and container status.")
        return 1


if __name__ == "__main__":
    sys.exit(main())
