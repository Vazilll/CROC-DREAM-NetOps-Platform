"""Transactional deployment: health checks, rollback and failure handling."""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from pathlib import Path

import pytest
import yaml
from sqlalchemy.orm import Session

from netops.enums import DeviceStatus, IntentSource, JobStatus, TargetStatus
from netops.models import Device, Job
from netops.network import (
    BgpSessionState,
    ChangePlan,
    DeviceTarget,
    HealthExpectations,
    HealthSnapshot,
    InterfaceState,
    OfflineLab,
)
from netops.services import JobService
from tests.conftest import RunJob
from tests.integration.helpers import append_to_running_config, change_uplink_description

# Both leaves of the fixture fabric: every declared peer Established, links up.
LEAF_PEERS = ("10.0.1.0", "10.0.1.2", "10.0.2.0", "10.0.2.2")
UP = InterfaceState("up", "up")
LINKS = {"Loopback0": UP, "GigabitEthernet2": UP, "GigabitEthernet3": UP}


def _fabric(**states: str) -> HealthSnapshot:
    """A leaf snapshot where peers are Established unless overridden by name."""
    sessions = {
        peer: BgpSessionState(states.get(peer.replace(".", "_"), "Established"), 5)
        for peer in LEAF_PEERS
    }
    return HealthSnapshot(
        bgp_sessions=sessions,
        interfaces=LINKS,
        ping_loss_percent=dict.fromkeys(LEAF_PEERS, 0.0),
    )


HEALTHY = _fabric()
BGP_DOWN = _fabric(**{"10_0_1_0": "Idle"})


class ScriptedProbe:
    """Returns the given results in order and then keeps repeating the last one.

    An exception instance is raised instead of being returned.
    """

    def __init__(self, *results: HealthSnapshot | Exception) -> None:
        self._results = list(results)
        self.expectations: list[HealthExpectations | None] = []

    def snapshot(self, target: DeviceTarget, expected: HealthExpectations | None) -> HealthSnapshot:
        self.expectations.append(expected)
        result = self._results.pop(0) if len(self._results) > 1 else self._results[0]
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
    assert outcome["leaf-1.croc.lab"][1] == (
        "Post-check failed: BGP peer 10.0.1.0 is Idle, expected Established"
    )
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

        leaf2_down = _fabric(**{"10_0_2_0": "Active"})
        status = run_job(job.id, deployer=lab, health_probe=ScriptedProbe(HEALTHY, leaf2_down))

        assert status is JobStatus.FAILED
        assert lab.calls == ["apply", "rollback"]
        assert _outcome(session, job.id)["leaf-2.croc.lab"][0] is TargetStatus.ROLLED_BACK
        # Still drifted: the rollback restored the unauthorized configuration.
        assert _status(session, drifted) is DeviceStatus.DRIFT_DETECTED


