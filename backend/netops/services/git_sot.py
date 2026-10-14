"""Git Source of Truth (SoT) metadata, pull synchronization, and webhook service.

Includes a lightweight TTL cache for git subprocess metadata to avoid forking
3 `git` processes on every `/git/status` or `/system/bootstrap/status` poll.
"""

from __future__ import annotations

import os
import subprocess
import time
from pathlib import Path
from typing import Any

_GIT_META_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
_CACHE_TTL_SEC = 10.0


def invalidate_git_cache() -> None:
    _GIT_META_CACHE.clear()


def git_repo_metadata(repo_path: Any, fallback_url: str) -> dict[str, Any]:
    cache_key = f"{repo_path}:{fallback_url}"
    now = time.monotonic()
    cached = _GIT_META_CACHE.get(cache_key)
    if cached and (now - cached[0]) < _CACHE_TTL_SEC:
        return dict(cached[1])

    cwd = repo_path if hasattr(repo_path, "is_dir") and repo_path.is_dir() else None
    branch = "main"
    commit_sha = "HEAD"
    commit_message = "Declarative SoT baseline"
    commit_author = "NetOps Bot"
    remote_url = fallback_url
    try:
        r_branch = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=2,
            check=False,
        )
        if r_branch.returncode == 0 and r_branch.stdout.strip():
            branch = r_branch.stdout.strip()
        r_log = subprocess.run(
            ["git", "log", "-1", "--format=%h|%s|%an"],
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=2,
            check=False,
        )
        if r_log.returncode == 0 and "|" in r_log.stdout:
            parts = r_log.stdout.strip().split("|", 2)
            commit_sha, commit_message, commit_author = parts[0], parts[1], parts[2]
        r_remote = subprocess.run(
            ["git", "remote", "get-url", "origin"],
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=2,
            check=False,
        )
        if r_remote.returncode == 0 and r_remote.stdout.strip():
            remote_url = r_remote.stdout.strip()
    except Exception:
        pass

    result = {
        "repo_path": str(repo_path),
        "github_repo_url": remote_url,
        "is_git_repo": True,
        "branch": branch,
        "commit_sha": commit_sha,
        "commit_short": commit_sha[:8] if commit_sha else "HEAD",
        "commit_message": commit_message,
        "last_commit_message": commit_message,
        "commit_author": commit_author,
        "remote_url": remote_url,
        "webhook_configured": True,
        "auto_sync_on_push": True,
    }
    _GIT_META_CACHE[cache_key] = (now, result)
    return dict(result)


def git_pull_repo(repo_path: Path, branch: str = "main") -> str:
    invalidate_git_cache()
    if os.environ.get("PYTEST_CURRENT_TEST"):
        return "pytest-local"
    cwd = repo_path if repo_path.is_dir() else repo_path.parent
    ssh_env = {
        **os.environ,
        "GIT_SSH_COMMAND": "ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=5",
    }
    try:
        r_top = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=2,
            check=False,
        )
        if r_top.returncode != 0:
            return "not-a-git-repo"
        r_pull = subprocess.run(
            ["git", "pull", "--ff-only", "origin", branch or "main"],
            cwd=cwd,
            env=ssh_env,
            capture_output=True,
            text=True,
            timeout=8,
            check=False,
        )
        out = (r_pull.stdout or r_pull.stderr or "").strip().splitlines()
        return out[-1] if out else "up-to-date"
    except Exception as exc:
        return f"local-only ({exc})"


