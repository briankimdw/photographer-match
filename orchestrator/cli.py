"""python3 -m orchestrator {start,status,logs,resume,stop,ship,list}"""

from __future__ import annotations

import argparse
import json
import os
import signal
import sys
import time
import tomllib
from pathlib import Path
from typing import Any

from . import proc
from .report import status_text
from .runner import Orchestrator

DEFAULT_CONFIG = Path(__file__).parent / "config.toml"


def find_repo(start: Path) -> Path:
    """Main checkout root, even when invoked from inside a worktree."""
    common = proc.git(start, "rev-parse", "--path-format=absolute", "--git-common-dir")
    return Path(common).parent


def load_config(path: Path) -> dict[str, Any]:
    with open(path, "rb") as f:
        return tomllib.load(f)


def _limits(a: argparse.Namespace) -> dict[str, Any]:
    out: dict[str, Any] = {}
    if a.max_remediations is not None:
        out["max_remediations"] = a.max_remediations
    if a.budget is not None:
        out["max_budget_usd"] = a.budget
    if a.timeout is not None:
        out["task_timeout_minutes"] = a.timeout
    return out


def _add_limit_args(p: argparse.ArgumentParser) -> None:
    p.add_argument(
        "--max-remediations", type=int, help="fix attempts after the first implementation"
    )
    p.add_argument("--budget", type=float, help="total Claude spend limit in USD")
    p.add_argument("--timeout", type=float, help="task wall-clock limit in minutes")


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(
        prog="python3 -m orchestrator", description="Plan-driven Claude Code orchestrator"
    )
    ap.add_argument("--repo", type=Path, help="repository (default: the one containing cwd)")
    ap.add_argument("--config", type=Path, help=f"config file (default: {DEFAULT_CONFIG.name})")
    sub = ap.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("start", help="start a task from an approved plan")
    s.add_argument("--plan", type=Path, required=True)
    s.add_argument(
        "--auto-ship",
        action="store_true",
        help="commit, push and open the PR without pausing after verification",
    )
    s.add_argument("--base", help="base branch (default from config)")
    s.add_argument(
        "--no-simplify", action="store_true", help="skip the code-simplifier pass for this task"
    )
    _add_limit_args(s)

    s = sub.add_parser("resume", help="continue an interrupted, paused or failed task")
    s.add_argument("task", nargs="?")
    g = s.add_mutually_exclusive_group()
    g.add_argument("--answer", help="answer to the agent's questions")
    g.add_argument("--answer-file", type=Path)
    _add_limit_args(s)

    for name, hlp in (
        ("status", "show task status"),
        ("stop", "stop a running task"),
        ("ship", "commit, push and open the PR for a verified task"),
    ):
        s = sub.add_parser(name, help=hlp)
        s.add_argument("task", nargs="?")
        if name == "status":
            s.add_argument("--json", action="store_true")

    s = sub.add_parser("logs", help="show the event log, or one agent/check transcript")
    s.add_argument("task", nargs="?")
    s.add_argument("-f", "--follow", action="store_true")
    s.add_argument("--file", help="e.g. agent-01.txt or verify-01/pytest.log")
    s.add_argument("--files", action="store_true", help="list the task's log files")

    sub.add_parser("list", help="list tasks")
    return ap


def main(argv: list[str] | None = None) -> int:
    a = build_parser().parse_args(argv)
    # Never run inside an orchestrated agent/check (prevents recursive orchestration).
    if os.environ.get(proc.RECURSION_VAR) and a.cmd in ("start", "resume", "ship"):
        print("refusing to run: already inside an orchestrator task", file=sys.stderr)
        return 2
    repo = find_repo((a.repo or Path.cwd()).resolve())
    cfg = load_config(a.config or DEFAULT_CONFIG)
    orch = Orchestrator(repo, cfg)
    store = orch.store
    task_id = getattr(a, "task", None) or (
        store.latest_id() if a.cmd not in ("start", "list") else ""
    )

    if a.cmd == "start":
        st = orch.create(a.plan, a.auto_ship, _limits(a), a.base, simplify=not a.no_simplify)
        rc = orch.run(st)
        print("\n" + status_text(store.load(st.id)))
        return rc

    if a.cmd == "resume":
        st = store.load(task_id)
        if st.status in ("shipped",):
            print(status_text(st))
            return 0
        if st.pid and _alive(st.pid):
            raise SystemExit(f"task {st.id} is already running (pid {st.pid})")
        st.limits.update(_limits(a))
        answer = a.answer or (a.answer_file.read_text() if a.answer_file else "")
        if st.stage == "answering":
            if not answer:
                raise SystemExit(
                    "the agent asked questions; pass --answer or --answer-file:\n  "
                    + "\n  ".join(st.questions or [st.reason])
                )
            st.pending_answer = answer
        store.save(st)
        store.log(st.id, "resumed", stage=st.stage)
        rc = orch.run(st)  # a verified task stays at awaiting_ship unless --auto-ship was set
        print("\n" + status_text(store.load(st.id)))
        return rc

    if a.cmd == "ship":
        st = store.load(task_id)
        from .state import RepoLock

        with RepoLock(store):
            rc = orch.ship(st)
        print("\n" + status_text(store.load(st.id)))
        return rc

    if a.cmd == "status":
        st = store.load(task_id)
        if (
            st.pid
            and not _alive(st.pid)
            and st.status in ("implementing", "verifying", "remediating", "answering", "shipping")
        ):
            st.reason = "orchestrator process exited unexpectedly; use resume"
        print(json.dumps(st.__dict__, indent=2) if a.json else status_text(st))
        return 0

    if a.cmd == "stop":
        st = store.load(task_id)
        if st.pid and _alive(st.pid):
            os.kill(st.pid, signal.SIGINT)
            print(f"sent stop to pid {st.pid}; the current step is interrupted cleanly")
        else:
            print(f"task {st.id} is not running (status {st.status})")
        return 0

    if a.cmd == "logs":
        d = store.task_dir(task_id)
        if a.files:
            for p in sorted(d.rglob("*")):
                if p.is_file():
                    print(p.relative_to(d))
            return 0
        path = (d / a.file).resolve() if a.file else d / "log.jsonl"
        if not path.is_relative_to(d.resolve()) or not path.is_file():
            raise SystemExit(f"no such log: {path}")
        _show(path, a.follow)
        return 0

    if a.cmd == "list":
        for tid in store.all_ids():
            st = store.load(tid)
            print(f"{tid:50} {st.status:14} {st.pr_url or st.branch}")
        return 0
    return 2


def _alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    cmdline = Path(f"/proc/{pid}/cmdline")
    return not cmdline.exists() or b"orchestrator" in cmdline.read_bytes()


def _show(path: Path, follow: bool) -> None:
    with open(path, encoding="utf-8", errors="replace") as f:
        while True:
            line = f.readline()
            if line:
                if path.suffix == ".jsonl":
                    rec = json.loads(line)
                    ts, ev = rec.pop("ts"), rec.pop("event")
                    line = f"[{ts}] {ev}: " + (rec.pop("msg", "") or json.dumps(rec)) + "\n"
                sys.stdout.write(line)
            elif follow:
                time.sleep(0.5)
            else:
                return
