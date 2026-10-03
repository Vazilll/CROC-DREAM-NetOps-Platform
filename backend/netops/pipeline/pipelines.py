from __future__ import annotations

from datetime import datetime
from typing import Protocol

from sqlalchemy.orm import Session

from netops.db import utcnow
from netops.enums import DeviceStatus, DriftStatus, TargetStatus
from netops.errors import PipelineError
from netops.intent import InventoryDevice
from netops.models import Device, DriftRecord, Job, JobTarget
from netops.network.base import ChangePlan, HealthExpectations
from netops.pipeline.deployment import DeploymentExecutor
from netops.pipeline.planning import ChangePlanner, DevicePlan, load_intent, persist_plan
from netops.pipeline.recorder import JobRecorder
from netops.toolchain import Toolchain


class Pipeline(Protocol):
    def __init__(self, session: Session, toolchain: Toolchain, recorder: JobRecorder) -> None: ...

    def run(self, job: Job) -> None: ...


class _BasePipeline:
    def __init__(self, session: Session, toolchain: Toolchain, recorder: JobRecorder) -> None:
        self._session = session
        self._toolchain = toolchain
        self._recorder = recorder

    def _live_targets(self, job: Job) -> list[tuple[JobTarget, Device]]:
        live: list[tuple[JobTarget, Device]] = []
        for row in job.targets:
            if row.device is None:
                row.mark(TargetStatus.FAILED, "Device was deleted")
            else:
                live.append((row, row.device))
        return live

    def _plan(
        self, job: Job, pairs: list[tuple[JobTarget, Device]]
    ) -> list[tuple[JobTarget, DevicePlan]]:
        snapshot = load_intent(self._toolchain, self._recorder)
        plans = ChangePlanner(self._toolchain, self._recorder).plan(
            [device for _, device in pairs], snapshot
        )
        results = []
        for (row, _), plan in zip(pairs, plans, strict=True):
            persist_plan(self._session, job, row, plan)
            results.append((row, plan))
        self._session.commit()
        return results


class DryRunPipeline(_BasePipeline):
    def run(self, job: Job) -> None:
        for row, plan in self._plan(job, self._live_targets(job)):
            if plan.error is not None:
                row.mark(TargetStatus.FAILED, plan.error)
                if plan.unreachable:
                    plan.device.status = DeviceStatus.UNREACHABLE
            else:
                row.mark(TargetStatus.SUCCESS)
        self._session.commit()


# Устройства обновляем по одному; после первой ошибки раскатку останавливаем.
class DeployPipeline(_BasePipeline):
    def run(self, job: Job) -> None:
        executor = DeploymentExecutor(self._session, self._toolchain, self._recorder)
        failed_on: str | None = None
        total = len(job.targets)
        for index, row in enumerate(job.targets, start=1):
            if failed_on is not None:
                row.mark(TargetStatus.SKIPPED, f"Rollout stopped after the failure on {failed_on}")
                continue
            if not self._deploy_row(executor, row):
                failed_on = row.hostname
            self._recorder.progress(index, total)

    def _deploy_row(self, executor: DeploymentExecutor, row: JobTarget) -> bool:
        device = row.device
        if device is None:
            row.mark(TargetStatus.FAILED, "Device was deleted")
            return False
        if row.intended_snapshot is None or row.running_snapshot is None:
            row.mark(TargetStatus.FAILED, "Dry-run results are incomplete; run a new dry-run")
            return False
        try:
            target = self._toolchain.target_for(InventoryDevice.model_validate(device))
        except PipelineError as exc:
            row.mark(TargetStatus.FAILED, str(exc))
            return False
        plan = ChangePlan(
            remediation=row.remediation_config or "",
            rollback=row.rollback_config or "",
            intended=row.intended_snapshot.content,
        )
        expectations = (
            HealthExpectations.from_json(row.health_expectations)
            if row.health_expectations is not None
            else None
        )
        return executor.deploy(
            row,
            device,
            target,
            plan,
            expectations=expectations,
            expected_running_sha256=row.running_snapshot.sha256,
        )


class DriftScanPipeline(_BasePipeline):
    def run(self, job: Job) -> None:
        pairs = []
        for row, device in self._live_targets(job):
            if device.status is DeviceStatus.IN_PROGRESS:
                row.mark(TargetStatus.SKIPPED, "A deployment is in progress")
            else:
                pairs.append((row, device))

        checked_at = utcnow()
        for row, plan in self._plan(job, pairs):
            device = plan.device
            if plan.error is not None and not plan.unreachable:
                row.mark(TargetStatus.FAILED, plan.error)
                continue
            record = self._record(job, plan, checked_at)
            self._session.add(record)
            device.status = DeviceStatus(record.status.value)
            device.last_checked_at = checked_at
            if plan.unreachable:
                row.mark(TargetStatus.FAILED, plan.error)
            else:
                row.mark(TargetStatus.SUCCESS)
                if record.status is DriftStatus.DRIFT_DETECTED:
                    self._recorder.warning(
                        "drift", "Configuration drift detected", hostname=device.hostname
                    )
        self._session.commit()

    @staticmethod
    def _record(job: Job, plan: DevicePlan, checked_at: datetime) -> DriftRecord:
        if plan.diff is None:
            return DriftRecord(
                device_id=plan.device.id,
                job_id=job.id,
                status=DriftStatus.UNREACHABLE,
                checked_at=checked_at,
                error=plan.error,
            )
        diff = plan.diff
        return DriftRecord(
            device_id=plan.device.id,
            job_id=job.id,
            status=DriftStatus.IN_SYNC if diff.in_sync else DriftStatus.DRIFT_DETECTED,
            checked_at=checked_at,
            unauthorized_lines=list(diff.unauthorized_lines),
            missing_lines=list(diff.missing_lines),
            remediation_config=diff.remediation or None,
            rollback_config=diff.rollback or None,
        )


# Компенсирующий патч считаем заново от текущего running-config и катим через обычный
# транзакционный деплой.
class DriftRemediationPipeline(_BasePipeline):
    def run(self, job: Job) -> None:
        pairs = self._live_targets(job)
        if not pairs:
            raise PipelineError("The device to remediate no longer exists")
        [(row, plan)] = self._plan(job, pairs)

        device = plan.device
        if plan.error is not None:
            row.mark(TargetStatus.FAILED, plan.error)
            if plan.unreachable:
                device.status = DeviceStatus.UNREACHABLE
            return
        if plan.diff is None or not plan.diff.has_changes:
            row.mark(TargetStatus.SKIPPED, "Device already matches its golden config")
            device.status = DeviceStatus.IN_SYNC
            device.last_checked_at = utcnow()
            return
        if plan.target is None:
            raise PipelineError(f"{device.hostname}: no management target")
        executor = DeploymentExecutor(self._session, self._toolchain, self._recorder)
        executor.deploy(
            row, device, plan.target, plan.change_plan(), expectations=plan.expectations
        )
