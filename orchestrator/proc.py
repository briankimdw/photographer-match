"""Subprocess helpers: scrubbed environments, timeouts, and cooperative stop."""

from __future__ import annotations

import os
import signal
import subprocess
import tempfile
import threading
import time
from dataclasses import dataclass
from pathlib import Path

# Set by the SIGINT/SIGTERM handler (`orchestrator stop` sends SIGINT).
STOP = threading.Event()

# Only these variables reach the agent and verification commands. Everything else
# (API keys, GH_TOKEN, SSH_AUTH_SOCK, cloud credentials, ...) is dropped.
_ENV_ALLOW = {
    "PATH",
    "HOME",
    "USER",
    "LOGNAME",
    "SHELL",
    "LANG",
    "LANGUAGE",
    "TERM",
    "TZ",
    "TMPDIR",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_STATE_HOME",
    "XDG_CACHE_HOME",
    "CLAUDE_CONFIG_DIR",
    "NVM_DIR",
    "NVM_BIN",
}
RECURSION_VAR = "ORCHESTRATOR_ACTIVE"


def scrubbed_env(extra: dict[str, str] | None = None) -> dict[str, str]:
    env = {k: v for k, v in os.environ.items() if k in _ENV_ALLOW or k.startswith("LC_")}
    env[RECURSION_VAR] = "1"
    env.update(extra or {})
    return env


@dataclass
class Result:
    code: int | None  # None: did not run (missing executable)
    output: str
    seconds: float
    timed_out: bool = False
    stopped: bool = False


def _signal_group(p: subprocess.Popen[bytes], sig: int) -> None:
    try:
        os.killpg(p.pid, sig)
    except ProcessLookupError:
        pass


def run(
    cmd: list[str],
    cwd: Path,
    env: dict[str, str] | None,
    timeout: float,
    stdin: str | None = None,
) -> Result:
    """Run cmd in its own process group; stdout+stderr combined. Honors STOP and timeout.

    On stop/timeout the group gets SIGINT first (Claude Code ends its turn cleanly on it),
    then SIGTERM, then SIGKILL.
    """
    start = time.monotonic()
    with tempfile.TemporaryFile() as out:
        try:
            p = subprocess.Popen(
                cmd,
                cwd=cwd,
                env=env,
                stdin=subprocess.PIPE if stdin is not None else subprocess.DEVNULL,
                stdout=out,
                stderr=subprocess.STDOUT,
                start_new_session=True,
            )
        except (FileNotFoundError, PermissionError) as e:
            return Result(None, f"cannot execute {cmd[0]!r}: {e}", 0.0)
        if stdin is not None and p.stdin:
            try:
                p.stdin.write(stdin.encode())
                p.stdin.close()
            except BrokenPipeError:
                pass
        timed_out = stopped = False
        while p.poll() is None:
            if STOP.is_set() or time.monotonic() - start > timeout:
                stopped = STOP.is_set()
                timed_out = not stopped
                for sig, grace in ((signal.SIGINT, 30), (signal.SIGTERM, 10), (signal.SIGKILL, 5)):
                    _signal_group(p, sig)
                    try:
                        p.wait(grace)
                        break
                    except subprocess.TimeoutExpired:
                        continue
                break
            time.sleep(0.2)
        p.wait()
        out.seek(0)
        text = out.read().decode(errors="replace")
    return Result(p.returncode, text, time.monotonic() - start, timed_out, stopped)


def git(repo: Path, *args: str, check: bool = True) -> str:
    """Run git with the user's normal environment (the orchestrator, not the agent)."""
    r = subprocess.run(
        ["git", *args], cwd=repo, capture_output=True, text=True, env={**os.environ, "LC_ALL": "C"}
    )
    if check and r.returncode != 0:
        raise GitError(f"git {' '.join(args)} failed: {r.stderr.strip() or r.stdout.strip()}")
    return r.stdout.strip()


class GitError(RuntimeError):
    pass