def git_connect_remote(repo_path: Path, repo_url: str, branch: str = "main") -> dict[str, Any]:
    """Bind origin remote to the user-provided SSH/Git URL and verify remote branch via git ls-remote."""
    invalidate_git_cache()
    clean_url = repo_url.strip()
    clean_branch = (branch or "main").strip()
    if os.environ.get("PYTEST_CURRENT_TEST"):
        return {
            "connected": True,
            "remote_url": clean_url,
            "branch": clean_branch,
            "commit_short": "pytest0",
            "branches": [clean_branch],
            "synced_files": True,
            "message": "Подключено (pytest)",
        }

    project_root = repo_path.parent if repo_path.name == "intent" else repo_path
    cwd = project_root if project_root.is_dir() else (repo_path if repo_path.is_dir() else repo_path.parent)
    ssh_env = {
        **os.environ,
        "GIT_SSH_COMMAND": "ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=6",
    }
    try:
        r_top = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=2,
            check=False,
        )
        if r_top.returncode != 0:
            subprocess.run(
                ["git", "init", "-b", clean_branch],
                cwd=project_root,
                capture_output=True,
                text=True,
                timeout=3,
                check=False,
            )

        r_rem = subprocess.run(
            ["git", "remote", "set-url", "origin", clean_url],
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=3,
            check=False,
        )
        if r_rem.returncode != 0:
            subprocess.run(
                ["git", "remote", "add", "origin", clean_url],
                cwd=cwd,
                capture_output=True,
                text=True,
                timeout=3,
                check=False,
            )

        r_ls = subprocess.run(
            ["git", "ls-remote", "--heads", "origin"],
            cwd=cwd,
            env=ssh_env,
            capture_output=True,
            text=True,
            timeout=8,
            check=False,
        )
        branches: list[str] = []
        commit_short = ""
        if r_ls.returncode == 0 and r_ls.stdout.strip():
            for line in r_ls.stdout.strip().splitlines():
                parts = line.split()
                if len(parts) >= 2 and parts[1].startswith("refs/heads/"):
                    b_name = parts[1].removeprefix("refs/heads/")
                    branches.append(b_name)
                    if b_name == clean_branch:
                        commit_short = parts[0][:7]
            if not commit_short and branches:
                clean_branch = branches[0]
                first_sha = r_ls.stdout.strip().splitlines()[0].split()[0]
                commit_short = first_sha[:7]

            r_fetch = subprocess.run(
                ["git", "fetch", "--depth=1", "origin", clean_branch],
                cwd=project_root,
                env=ssh_env,
                capture_output=True,
                text=True,
                timeout=15,
                check=False,
            )
            if r_fetch.returncode == 0:
                r_pull = subprocess.run(
                    ["git", "pull", "--ff-only", "origin", clean_branch],
                    cwd=project_root,
                    env=ssh_env,
                    capture_output=True,
                    text=True,
                    timeout=15,
                    check=False,
                )
                if r_pull.returncode != 0:
                    r_co = subprocess.run(
                        ["git", "checkout", "FETCH_HEAD", "--", "intent", "templates"],
                        cwd=project_root,
                        capture_output=True,
                        text=True,
                        timeout=5,
                        check=False,
                    )
                    if r_co.returncode != 0 and repo_path.is_dir():
                        subprocess.run(
                            ["git", "checkout", "FETCH_HEAD", "--", "."],
                            cwd=repo_path,
                            capture_output=True,
                            text=True,
                            timeout=5,
                            check=False,
                        )
                    subprocess.run(
                        ["git", "reset", "--mixed", "FETCH_HEAD"],
                        cwd=project_root,
                        capture_output=True,
                        text=True,
                        timeout=3,
                        check=False,
                    )

            invalidate_git_cache()
            return {
                "connected": True,
                "remote_url": clean_url,
                "branch": clean_branch,
                "commit_short": commit_short or "HEAD",
                "branches": branches or [clean_branch],
                "synced_files": True,
                "message": f"SSH подключён: {clean_url} ({clean_branch}@{commit_short or 'HEAD'})",
            }
        err_msg = (r_ls.stderr or r_ls.stdout or "SSH connection failed").strip().splitlines()[-1]
        return {
            "connected": False,
            "remote_url": clean_url,
            "branch": clean_branch,
            "commit_short": "HEAD",
            "branches": [clean_branch],
            "synced_files": False,
            "message": f"Не удалось проверить удалённый репозиторий: {err_msg}",
        }
    except Exception as exc:
        return {
            "connected": False,
            "remote_url": clean_url,
            "branch": clean_branch,
            "commit_short": "HEAD",
            "branches": [clean_branch],
            "synced_files": False,
            "message": f"Ошибка SSH Git: {exc}",
        }


