"""Transactional deployment: health checks, rollback and failure handling."""

from __future__ import annotations

import uuid
from collections.abc import Iterator, Sequence
from pathlib import Path

import pytest
from sqlalchemy.orm import Session

from netops.enums import DeviceStatus, IntentSource, JobStatus, TargetStatus
from netops.models import Device, Job
from netops.network import (
    BgpSessionState,
    ChangePlan,
    DeviceTarget,
    HealthSnapshot,
    InterfaceState,
    OfflineLab,
)
from netops.services import JobService
from tests.conftest import RunJob
from tests.integration.helpers import append_to_running_config, change_uplink_description

HEALTHY = HealthSnapshot(
    bgp_sessions={"10.0.1.0": BgpSessionState("Established", 5)},
    interfaces={"GigabitEthernet2": InterfaceState("up", "up")},
    ping_loss_percent={"10.0.1.0": 0.0},
)
BGP_DOWN = HealthSnapshot(
    bgp_sessions={"10.0.1.0": BgpSessionState("Idle")},
    interfaces={"GigabitEthernet2": InterfaceState("up", "up")},
)


class ScriptedProbe:
    """Returns the given snapshots in order; an exception instance is raised instead."""

    def __init__(self, *results: HealthSnapshot | Exception) -> None:
        self._results: Iterator[HealthSnapshot | Exception] = iter(results)
        self.calls = 0

    def snapshot(self, target: DeviceTarget) -> HealthSnapshot:
        self.calls += 1
        result = next(self._results, HEALTHY)
        if isinstance(result, Exception):
            raise result
        return result


class FaultyLab(OfflineLab):
    """The offline lab with injectable failures of individual operations."""

    def __init__(self, root: Path, *, fail_on: Sequence[str] = ()) -> None:
        super().__init__(root)
        self.fail_on = set(fail_on)
        self.calls: list[str] = []

    def apply(self, target: DeviceTarget, plan: ChangePlan, *, confirm_timeout: int) -> None:
        self._call("apply")
        super().apply(target, plan, confirm_timeout=confirm_timeout)

    def confirm(self, target: DeviceTarget) -> None:
        self._call("confirm")
        super().confirm(target)

    def rollback(self, target: DeviceTarget, plan: ChangePlan) -> None:
        self._call("rollback")
        super().rollback(target, plan)

    def _call(self, operation: str) -> None:
        self.calls.append(operation)
        if operation in self.fail_on:
            raise RuntimeError(f"{operation} exploded")


@pytest.fixture
def approved_dry_run(
    devices: dict[str, Device], intent_repo: Path, job_service: JobService, run_job: RunJob
) -> Job:
    """A successful dry-run that changes both leaves."""
    change_uplink_description(intent_repo, "leaf-1.croc.lab", "Uplink to spine-1 (400G)")
    change_uplink_description(intent_repo, "leaf-2.croc.lab", "Uplink to spine-1 (400G)")
    job = job_service.create_dry_run(
        [devices["leaf-1.croc.lab"].id, devices["leaf-2.croc.lab"].id],
        IntentSource.GIT_MAIN,
        requested_by="tester",
    )
    assert run_job(job.id) is JobStatus.SUCCESS
    return job


def _deploy(job_service: JobService, dry_run: Job) -> uuid.UUID:
    return job_service.create_deploy(dry_run.id, confirmed_by="duty", requested_by="tester").id


def _outcome(session: Session, job_id: uuid.UUID) -> dict[str, tuple[TargetStatus, str | None]]:
    job = session.get_one(Job, job_id)
    return {target.hostname: (target.status, target.error) for target in job.targets}


def _status(session: Session, device: Device) -> DeviceStatus:
    return session.get_one(Device, device.id).status


def test_post_check_failure_rolls_back_and_stops_the_rollout(
    approved_dry_run: Job,
    job_service: JobService,
    run_job: RunJob,
    session: Session,
    lab_path: Path,
    devices: dict[str, Device],
) -> None:
    lab = FaultyLab(lab_path)
    before = (lab_path / "leaf-1.croc.lab.cfg").read_text()
    deploy_id = _deploy(job_service, approved_dry_run)

    status = run_job(deploy_id, deployer=lab, health_probe=ScriptedProbe(HEALTHY, BGP_DOWN))

    assert status is JobStatus.FAILED
    outcome = _outcome(session, deploy_id)
    assert outcome["leaf-1.croc.lab"][0] is TargetStatus.ROLLED_BACK
    assert "10.0.1.0 went from Established to Idle" in (outcome["leaf-1.croc.lab"][1] or "")
    assert outcome["leaf-2.croc.lab"] == (
        TargetStatus.SKIPPED,
        "Rollout stopped after the failure on leaf-1.croc.lab",
    )
    assert lab.calls == ["apply", "rollback"]
    assert (lab_path / "leaf-1.croc.lab.cfg").read_text() == before
    # The device returns to the status it had before the deployment.
    assert _status(session, devices["leaf-1.croc.lab"]) is DeviceStatus.UNKNOWN
    job = session.get_one(Job, deploy_id)
    assert job.error == "1 of 2 device(s) failed: leaf-1.croc.lab"
    assert job.progress < 100


