"""Independent verification: runs configured checks in the worktree, outside the agent."""

from __future__ import annotations

import functools
import hashlib
import re
import shlex
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from . import proc
from .plan import AcceptanceCheck

# Dummy settings so the app imports without real credentials (backend/.env is never
# present in a worktree because it is gitignored).
CHECK_ENV = {
    "SUPABASE_URL": "http://supabase.invalid",
    "SUPABASE_KEY": "test-anon-key",
    "SUPABASE_JWT_SECRET": "test-jwt-secret",
    "PYTHONDONTWRITEBYTECODE": "1",
}


@dataclass
class CheckResult:
    name: str
    status: str  # passed | failed | flaky | unavailable | skipped | timeout
    required: bool
    code: int | None
    seconds: float
    command: str
    output: str

    def blocks_success(self) -> bool:
        return self.required and self.status not in ("passed", "skipped")

    def fixable(self) -> bool:
        """Failures the agent should be asked to fix (vs. flaky/unavailable: human)."""
        return self.status in ("failed", "timeout")


@functools.cache
def _glob_re(glob: str) -> re.Pattern[str]:
    """Path glob: `**/` = zero or more directories, `**` = anything, `*`/`?` stay in one segment."""
    out, i = "", 0
    while i < len(glob):
        if glob.startswith("**/", i):
            out, i = out + "(?:.*/)?", i + 3
        elif glob.startswith("**", i):
            out, i = out + ".*", i + 2
        elif glob[i] == "*":
            out, i = out + "[^/]*", i + 1
        elif glob[i] == "?":
            out, i = out + "[^/]", i + 1
        else:
            out, i = out + re.escape(glob[i]), i + 1
    return re.compile(out + r"\Z")


def matches(path: str, globs: list[str]) -> bool:
    return any(_glob_re(g).match(path) for g in globs)


def stage_all(worktree: Path) -> str:
    """Stage the agent's work (incl. new files) and return the tree hash it represents."""
    proc.git(worktree, "add", "-A")
    return proc.git(worktree, "write-tree")


def changed_files(worktree: Path, base_sha: str) -> list[tuple[str, str]]:
    """[(status, path)] of staged changes vs base. Call after stage_all."""
    out = proc.git(worktree, "diff", "--cached", "--name-status", "--no-renames", base_sha)
    rows = []
    for line in out.splitlines():
        status, _, path = line.partition("\t")
        rows.append((status[:1], path))
    return rows


def _expand(cmd: str, worktree: Path, files: list[str]) -> list[str]:
    parts = shlex.split(cmd)
    out: list[str] = []
    for p in parts:
        if p == "{files}":
            out.extend(files)
        else:
            out.append(p.replace("{worktree}", str(worktree)))
    return out


def run_setup(cfg: dict[str, Any], worktree: Path, timeout: float) -> proc.Result | None:
    """Run setup commands; returns the failing result, or None on success."""
    env = proc.scrubbed_env(CHECK_ENV)
    for cmd in cfg.get("setup", {}).get("commands", []):
        r = proc.run(_expand(cmd, worktree, []), worktree, env, timeout)
        if r.code != 0:
            r.output = f"$ {cmd}\n{r.output}"
            return r
    return None


def setup_hash(cfg: dict[str, Any], worktree: Path) -> str:
    h = hashlib.sha256()
    for rel in cfg.get("setup", {}).get("rerun_on", []):
        p = worktree / rel
        h.update(rel.encode() + b"\0" + (p.read_bytes() if p.is_file() else b"<missing>"))
    return h.hexdigest()


