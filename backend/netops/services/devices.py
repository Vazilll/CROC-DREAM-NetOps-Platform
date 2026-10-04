from __future__ import annotations

from collections.abc import Sequence
from typing import Any, Literal

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from netops.enums import DeviceRole, DeviceStatus, Platform
from netops.errors import ConflictError, NotFoundError
from netops.intent.models import Inventory
from netops.models import Device
from netops.models.drift import DriftRecord
from netops.schemas.devices import DeviceCreate, DeviceUpdate, InventorySyncResult
from netops.services.telemetry import metric_series

_INVENTORY_FIELDS = ("management_ip", "management_port", "platform", "role", "auth_profile")


class DeviceService:
    def __init__(self, session: Session) -> None:
        self._session = session

    def list_devices(
        self,
        *,
        status: DeviceStatus | None = None,
        role: DeviceRole | None = None,
        platform: Platform | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> Sequence[Device]:
        query = select(Device).order_by(Device.hostname).limit(limit).offset(offset)
        if status is not None:
            query = query.where(Device.status == status)
        if role is not None:
            query = query.where(Device.role == role)
        if platform is not None:
            query = query.where(Device.platform == platform)
        devices = self._session.scalars(query).all()

        device_ids = [d.id for d in devices]
        drifts: dict[int, DriftRecord] = {}
        if device_ids:
            drift_query = (
                select(DriftRecord)
                .where(DriftRecord.device_id.in_(device_ids))
                .order_by(DriftRecord.device_id, DriftRecord.checked_at.desc())
            )
            for record in self._session.scalars(drift_query):
                if record.device_id not in drifts:
                    drifts[record.device_id] = record

        for device in devices:
            self._enrich_device(device, drifts.get(device.id))
        return devices

    def get(self, device_id: int) -> Device:
        device = self._session.get(Device, device_id)
        if device is None:
            raise NotFoundError(f"Device {device_id} not found")
        latest_drift = self._session.scalars(
            select(DriftRecord)
            .where(DriftRecord.device_id == device.id)
            .order_by(DriftRecord.checked_at.desc())
            .limit(1)
        ).first()
        self._enrich_device(device, latest_drift)
        return device

    def _enrich_device(self, device: Device, latest_drift: DriftRecord | None = None) -> Device:
        role_str = str(device.role.value if hasattr(device.role, "value") else device.role)
        sparkline = metric_series(device.hostname, role_str, "uplink_util_pct", points=24)
        oper_status = self._derive_oper_status(device, sparkline, latest_drift)
        state_timeline = self._build_state_timeline(oper_status, sparkline)
        device.oper_status = oper_status
        device.sparkline = sparkline
        device.state_timeline = state_timeline
        return device

    def _derive_oper_status(
        self,
        device: Device,
        sparkline: list[float],
        latest_drift: DriftRecord | None = None,
    ) -> Literal["UP", "DOWN", "DEGRADED"]:
        if device.status == DeviceStatus.UNREACHABLE:
            return "DOWN"
        if latest_drift:
            has_shutdown = any(
                "shutdown" in line.lower() and "no shutdown" not in line.lower()
                for line in (latest_drift.unauthorized_lines or [])
            ) or any(
                "no shutdown" in line.lower()
                for line in (latest_drift.missing_lines or [])
            )
            if has_shutdown:
                return "DEGRADED"
        if sparkline and sparkline[-1] >= 85.0:
            return "DEGRADED"
        return "UP"

    def _build_state_timeline(
        self,
        oper_status: str,
        sparkline: list[float],
    ) -> list[str]:
        timeline: list[str] = []
        for i in range(24):
            val = sparkline[i] if i < len(sparkline) else 0.0
            if oper_status == "DOWN" and i >= 20:
                timeline.append("DOWN")
            elif val >= 85.0 or (oper_status == "DEGRADED" and i >= 20):
                timeline.append("DEGRADED")
            else:
                timeline.append("UP")
        return timeline

    def create(self, data: DeviceCreate) -> Device:
        device = Device(**_column_values(data.model_dump()))
        self._session.add(device)
        self._commit(f"Device {device.hostname}")
        return device

    def update(self, device_id: int, data: DeviceUpdate) -> Device:
        device = self.get(device_id)
        if device.status is DeviceStatus.IN_PROGRESS:
            raise ConflictError(f"Device {device.hostname} is being deployed; try again later")
        for field, value in _column_values(data.model_dump(exclude_unset=True)).items():
            setattr(device, field, value)
        self._commit(f"Device {device.hostname}")
        return device

    def delete(self, device_id: int) -> None:
        device = self.get(device_id)
        if device.status is DeviceStatus.IN_PROGRESS:
            raise ConflictError(f"Device {device.hostname} is being deployed; try again later")
        self._session.delete(device)
        self._session.commit()

    def sync_inventory(self, inventory: Inventory) -> InventorySyncResult:
        existing = {device.hostname: device for device in self._session.scalars(select(Device))}
        result = InventorySyncResult()
        for spec in inventory.devices:
            values = _column_values(spec.model_dump(include={"hostname", *_INVENTORY_FIELDS}))
            device = existing.get(spec.hostname)
            if device is None:
                self._session.add(Device(**values))
                result.created.append(spec.hostname)
                continue
            changed = False
            for field in _INVENTORY_FIELDS:
                if getattr(device, field) != values[field]:
                    setattr(device, field, values[field])
                    changed = True
            (result.updated if changed else result.unchanged).append(spec.hostname)
        self._commit("Inventory")
        return result

    def _commit(self, subject: str) -> None:
        try:
            self._session.commit()
        except IntegrityError as exc:
            self._session.rollback()
            raise ConflictError(
                f"{subject} conflicts with an existing device (hostname or management endpoint)"
            ) from exc


def _column_values(values: dict[str, Any]) -> dict[str, Any]:
    if "management_ip" in values:
        values["management_ip"] = str(values["management_ip"])
    return values
