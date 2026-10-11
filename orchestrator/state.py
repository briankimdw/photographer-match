"""Persistent task state (one JSON file per task) and an append-only event log."""

from __future__ import annotations

import fcntl
import json
import os
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

# Lifecycle:
#   implementing -> verifying -> (remediating -> verifying)* -> awaiting_ship -> shipping -> shipped
# Terminal/paused: failed, needs_human, stopped. `resume` re-enters at `stage`.


@dataclass
class TaskState:
    id: str
    title: str
    plan_source: str
    plan_sha256: str
    branch: str
    base: str
    base_sha: str
    worktree: str
    session_id: str
    auto_ship: bool
    status: str = "implementing"
    stage: str = "implementing"  # where `resume` continues
    reason: str = ""
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    elapsed_seconds: float = 0.0
    agent_calls: int = 0
    session_started: bool = False
    remediations: int = 0
    cost_usd: float = 0.0
    setup_hash: str = ""
    last_failure_fingerprint: str = ""
    last_verification: list[dict[str, Any]] = field(default_factory=list)
    verified_tree: str = ""
    warnings: list[str] = field(default_factory=list)
    questions: list[str] = field(default_factory=list)
    agent_summary: str = ""
    pending_answer: str = ""
    commit_sha: str = ""
    pushed: bool = False
    pr_url: str = ""
    pid: int = 0
    # Simplification pass (code-simplifier plugin) after the first green verification.
    # "" pending | disabled | checking | applied | no_changes | reverted | skipped
    simplify: str = ""
    simplify_note: str = ""
    simplify_cost_usd: float = 0.0
    pre_simplify_tree: str = ""
    pre_simplify_files: list[str] = field(default_factory=list)
    pre_simplify_verification: list[dict[str, Any]] = field(default_factory=list)
    limits: dict[str, Any] = field(default_factory=dict)


def total_cost(st: TaskState) -> float:
    return st.cost_usd + st.simplify_cost_usd


class Store:
    def __init__(self, repo: Path) -> None:
        self.root = repo / ".orchestrator"
        self.tasks = self.root / "tasks"

    def task_dir(self, task_id: str) -> Path:
        return self.tasks / task_id

    def save(self, st: TaskState) -> None:
        st.updated_at = time.time()
        d = self.task_dir(st.id)
        d.mkdir(parents=True, exist_ok=True)
        tmp = d / "state.json.tmp"
        tmp.write_text(json.dumps(asdict(st), indent=2))
        os.replace(tmp, d / "state.json")

    def load(self, task_id: str) -> TaskState:
        path = self.task_dir(task_id) / "state.json"
        if not path.is_file():
            raise SystemExit(f"no such task: {task_id}")
        data = json.loads(path.read_text())
        known = TaskState.__dataclass_fields__
        return TaskState(**{k: v for k, v in data.items() if k in known})

    def all_ids(self) -> list[str]:
        if not self.tasks.is_dir():
            return []
        return sorted(p.name for p in self.tasks.iterdir() if (p / "state.json").is_file())

    def latest_id(self) -> str:
        ids = self.all_ids()
        if not ids:
            raise SystemExit("no tasks yet")
        return ids[-1]

    def log(self, task_id: str, event: str, **data: Any) -> None:
        d = self.task_dir(task_id)
        d.mkdir(parents=True, exist_ok=True)
        rec = {"ts": time.strftime("%Y-%m-%dT%H:%M:%S"), "event": event, **data}
        with open(d / "log.jsonl", "a", encoding="utf-8") as f:
            f.write(json.dumps(rec) + "\n")
        brief = data.get("msg") or ", ".join(f"{k}={v}" for k, v in data.items() if k != "detail")
        print(f"[{rec['ts']}] {event}: {brief}", flush=True)


class RepoLock:
    """One active orchestrator run per repository."""

    def __init__(self, store: Store) -> None:
        store.root.mkdir(parents=True, exist_ok=True)
        self.path = store.root / "run.lock"
        self.fd: int | None = None

    def __enter__(self) -> RepoLock:
        self.fd = os.open(self.path, os.O_RDWR | os.O_CREAT, 0o600)
        try:
            fcntl.flock(self.fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as e:
            holder = os.pread(self.fd, 64, 0).decode(errors="replace").strip()
            os.close(self.fd)
            raise SystemExit(f"another orchestrator run is active (pid {holder or '?'})") from e
        os.ftruncate(self.fd, 0)
        os.pwrite(self.fd, str(os.getpid()).encode(), 0)
        return self

    def __exit__(self, *exc: object) -> None:
        if self.fd is not None:
            os.ftruncate(self.fd, 0)
            fcntl.flock(self.fd, fcntl.LOCK_UN)
            os.close(self.fd)