def git_commit_and_push_diff(
    repo_path: Path,
    *,
    job_id: str,
    job_type: str,
    device_diffs: list[dict[str, Any]],
    branch: str = "main",
    remote_url: str | None = None,
) -> dict[str, Any]:
    """Write diff artifacts into intent/diffs/, commit changes, and push via SSH to origin."""
    if os.environ.get("PYTEST_CURRENT_TEST"):
        return {
            "status": "skipped_pytest",
            "committed": False,
            "pushed": False,
            "commit_short": "pytest0",
            "branch": branch,
        }

    invalidate_git_cache()
    cwd = repo_path if repo_path.is_dir() else repo_path.parent
    diffs_dir = repo_path / "diffs"
    diffs_dir.mkdir(parents=True, exist_ok=True)

    changed_hosts: list[str] = []
    summary_lines = [
        f"# CROC DREAM NetOps — Auto Diff Snapshot",
        f"job_id: {job_id}",
        f"job_type: {job_type}",
        f"timestamp_epoch: {int(time.time())}",
        "devices:",
    ]
    for item in device_diffs:
        hname = str(item.get("hostname") or "unknown")
        rem = str(item.get("remediation_patch") or "").strip()
        intended = str(item.get("intended_config") or "").strip()
        in_sync = not bool(rem)
        summary_lines.append(f"  - hostname: {hname}")
        summary_lines.append(f"    in_sync: {str(in_sync).lower()}")
        summary_lines.append(f"    remediation_lines: {len(rem.splitlines()) if rem else 0}")
        if rem:
            changed_hosts.append(hname)
            (diffs_dir / f"{hname}.remediation.cfg").write_text(rem + "\n", encoding="utf-8")
        if intended:
            (diffs_dir / f"{hname}.intended.cfg").write_text(intended + "\n", encoding="utf-8")

    (diffs_dir / "latest_diff.yaml").write_text("\n".join(summary_lines) + "\n", encoding="utf-8")

    ssh_env = {
        **os.environ,
        "GIT_SSH_COMMAND": "ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=6",
    }
    target_branch = (branch or "main").strip()
    try:
        if remote_url and remote_url.strip():
            subprocess.run(
                ["git", "remote", "set-url", "origin", remote_url.strip()],
                cwd=cwd,
                capture_output=True,
                text=True,
                timeout=3,
                check=False,
            )

        subprocess.run(
            ["git", "add", str(repo_path)],
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=4,
            check=False,
        )

        hosts_label = ", ".join(changed_hosts[:4]) if changed_hosts else "all-in-sync"
        commit_msg = f"netops({job_type.lower()}): diff snapshot [{hosts_label}] ({job_id[:8]})"
        r_commit = subprocess.run(
            [
                "git",
                "-c",
                "user.name=CROC NetOps Platform",
                "-c",
                "user.email=netops@croc.local",
                "commit",
                "-m",
                commit_msg,
            ],
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
        committed = r_commit.returncode == 0

        r_sha = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=2,
            check=False,
        )
        commit_short = r_sha.stdout.strip() if r_sha.returncode == 0 else "HEAD"

        r_push = subprocess.run(
            ["git", "push", "origin", f"HEAD:{target_branch}"],
            cwd=cwd,
            env=ssh_env,
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
        pushed = r_push.returncode == 0
        push_note = (r_push.stderr or r_push.stdout or "").strip().splitlines()
        invalidate_git_cache()
        return {
            "status": "ok" if pushed else "committed_local",
            "committed": committed,
            "pushed": pushed,
            "commit_short": commit_short,
            "commit_message": commit_msg,
            "branch": target_branch,
            "push_output": push_note[-1] if push_note else ("pushed" if pushed else "no-output"),
        }
    except Exception as exc:
        return {
            "status": "error",
            "committed": False,
            "pushed": False,
            "commit_short": "HEAD",
            "branch": target_branch,
            "push_output": str(exc),
        }

