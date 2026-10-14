"""Verification script for the Containerlab bare metal environment.

Connects to all nodes (Cisco C8000V, Arista cEOS, Huawei CE12800) on the
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

AUTH_PROFILES_DEFAULT: dict[str, Credentials] = {
    "spine1_auth": Credentials(username="admin", password="F5ga6jfkig1"),
    "spine2_auth": Credentials(username="admin", password="F5ga6jfkig2"),
    "leaf1_auth": Credentials(username="admin", password="F5ga6jfkig"),
    "leaf2_auth": Credentials(username="admin", password="F5ga6jfkig2"),
    "lab": Credentials(username="admin", password="admin"),
}


def main() -> int:
    repo_root = Path(__file__).resolve().parent.parent / "intent"
    inventory_file = "inventory.live.yaml"

    print("=================================================================")
    print("  CROC DREAM NetOps Platform — Live Bare Metal Lab Verification  ")
    print("=================================================================")
    print(f"Loading inventory from: {repo_root / inventory_file}")

    repo = IntentRepository(repo_root, inventory_file=inventory_file)
    try:
        inventory = repo.load_inventory()
    except Exception as exc:
        print(f"[FATAL] Failed to load inventory: {exc}")
        return 1

    devices = inventory.devices
    print(f"Discovered {len(devices)} devices in inventory.")
    print("Target server: 5.228.243.54\n")

    targets = [
        DeviceTarget(
            hostname=d.hostname,
            platform=d.platform,
            host=str(d.management_ip),
            port=d.management_port,
            credentials=AUTH_PROFILES_DEFAULT.get(
                d.auth_profile, Credentials(username="admin", password="admin")
            ),
        )
        for d in devices
    ]

    driver = ScrapliNetworkDriver(max_workers=len(targets), timeout_socket=15)

    print(f"Connecting to all {len(targets)} nodes concurrently...")
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

        print(
            f"{target.hostname:<20} | {target.platform.value:<15} | {target.port:<6} | {status:<10} | {size_info}"
        )

    print("-" * 75)
    print(f"Summary: {success_count}/{len(targets)} nodes accessible in {elapsed:.2f}s.\n")

    if success_count == len(targets):
        print("[SUCCESS] All Bare Metal lab nodes are operational and connected to NetOps!")
        return 0
    else:
        print("[WARN] Some nodes failed to respond. Review logs and container status.")
        return 1


if __name__ == "__main__":
    sys.exit(main())
