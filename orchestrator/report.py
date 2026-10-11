"""Human-facing summaries: terminal status and the PR body."""

from __future__ import annotations

import re

from .plan import Plan
from .state import TaskState, total_cost

_ICON = {
    "passed": "✅",
    "failed": "❌",
    "flaky": "⚠️ flaky",
    "unavailable": "⚠️ unavailable",
    "skipped": "➖ skipped",
    "timeout": "❌ timeout",
}


def checks_table(st: TaskState) -> str:
    rows = ["| Check | Result | Required | Time |", "|---|---|---|---|"]
    for c in st.last_verification:
        rows.append(
            f"| `{c['name']}` | {_ICON.get(c['status'], c['status'])} | "
            f"{'yes' if c['required'] else 'no'} | {c['seconds']}s |"
        )
    return "\n".join(rows)


_SIMPLIFY = {
    "applied": "applied (re-verified: all checks pass)",
    "no_changes": "ran; no changes needed",
    "reverted": "changes discarded",
    "skipped": "skipped",
    "disabled": "disabled for this task",
}


def simplify_line(st: TaskState) -> str:
    if not st.simplify:
        return ""
    note = f": {st.simplify_note}" if st.simplify_note else ""
    return f"{_SIMPLIFY.get(st.simplify, st.simplify)}{note}"


def _first_para(text: str) -> str:
    return re.split(r"\n\s*\n", text.strip(), maxsplit=1)[0]


def pr_body(st: TaskState, plan: Plan) -> str:
    risks = list(st.warnings)
    not_passed = [
        c["name"]
        for c in st.last_verification
        if not c["required"] and c["status"] not in ("passed", "skipped")
    ]
    if not_passed:
        risks.append(f"optional checks not passing: {', '.join(not_passed)}")
    risk_md = "\n".join(f"- {r}" for r in risks) or "- none flagged by the orchestrator"
    manual_md = ""
    if plan.manual_checks:
        manual_md = (
            "\n## Manual checks for the reviewer (not run automatically)\n"
            + "\n".join(f"- [ ] {m}" for m in plan.manual_checks)
            + "\n"
        )
    return f"""## Objective
{_first_para(plan.sections["objective"])}

## What the agent did
{st.agent_summary or "(no summary)"}

## Verification (run locally by the orchestrator, outside the agent)
{checks_table(st)}

- Agent turns: {st.agent_calls} (remediations: {st.remediations}), est. cost ${total_cost(st):.2f}
- Simplification (code-simplifier plugin): {simplify_line(st) or "not configured"}
- Base: `{st.base}` @ `{st.base_sha[:10]}` · plan sha256 `{st.plan_sha256[:16]}`

## Risks / review notes
{risk_md}
{manual_md}
<details><summary>Approved plan</summary>

{plan.text.strip()}

</details>

---
Opened by the local plan orchestrator (task `{st.id}`).
**Not merged or deployed: needs human review.**
"""


def status_text(st: TaskState) -> str:
    lines = [
        f"Task     {st.id}",
        f"Title    {st.title}",
        f"Status   {st.status}" + (f" — {st.reason}" if st.reason else ""),
        f"Stage    {st.stage}",
        f"Branch   {st.branch} (base {st.base}@{st.base_sha[:10]})",
        f"Worktree {st.worktree}",
        f"Agent    {st.agent_calls} turns, {st.remediations} remediations, "
        f"${total_cost(st):.2f}, {st.elapsed_seconds / 60:.1f} min",
    ]
    if st.simplify:
        lines.append(f"Simplify {simplify_line(st)[:300]}")
    if st.commit_sha:
        lines.append(f"Commit   {st.commit_sha[:12]}")
    if st.pr_url:
        lines.append(f"PR       {st.pr_url}")
    if st.last_verification:
        lines.append(
            "Checks   " + ", ".join(f"{c['name']}={c['status']}" for c in st.last_verification)
        )
    if st.questions:
        lines.append("Questions from the agent:")
        lines += [f"  - {q}" for q in st.questions]
    if st.warnings:
        lines.append("Warnings:")
        lines += [f"  - {w}" for w in st.warnings]
    nxt = {
        "awaiting_ship": f"review: git -C {st.worktree} diff {st.base_sha[:10]} --stat; "
        f"then: python3 -m orchestrator ship {st.id}",
        "needs_human": f"resolve, then: python3 -m orchestrator resume {st.id}"
        + (" --answer '...'" if st.stage == "answering" else ""),
        "failed": f"inspect logs; to retry: python3 -m orchestrator resume {st.id} "
        "[--max-remediations N --budget USD]",
        "stopped": f"python3 -m orchestrator resume {st.id}",
        "shipped": "review and merge the PR manually",
    }.get(st.status)
    if nxt:
        lines.append(f"Next     {nxt}")
    return "\n".join(lines)
