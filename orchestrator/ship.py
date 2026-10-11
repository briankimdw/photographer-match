"""Commit, push and open a PR. Idempotent; never merges, never force-pushes, never deploys."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any

from . import proc
from .state import TaskState


class ShipBlocked(RuntimeError):
    """Shipping can't proceed until a human fixes something (message says what)."""


GH_SETUP = (
    "GitHub CLI is required to open the pull request.\n"
    "  1. Install it:  sudo apt install gh   (or see https://cli.github.com)\n"
    "  2. Log in:      gh auth login   (GitHub.com, SSH, authenticate in the browser)\n"
    "  3. Continue:    python3 -m orchestrator ship {id}\n"
    "Nothing has been committed or pushed yet."
)


def _gh(cfg: dict[str, Any], repo: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [cfg["ship"].get("gh", "gh"), *args],
        cwd=repo,
        capture_output=True,
        text=True,
        env=os.environ.copy(),
    )


def preflight_gh(cfg: dict[str, Any], repo: Path, task_id: str) -> None:
    exe = cfg["ship"].get("gh", "gh")
    if not shutil.which(exe):
        raise ShipBlocked(GH_SETUP.format(id=task_id))
    r = _gh(cfg, repo, "auth", "status")
    if r.returncode != 0:
        raise ShipBlocked(
            "gh is installed but not authenticated:\n"
            f"{(r.stderr or r.stdout).strip()}\n\n" + GH_SETUP.format(id=task_id)
        )


def commit(st: TaskState, cfg: dict[str, Any], message: str) -> str:
    wt = Path(st.worktree)
    if st.commit_sha:
        head = proc.git(wt, "rev-parse", "HEAD")
        if head != st.commit_sha:
            raise ShipBlocked(
                f"branch HEAD {head[:12]} differs from recorded commit "
                f"{st.commit_sha[:12]}; inspect the worktree"
            )
        return st.commit_sha
    existing = proc.git(
        wt, "log", "--format=%H", f"--grep=Orchestrator-Task: {st.id}", f"{st.base_sha}..HEAD"
    )
    if existing:
        return existing.splitlines()[0]
    proc.git(wt, "add", "-A")
    if proc.git(wt, "write-tree") != st.verified_tree:
        raise ShipBlocked(
            "the worktree changed since it was verified; run "
            f"`python3 -m orchestrator resume {st.id}` to re-verify"
        )
    trailers = [f"Orchestrator-Task: {st.id}", *cfg["ship"].get("commit_trailers", [])]
    full = message.rstrip() + "\n\n" + "\n".join(trailers) + "\n"
    r = subprocess.run(
        ["git", "commit", "-q", "-F", "-"], cwd=wt, input=full, text=True, capture_output=True
    )
    if r.returncode != 0:
        raise ShipBlocked(f"git commit failed: {(r.stderr or r.stdout).strip()}")
    return proc.git(wt, "rev-parse", "HEAD")


def push(st: TaskState, cfg: dict[str, Any]) -> None:
    wt, remote = Path(st.worktree), cfg["git"].get("remote", "origin")
    remote_sha = proc.git(wt, "ls-remote", "--heads", remote, st.branch, check=False).split("\t")[0]
    if remote_sha == st.commit_sha:
        return
    if remote_sha:
        raise ShipBlocked(
            f"{remote}/{st.branch} already exists at {remote_sha[:12]} and differs; "
            "refusing to overwrite it (no force-push)"
        )
    proc.git(wt, "push", "-u", remote, f"{st.branch}:refs/heads/{st.branch}")


def open_pr(st: TaskState, cfg: dict[str, Any], repo: Path, title: str, body: str) -> str:
    r = _gh(cfg, repo, "pr", "list", "--head", st.branch, "--state", "all", "--json", "url,state")
    if r.returncode == 0:
        prs = json.loads(r.stdout or "[]")
        if prs:
            return str(prs[0]["url"])
    args = [
        "pr",
        "create",
        "--base",
        st.base,
        "--head",
        st.branch,
        "--title",
        title,
        "--body-file",
        "-",
    ]
    if cfg["ship"].get("draft"):
        args.append("--draft")
    r = subprocess.run(
        [cfg["ship"].get("gh", "gh"), *args],
        cwd=repo,
        input=body,
        text=True,
        capture_output=True,
        env=os.environ.copy(),
    )
    if r.returncode != 0:
        raise ShipBlocked(f"gh pr create failed: {(r.stderr or r.stdout).strip()}")
    return r.stdout.strip().splitlines()[-1]