def test_unreachable_post_check_is_treated_as_unhealthy(
    approved_dry_run: Job,
    job_service: JobService,
    run_job: RunJob,
    session: Session,
    lab_path: Path,
) -> None:
    lab = FaultyLab(lab_path)
    deploy_id = _deploy(job_service, approved_dry_run)
    probe = ScriptedProbe(HEALTHY, ConnectionError("ssh timeout"))

    assert run_job(deploy_id, deployer=lab, health_probe=probe) is JobStatus.FAILED
    status, error = _outcome(session, deploy_id)["leaf-1.croc.lab"]
    assert status is TargetStatus.ROLLED_BACK
    assert "Post-check could not run: ssh timeout" in (error or "")


def test_failed_rollback_requires_manual_intervention(
    approved_dry_run: Job,
    job_service: JobService,
    run_job: RunJob,
    session: Session,
    lab_path: Path,
    devices: dict[str, Device],
) -> None:
    lab = FaultyLab(lab_path, fail_on=["rollback"])
    deploy_id = _deploy(job_service, approved_dry_run)

    run_job(deploy_id, deployer=lab, health_probe=ScriptedProbe(HEALTHY, BGP_DOWN))

    status, error = _outcome(session, deploy_id)["leaf-1.croc.lab"]
    assert status is TargetStatus.FAILED
    assert error == "Post-check failed and rollback failed; manual intervention required"
    assert _status(session, devices["leaf-1.croc.lab"]) is DeviceStatus.UNKNOWN


def test_apply_failure_triggers_rollback(
    approved_dry_run: Job,
    job_service: JobService,
    run_job: RunJob,
    session: Session,
    lab_path: Path,
    devices: dict[str, Device],
) -> None:
    lab = FaultyLab(lab_path, fail_on=["apply"])
    deploy_id = _deploy(job_service, approved_dry_run)

    assert run_job(deploy_id, deployer=lab) is JobStatus.FAILED
    assert _outcome(session, deploy_id)["leaf-1.croc.lab"] == (
        TargetStatus.FAILED,
        "Apply failed: apply exploded",
    )
    assert lab.calls == ["apply", "rollback"]
    assert _status(session, devices["leaf-1.croc.lab"]) is DeviceStatus.UNKNOWN


def test_pre_check_failure_does_not_touch_the_device(
    approved_dry_run: Job,
    job_service: JobService,
    run_job: RunJob,
    session: Session,
    lab_path: Path,
) -> None:
    lab = FaultyLab(lab_path)
    deploy_id = _deploy(job_service, approved_dry_run)

    run_job(deploy_id, deployer=lab, health_probe=ScriptedProbe(ConnectionError("no route")))

    assert _outcome(session, deploy_id)["leaf-1.croc.lab"] == (
        TargetStatus.FAILED,
        "Pre-check failed: no route",
    )
    assert lab.calls == []


def test_confirm_failure_leaves_the_device_to_its_timer(
    approved_dry_run: Job,
    job_service: JobService,
    run_job: RunJob,
    session: Session,
    lab_path: Path,
    devices: dict[str, Device],
) -> None:
    lab = FaultyLab(lab_path, fail_on=["confirm"])
    deploy_id = _deploy(job_service, approved_dry_run)

    assert run_job(deploy_id, deployer=lab) is JobStatus.FAILED
    status, error = _outcome(session, deploy_id)["leaf-1.croc.lab"]
    assert status is TargetStatus.FAILED
    assert "reverts when the timer expires" in (error or "")
    assert _status(session, devices["leaf-1.croc.lab"]) is DeviceStatus.UNKNOWN


def test_running_config_changed_since_dry_run(
    approved_dry_run: Job,
    job_service: JobService,
    run_job: RunJob,
    session: Session,
    lab_path: Path,
) -> None:
    append_to_running_config(lab_path, "leaf-1.croc.lab", "ip domain lookup\n")
    lab = FaultyLab(lab_path)
    deploy_id = _deploy(job_service, approved_dry_run)

    assert run_job(deploy_id, deployer=lab) is JobStatus.FAILED
    assert _outcome(session, deploy_id)["leaf-1.croc.lab"] == (
        TargetStatus.FAILED,
        "Running-config changed since the dry-run; run a new dry-run",
    )
    assert lab.calls == []


