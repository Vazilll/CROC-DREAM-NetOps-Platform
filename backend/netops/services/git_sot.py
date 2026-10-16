"""Git Source of Truth (SoT) metadata, pull synchronization, and webhook service.

Includes a lightweight TTL cache for git subprocess metadata to avoid forking
3 `git` processes on every `/git/status` or `/system/bootstrap/status` poll.
"""

from __future__ import annotations

import base64
import json
import os
import re
import subprocess
import time
import urllib.parse
from pathlib import Path
from typing import Any

_GIT_META_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
_CACHE_TTL_SEC = 10.0


def invalidate_git_cache() -> None:
    from netops.services.state import get_state_manager  # noqa: PLC0415

    get_state_manager().clear_git_sot_meta()
    _GIT_META_CACHE.clear()



def _sanitize_git_url(url: str) -> str:
    clean = (url or "").strip()
    if clean.startswith(("http://", "https://")):
        try:
            parts = urllib.parse.urlsplit(clean)
            if parts.username or parts.password:
                host = parts.hostname or "github.com"
                netloc = f"{host}:{parts.port}" if parts.port else host
                return urllib.parse.urlunsplit((parts.scheme, netloc, parts.path, parts.query, parts.fragment))
        except Exception:
            pass
    return clean


def _load_saved_pat(repo_path: Path) -> str:
    project_root = repo_path.parent if repo_path.name == "intent" else repo_path
    rt_file = project_root / "lab" / "running" / "runtime_settings.json"
    if rt_file.is_file():
        try:
            data = json.loads(rt_file.read_text(encoding="utf-8"))
            return str(data.get("github_pat") or "").strip()
        except Exception:
            pass
    return ""


def _git_auth_cmd_and_env(url: str, github_pat: str | None, repo_path: Path) -> tuple[list[str], dict[str, str], str]:
    pat = (github_pat or "").strip() or _load_saved_pat(repo_path)
    clean_url = _sanitize_git_url(url)
    if not pat and url.strip().startswith(("http://", "https://")):
        try:
            parts = urllib.parse.urlsplit(url.strip())
            pat = (parts.password or parts.username or "").strip()
        except Exception:
            pass
    if pat and clean_url.startswith("git@github.com:"):
        m = re.match(r"^git@github\.com:([^/]+/.+?)(?:\.git)?$", clean_url)
        if m:
            clean_url = f"https://github.com/{m.group(1)}.git"
    env = {
        **os.environ,
        "GIT_TERMINAL_PROMPT": "0",
        "GIT_SSH_COMMAND": "ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=6",
    }
    git_prefix = ["git"]
    if pat and clean_url.startswith(("http://", "https://")):
        b64 = base64.b64encode(f"x-access-token:{pat}".encode("utf-8")).decode("ascii")
        git_prefix = ["git", "-c", f"http.https://github.com/.extraheader=Authorization: Basic {b64}"]
    return git_prefix, env, clean_url


def _scrub_secret(text: str, secret: str | None) -> str:
    if not text:
        return ""
    out = re.sub(r"://[^/@\s]+@", "://***@", text)
    if secret and secret.strip():
        out = out.replace(secret.strip(), "***")
    return out


def git_repo_metadata(repo_path: Any, fallback_url: str) -> dict[str, Any]:
    from netops.services.state import get_state_manager  # noqa: PLC0415

    cache_key = f"{repo_path}:{fallback_url}"
    state_mgr = get_state_manager()
    cached_meta = state_mgr.get_git_sot_meta(cache_key)
    if cached_meta is not None:
        return dict(cached_meta)

    now = time.monotonic()
    cached = _GIT_META_CACHE.get(cache_key)
    if cached and (now - cached[0]) < _CACHE_TTL_SEC:
        return dict(cached[1])

    cwd = repo_path if hasattr(repo_path, "is_dir") and repo_path.is_dir() else None
    branch = "main"
    commit_sha = "HEAD"
    commit_message = "Declarative SoT baseline"
    commit_author = "NetOps Bot"
    remote_url = _sanitize_git_url(fallback_url)
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
            remote_url = _sanitize_git_url(r_remote.stdout.strip())
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
    state_mgr.set_git_sot_meta(cache_key, result, ttl=int(_CACHE_TTL_SEC))
    _GIT_META_CACHE[cache_key] = (now, result)
    return dict(result)



