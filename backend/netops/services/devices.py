"""Device inventory management."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from netops.enums import DeviceRole, DeviceStatus, Platform
from netops.errors import ConflictError, NotFoundError
from netops.intent.models import Inventory
from netops.models import Device
from netops.schemas.devices import DeviceCreate, DeviceUpdate, InventorySyncResult

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
        return self._session.scalars(query).all()

    def get(self, device_id: int) -> Device:
        device = self._session.get(Device, device_id)
        if device is None:
            raise NotFoundError(f"Device {device_id} not found")
        return device

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
        """Upsert devices from the Git inventory, matching them by hostname.

        Devices missing from the inventory are kept: removing a device is an
        explicit administrative action.
        """
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