def test_successful_rollout_of_several_devices(
    approved_dry_run: Job,
    job_service: JobService,
    run_job: RunJob,
    session: Session,
    lab_path: Path,
    devices: dict[str, Device],
) -> None:
    lab = FaultyLab(lab_path)
    deploy_id = _deploy(job_service, approved_dry_run)

    assert run_job(deploy_id, deployer=lab) is JobStatus.SUCCESS
    assert lab.calls == ["apply", "confirm", "apply", "confirm"]
    for hostname in ("leaf-1.croc.lab", "leaf-2.croc.lab"):
        assert _outcome(session, deploy_id)[hostname] == (TargetStatus.SUCCESS, None)
        assert _status(session, devices[hostname]) is DeviceStatus.IN_SYNC
        assert "(400G)" in (lab_path / f"{hostname}.cfg").read_text()


def test_device_deleted_after_approval(
    approved_dry_run: Job,
    job_service: JobService,
    run_job: RunJob,
    session: Session,
    devices: dict[str, Device],
) -> None:
    deploy_id = _deploy(job_service, approved_dry_run)
    session.delete(session.get_one(Device, devices["leaf-1.croc.lab"].id))
    session.commit()

    assert run_job(deploy_id) is JobStatus.FAILED
    assert _outcome(session, deploy_id)["leaf-1.croc.lab"] == (
        TargetStatus.FAILED,
        "Device was deleted",
    )


def test_auth_profile_removed_after_approval(
    approved_dry_run: Job, job_service: JobService, run_job: RunJob, session: Session
) -> None:
    deploy_id = _deploy(job_service, approved_dry_run)
    assert run_job(deploy_id, credentials={}) is JobStatus.FAILED
    assert _outcome(session, deploy_id)["leaf-1.croc.lab"] == (
        TargetStatus.FAILED,
        "Auth profile 'lab' is not configured",
    )


def test_incomplete_dry_run_results(
    approved_dry_run: Job, job_service: JobService, run_job: RunJob, session: Session
) -> None:
    deploy_id = _deploy(job_service, approved_dry_run)
    for target in session.get_one(Job, deploy_id).targets:
        target.running_snapshot_id = None
    session.commit()

    assert run_job(deploy_id) is JobStatus.FAILED
    assert _outcome(session, deploy_id)["leaf-1.croc.lab"] == (
        TargetStatus.FAILED,
        "Dry-run results are incomplete; run a new dry-run",
    )


class TestRemediationFailures:
    @pytest.fixture
    def drifted(
        self,
        devices: dict[str, Device],
        lab_path: Path,
        job_service: JobService,
        run_job: RunJob,
        session: Session,
    ) -> Device:
        append_to_running_config(lab_path, "leaf-2.croc.lab", "ip domain lookup\n")
        run_job(job_service.create_drift_scan(None, requested_by="tester").id)
        device = session.get_one(Device, devices["leaf-2.croc.lab"].id)
        assert device.status is DeviceStatus.DRIFT_DETECTED
        return device

    def test_device_became_unreachable(
        self,
        drifted: Device,
        job_service: JobService,
        run_job: RunJob,
        session: Session,
        lab_path: Path,
    ) -> None:
        job = job_service.create_drift_remediation(drifted.id, requested_by="tester")
        (lab_path / "leaf-2.croc.lab.cfg").unlink()

        assert run_job(job.id) is JobStatus.FAILED
        assert _status(session, drifted) is DeviceStatus.UNREACHABLE
        status, error = _outcome(session, job.id)["leaf-2.croc.lab"]
        assert status is TargetStatus.FAILED
        assert "unreachable" in (error or "")

    def test_device_deleted(
        self, drifted: Device, job_service: JobService, run_job: RunJob, session: Session
    ) -> None:
        job = job_service.create_drift_remediation(drifted.id, requested_by="tester")
        session.delete(drifted)
        session.commit()

        assert run_job(job.id) is JobStatus.FAILED
        assert session.get_one(Job, job.id).error == "The device to remediate no longer exists"

    def test_unhealthy_remediation_is_rolled_back(
        self,
        drifted: Device,
        job_service: JobService,
        run_job: RunJob,
        session: Session,
        lab_path: Path,
    ) -> None:
        job = job_service.create_drift_remediation(drifted.id, requested_by="tester")
        lab = FaultyLab(lab_path)

        status = run_job(job.id, deployer=lab, health_probe=ScriptedProbe(HEALTHY, BGP_DOWN))

        assert status is JobStatus.FAILED
        assert lab.calls == ["apply", "rollback"]
        assert _outcome(session, job.id)["leaf-2.croc.lab"][0] is TargetStatus.ROLLED_BACK
        # Still drifted: the rollback restored the unauthorized configuration.
        assert _status(session, drifted) is DeviceStatus.DRIFT_DETECTED
