"""Claude Code CLI invocation (`claude -p`) with one persistent session per task.

Flags used (verified against `claude --help`, v2.1.296):
  -p --output-format json   one JSON result object (session_id, total_cost_usd, ...)
  --session-id / --resume   first turn creates the task's session; later turns resume it
  --json-schema             structured end-of-turn status (in `structured_output`)
  --permission-mode dontAsk + --permission-prompts none
                            anything not explicitly allowed is denied, nobody is prompted
  --setting-sources user --strict-mcp-config --disable-slash-commands
                            ignore repo-provided settings/hooks/MCP servers/skills
  --max-budget-usd          spend cap for the call
The full plan is re-sent every turn: no context is assumed to carry over implicitly.
"""

from __future__ import annotations

import json
import os
import shutil
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from . import proc
from .plan import AcceptanceCheck

PROMPTS = Path(__file__).parent / "prompts"

STATUS_SCHEMA = {
    "type": "object",
    "properties": {
        "status": {"type": "string", "enum": ["done", "needs_human", "blocked"]},
        "summary": {"type": "string", "description": "What you changed and why (brief)."},
        "questions": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["status", "summary"],
}

_AUTH_MARKERS = (
    "Invalid API key",
    "Please run /login",
    "authentication_failed",
    "OAuth token",
    "credit balance",
    "billing_error",
    "account_on_hold",
    "oauth_org_not_allowed",
)


@dataclass
class AgentTurn:
    ok: bool
    status: str  # done | needs_human | blocked | error | budget | auth | timeout | stopped
    summary: str = ""
    questions: list[str] = field(default_factory=list)
    cost_usd: float | None = None
    session_seen: bool = False
    raw: str = ""


def new_session_id() -> str:
    return str(uuid.uuid4())


def session_exists(session_id: str) -> bool:
    """True if Claude Code has a saved transcript for this session (so --resume works)."""
    root = Path(os.environ.get("CLAUDE_CONFIG_DIR") or Path.home() / ".claude") / "projects"
    return any(root.glob(f"*/{session_id}.jsonl"))


def plan_block(plan_text: str, sha: str) -> str:
    return f'<approved_plan sha256="{sha}">\n{plan_text.strip()}\n</approved_plan>'


def checks_overview(cfg: dict[str, Any], acceptance: list[AcceptanceCheck] | None = None) -> str:
    lines = []
    for c in cfg.get("checks", []):
        req = "required" if c.get("required", True) else "optional"
        when = f", only if {c['when_changed']} changed" if c.get("when_changed") else ""
        lines.append(f"- {c['name']} ({req}{when}): cd {c.get('cwd', '.')} && {c['cmd']}")
    if cfg.get("acceptance", {}).get("enabled", True):
        for ac in acceptance or []:
            lines.append(
                f"- {ac.id} (required, from the plan; repo root, must exit {ac.expect_exit}): "
                f"{ac.command}"
            )
    return "\n".join(lines)


def build_command(
    cfg: dict[str, Any],
    session_id: str,
    resume: bool,
    budget_usd: float,
    system_prompt: str = "system.md",
    extra: list[str] | None = None,
) -> list[str]:
    """`extra` replaces the model/effort flags, e.g. to run a plugin agent with --agent."""
    a = cfg["agent"]
    exe = shutil.which(a.get("command", "claude")) or a.get("command", "claude")
    cmd = [
        exe,
        "-p",
        "--output-format",
        "json",
        "--json-schema",
        json.dumps(STATUS_SCHEMA),
        "--permission-mode",
        "dontAsk",
        "--permission-prompts",
        "none",
        "--setting-sources",
        "user",
        "--strict-mcp-config",
        "--disable-slash-commands",
        "--append-system-prompt-file",
        str(PROMPTS / system_prompt),
        "--max-budget-usd",
        f"{max(budget_usd, 0.01):.2f}",
        "--allowedTools",
        ",".join(a.get("allowed_tools", [])),
        "--disallowedTools",
        ",".join(a.get("disallowed_tools", [])),
    ]
    cmd += ["--resume", session_id] if resume else ["--session-id", session_id]
    if extra is not None:
        return cmd + extra
    if a.get("model"):
        cmd += ["--model", a["model"]]
    if a.get("effort"):
        cmd += ["--effort", a["effort"]]
    return cmd


def parse_result(r: proc.Result) -> AgentTurn:
    if r.stopped:
        return AgentTurn(False, "stopped", raw=r.output)
    if r.timed_out:
        return AgentTurn(False, "timeout", raw=r.output)
    data = None
    for line in reversed(r.output.splitlines()):
        line = line.strip()
        if line.startswith("{"):
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            if obj.get("type") == "result":
                data = obj
                break
    if data is None:
        status = "auth" if any(m in r.output for m in _AUTH_MARKERS) else "error"
        return AgentTurn(False, status, summary=r.output[-1500:], raw=r.output)

    cost = data.get("total_cost_usd")
    text = str(data.get("result") or "")
    subtype = str(data.get("subtype") or "")
    if "budget" in subtype:
        return AgentTurn(False, "budget", text, cost_usd=cost, session_seen=True, raw=r.output)
    if data.get("is_error") or r.code != 0:
        status = "auth" if any(m in text + r.output for m in _AUTH_MARKERS) else "error"
        return AgentTurn(
            False, status, text or subtype, cost_usd=cost, session_seen=True, raw=r.output
        )
    so = data.get("structured_output") or {}
    reported = str(so.get("status") or "")
    final = reported if reported in ("done", "needs_human", "blocked") else "done"
    return AgentTurn(
        True,
        final,
        so.get("summary") or text[:2000],
        list(so.get("questions") or []),
        cost_usd=cost,
        session_seen=True,
        raw=r.output,
    )


def invoke(
    cfg: dict[str, Any],
    worktree: Path,
    prompt: str,
    session_id: str,
    resume: bool,
    budget_usd: float,
    timeout: float,
    transcript: Path,
    system_prompt: str = "system.md",
    extra: list[str] | None = None,
) -> AgentTurn:
    cmd = build_command(cfg, session_id, resume, budget_usd, system_prompt, extra)
    r = proc.run(cmd, worktree, proc.scrubbed_env(), timeout, stdin=prompt)
    transcript.parent.mkdir(parents=True, exist_ok=True)
    transcript.write_text(
        f"$ {' '.join(cmd[:2])} ... (session {session_id})\n\n"
        f"--- prompt ---\n{prompt}\n\n--- output (exit {r.code}) ---\n{r.output}"
    )
    return parse_result(r)