def run_checks(
    cfg: dict[str, Any], worktree: Path, changed: list[tuple[str, str]], timeout: float
) -> list[CheckResult]:
    env = proc.scrubbed_env(CHECK_ENV)
    live = [p for s, p in changed if s != "D"]
    every = [p for _, p in changed]
    results = []
    for chk in cfg.get("checks", []):
        name, required = chk["name"], bool(chk.get("required", True))
        cwd_rel = chk.get("cwd", ".")
        when = chk.get("when_changed")
        if when and not any(matches(p, when) for p in every):
            results.append(
                CheckResult(name, "skipped", required, None, 0, "", "no matching changes")
            )
            continue
        files: list[str] = []
        if "files" in chk:
            prefix = "" if cwd_rel in (".", "") else cwd_rel.rstrip("/") + "/"
            files = [
                p[len(prefix) :] for p in live if matches(p, chk["files"]) and p.startswith(prefix)
            ]
            if not files:
                results.append(
                    CheckResult(name, "skipped", required, None, 0, "", "no matching files")
                )
                continue
        argv = _expand(chk["cmd"], worktree, files)
        cmd_str = shlex.join(argv)
        r = proc.run(argv, worktree / cwd_rel, env, timeout)
        status = _classify(chk, r)
        if status == "failed":
            # One unchanged rerun separates real failures from flaky ones.
            r2 = proc.run(argv, worktree / cwd_rel, env, timeout)
            if r2.code == 0:
                status = "flaky"
                r.output += "\n--- rerun without changes PASSED (flaky) ---\n" + r2.output[-2000:]
        results.append(
            CheckResult(name, status, required, r.code, round(r.seconds, 1), cmd_str, r.output)
        )
        if r.stopped:
            break
    return results


def run_acceptance(
    checks: list[AcceptanceCheck], worktree: Path, timeout: float
) -> list[CheckResult]:
    """The approved plan's command ACs: `bash -c <command>` from the repo root; the exit code
    decides. Commands come from the frozen plan copy, never from the worktree."""
    env = proc.scrubbed_env(CHECK_ENV)
    results = []
    for ac in checks:
        argv = ["bash", "-c", ac.command]
        r = proc.run(argv, worktree, env, timeout)
        status = _ac_status(r, ac.expect_exit)
        if status == "failed":
            r2 = proc.run(argv, worktree, env, timeout)
            if _ac_status(r2, ac.expect_exit) == "passed":
                status = "flaky"
                r.output += "\n--- rerun without changes PASSED (flaky) ---\n" + r2.output[-2000:]
        header = f"{ac.text}\nexpected exit {ac.expect_exit}, got {r.code}\n\n"
        results.append(
            CheckResult(
                ac.id, status, True, r.code, round(r.seconds, 1), ac.command, header + r.output
            )
        )
        if r.stopped:
            break
    return results


def _ac_status(r: proc.Result, expect_exit: int) -> str:
    # Unlike tool checks, exit 127 here means the implementation is missing: a real failure.
    if r.stopped:
        return "unavailable"
    if r.timed_out:
        return "timeout"
    return "passed" if r.code == expect_exit else "failed"


def _classify(chk: dict[str, Any], r: proc.Result) -> str:
    if r.stopped:
        return "unavailable"
    if r.timed_out:
        return "timeout"
    if r.code is None or r.code == 127:
        return "unavailable"
    if r.code == 0:
        return "passed"
    if any(m in r.output for m in chk.get("offline_markers", [])):
        return "unavailable"
    return "failed"


_NOISE = re.compile(r"0x[0-9a-f]+|\d+(\.\d+)?(s|ms)?\b|/tmp/\S+", re.I)


def fingerprint(results: list[CheckResult], extra: list[str] | None = None) -> str:
    h = hashlib.sha256()
    for r in results:
        if r.fixable():
            h.update(r.name.encode() + _NOISE.sub("#", r.output).encode())
    for e in extra or []:
        h.update(e.encode())
    return h.hexdigest()[:16]


def clip(text: str, head: int = 2000, tail: int = 6000) -> str:
    if len(text) <= head + tail:
        return text
    return f"{text[:head]}\n... [{len(text) - head - tail} chars omitted] ...\n{text[-tail:]}"


def to_records(results: list[CheckResult]) -> list[dict[str, Any]]:
    return [{k: v for k, v in asdict(r).items() if k != "output"} for r in results]