class TestPostCheckRules:
    """Spec 2.6: declared peers Established with prefixes, enabled ports up/up."""

    def test_bgp_is_given_time_to_converge(
        self, approved_dry_run: Job, job_service: JobService, run_job: RunJob, session: Session
    ) -> None:
        deploy_id = _deploy(job_service, approved_dry_run)
        probe = ScriptedProbe(HEALTHY, BGP_DOWN, BGP_DOWN, HEALTHY)

        assert run_job(deploy_id, health_probe=probe) is JobStatus.SUCCESS
        logs = [log.message for log in session.get_one(Job, deploy_id).logs]
        assert any(message.startswith("Attempt 1/6 failed") for message in logs)
        assert any(message.startswith("Attempt 2/6 failed") for message in logs)

    def test_rollback_after_the_last_attempt(
        self, approved_dry_run: Job, job_service: JobService, run_job: RunJob, session: Session
    ) -> None:
        deploy_id = _deploy(job_service, approved_dry_run)
        probe = ScriptedProbe(HEALTHY, BGP_DOWN)

        assert run_job(deploy_id, health_probe=probe, post_check_attempts=3) is JobStatus.FAILED
        # pre-check + 3 post-check attempts on leaf-1, then the rollout stops
        assert len(probe.expectations) == 4
        assert _outcome(session, deploy_id)["leaf-1.croc.lab"][0] is TargetStatus.ROLLED_BACK

    def test_expectations_come_from_the_dry_run_intent(
        self, approved_dry_run: Job, job_service: JobService, run_job: RunJob, session: Session
    ) -> None:
        dry_run_target = session.get_one(Job, approved_dry_run.id).targets[0]
        assert dry_run_target.health_expectations == {
            "bgp_peers": ["10.0.1.0", "10.0.1.2"],
            "interfaces": {
                "Loopback0": True,
                "GigabitEthernet2": True,
                "GigabitEthernet3": True,
                "GigabitEthernet4": False,
            },
        }
        deploy_id = _deploy(job_service, approved_dry_run)
        probe = ScriptedProbe(HEALTHY)

        run_job(deploy_id, health_probe=probe)
        assert probe.expectations[0] == HealthExpectations(
            bgp_peers=("10.0.1.0", "10.0.1.2"),
            interfaces=dry_run_target.health_expectations["interfaces"],
        )

    def test_new_peer_that_never_comes_up_is_rolled_back(
        self, approved_dry_run: Job, job_service: JobService, run_job: RunJob, session: Session
    ) -> None:
        """A regression check alone would miss this: the peer was never up."""
        without_second_spine = HealthSnapshot(
            bgp_sessions={"10.0.1.0": BgpSessionState("Established", 5)},
            interfaces=LINKS,
        )
        deploy_id = _deploy(job_service, approved_dry_run)

        run_job(deploy_id, health_probe=ScriptedProbe(without_second_spine))
        status, error = _outcome(session, deploy_id)["leaf-1.croc.lab"]
        assert status is TargetStatus.ROLLED_BACK
        assert "BGP peer 10.0.1.2 is not reported by the device" in (error or "")

    def test_peer_without_prefixes_is_a_failure(
        self, approved_dry_run: Job, job_service: JobService, run_job: RunJob, session: Session
    ) -> None:
        no_prefixes = HealthSnapshot(
            bgp_sessions={
                peer: BgpSessionState("Established", 0 if peer == "10.0.1.2" else 5)
                for peer in LEAF_PEERS
            },
            interfaces=LINKS,
        )
        deploy_id = _deploy(job_service, approved_dry_run)

        run_job(deploy_id, health_probe=ScriptedProbe(HEALTHY, no_prefixes))
        assert "BGP peer 10.0.1.2 accepts no prefixes" in (
            _outcome(session, deploy_id)["leaf-1.croc.lab"][1] or ""
        )

    def test_intentionally_removed_peer_is_not_a_failure(
        self,
        devices: dict[str, Device],
        intent_repo: Path,
        job_service: JobService,
        run_job: RunJob,
        session: Session,
    ) -> None:
        path = intent_repo / "devices" / "leaf-1.croc.lab.yaml"
        data = yaml.safe_load(path.read_text())
        data["bgp"]["neighbors"] = data["bgp"]["neighbors"][:1]  # decommission spine-2
        path.write_text(yaml.safe_dump(data))
        dry_run = job_service.create_dry_run(
            [devices["leaf-1.croc.lab"].id], IntentSource.GIT_MAIN, requested_by="tester"
        )
        run_job(dry_run.id)
        deploy_id = _deploy(job_service, dry_run)
        peer_gone = HealthSnapshot(
            bgp_sessions={"10.0.1.0": BgpSessionState("Established", 5)}, interfaces=LINKS
        )

        assert run_job(deploy_id, health_probe=ScriptedProbe(HEALTHY, peer_gone)) is (
            JobStatus.SUCCESS
        )

    def test_without_expectations_regressions_still_count(
        self, approved_dry_run: Job, job_service: JobService, run_job: RunJob, session: Session
    ) -> None:
        """Targets recorded before expectations existed fall back to regression checks."""
        deploy_id = _deploy(job_service, approved_dry_run)
        for target in session.get_one(Job, deploy_id).targets:
            target.health_expectations = None
        session.commit()
        probe = ScriptedProbe(HEALTHY, BGP_DOWN)

        assert run_job(deploy_id, health_probe=probe) is JobStatus.FAILED
        assert probe.expectations[0] is None
        assert "10.0.1.0 went from Established to Idle" in (
            _outcome(session, deploy_id)["leaf-1.croc.lab"][1] or ""
        )