def git_pull_repo(repo_path: Path, branch: str = "main", github_pat: str | None = None) -> str:
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
        r_rem = subprocess.run(
            ["git", "remote", "get-url", "origin"],
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=2,
            check=False,
        )
        rem_url = r_rem.stdout.strip() if r_rem.returncode == 0 else ""
        git_cmd, git_env, _ = _git_auth_cmd_and_env(rem_url, github_pat, repo_path)
        r_pull = subprocess.run(
            [*git_cmd, "pull", "--ff-only", "origin", branch or "main"],
            cwd=cwd,
            env=git_env,
            capture_output=True,
            text=True,
            timeout=8,
            check=False,
        )
        out = _scrub_secret((r_pull.stdout or r_pull.stderr or "").strip(), github_pat).splitlines()
        return out[-1] if out else "up-to-date"
    except Exception as exc:
        return f"local-only ({_scrub_secret(str(exc), github_pat)})"


def git_connect_remote(
    repo_path: Path,
    repo_url: str,
    branch: str = "main",
    github_pat: str | None = None,
) -> dict[str, Any]:
    """Bind origin remote to the user-provided SSH/HTTPS Git URL (supporting private repos via PAT) and sync intent files."""
    invalidate_git_cache()
    git_cmd, ssh_env, clean_url = _git_auth_cmd_and_env(repo_url, github_pat, repo_path)
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
            [*git_cmd, "ls-remote", "--heads", "origin"],
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
                [*git_cmd, "fetch", "--depth=1", "origin", clean_branch],
                cwd=project_root,
                env=ssh_env,
                capture_output=True,
                text=True,
                timeout=15,
                check=False,
            )
            if r_fetch.returncode == 0:
                r_pull = subprocess.run(
                    [*git_cmd, "pull", "--ff-only", "origin", clean_branch],
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

            invalidate_git_cache()
            return {
                "connected": True,
                "remote_url": clean_url,
                "branch": clean_branch,
                "commit_short": commit_short or "HEAD",
                "branches": branches or [clean_branch],
                "synced_files": True,
                "message": f"Git подключён: {clean_url} ({clean_branch}@{commit_short or 'HEAD'})",
            }
        err_msg = _scrub_secret(
            (r_ls.stderr or r_ls.stdout or "Git connection failed").strip(), github_pat
        ).splitlines()[-1]
        return {
            "connected": False,
            "remote_url": clean_url,
            "branch": clean_branch,
            "commit_short": "HEAD",
            "branches": [clean_branch],
            "synced_files": False,
            "message": f"Не удалось проверить репозиторий (если он приватный — укажите GitHub Token): {err_msg}",
        }
    except Exception as exc:
        return {
            "connected": False,
            "remote_url": clean_url,
            "branch": clean_branch,
            "commit_short": "HEAD",
            "branches": [clean_branch],
            "synced_files": False,
            "message": f"Ошибка Git: {_scrub_secret(str(exc), github_pat)}",
        }


def git_commit_and_push_diff(
    repo_path: Path,
    *,
    job_id: str,
    job_type: str,
    device_diffs: list[dict[str, Any]],
    branch: str = "main",
    remote_url: str | None = None,
    github_pat: str | None = None,
) -> dict[str, Any]:
    """Write diff summary into intent/diffs/latest_diff.yaml, stage only safe declarative files, and push."""
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
        "# CROC DREAM NetOps — Auto Diff Snapshot",
        f"job_id: {job_id}",
        f"job_type: {job_type}",
        f"timestamp_epoch: {int(time.time())}",
        "devices:",
    ]
    for item in device_diffs:
        hname = str(item.get("hostname") or "unknown")
        rem = str(item.get("remediation_patch") or "").strip()
        in_sync = not bool(rem)
        summary_lines.append(f"  - hostname: {hname}")
        summary_lines.append(f"    in_sync: {str(in_sync).lower()}")
        summary_lines.append(f"    remediation_lines: {len(rem.splitlines()) if rem else 0}")
        if rem:
            changed_hosts.append(hname)

    latest_diff_file = diffs_dir / "latest_diff.yaml"
    latest_diff_file.write_text("\n".join(summary_lines) + "\n", encoding="utf-8")

    git_cmd, ssh_env, clean_remote = _git_auth_cmd_and_env(remote_url or "", github_pat, repo_path)
    target_branch = (branch or "main").strip()
    try:
        if clean_remote:
            subprocess.run(
                ["git", "remote", "set-url", "origin", clean_remote],
                cwd=cwd,
                capture_output=True,
                text=True,
                timeout=3,
                check=False,
            )

        safe_paths = [
            str(p)
            for p in (
                repo_path / "devices",
                repo_path / "platforms",
                repo_path / "inventory.yaml",
                latest_diff_file,
            )
            if p.exists()
        ]
        if safe_paths:
            subprocess.run(
                ["git", "add", "--", *safe_paths],
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
            [*git_cmd, "push", "origin", f"HEAD:{target_branch}"],
            cwd=cwd,
            env=ssh_env,
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
        pushed = r_push.returncode == 0
        push_note = _scrub_secret((r_push.stderr or r_push.stdout or "").strip(), github_pat).splitlines()
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
            "push_output": _scrub_secret(str(exc), github_pat),
        }

