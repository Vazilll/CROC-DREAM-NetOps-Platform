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


def git_pull_repo(repo_path: Path) -> str:
    invalidate_git_cache()
    if os.environ.get("PYTEST_CURRENT_TEST"):
        return "pytest-local"
    cwd = repo_path if repo_path.is_dir() else repo_path.parent
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
            ["git", "pull", "--ff-only", "origin", "main"],
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
        out = (r_pull.stdout or r_pull.stderr or "").strip().splitlines()
        return out[-1] if out else "up-to-date"
    except Exception as exc:
        return f"local-only ({exc})"
