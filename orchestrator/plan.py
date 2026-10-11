"""Approved-plan parsing and validation. The orchestrator never invents a plan.

Two formats are accepted:
- plan: `plans/TEMPLATE.md` (named `## Objective` ... sections, a `Status: approved` line)
- spec: written by the `/spec` skill (`.claude/skills/spec/`): numbered `## 1.` ... `## 13.`
  sections and a `- status: approved` header line
Both are normalised into the same `sections` keys. Acceptance criteria written as
"AC-n: `command`" become required verification checks.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from pathlib import Path

REQUIRED_SECTIONS = (
    "objective",
    "scope",
    "acceptance criteria",
    "design constraints",
    "required tests",
)
_PLACEHOLDER = re.compile(r"^\s*(?:[-*]\s*)?(?:todo|tbd|\.\.\.|n/?a|<.*>)?\s*$", re.I)
_APPROVED = re.compile(r"^\s*\**status\**\s*:\s*\**approved\**\s*$", re.I | re.M)
_SPEC_STATUS = re.compile(r"^-\s*status:\s*(\S+)", re.I | re.M)
_TEMPLATE_SLOT = re.compile(r"^\s*(?:[-*]\s+)?(?:D-\d+:\s*|T-\d+:\s*)?\{[^}]*\}")
_AC_LINE = re.compile(r"^\s*[-*]\s+(?:\[.\]\s+)?(AC-\d+[a-z]?)\s*:\s*(.+?)\s*$", re.M)
_AC_COMMAND = re.compile(r"^`([^`]+)`")
_AC_EXIT = re.compile(r"\(exit\s+(\d+)\)\s*$")
# spec section number -> normalised section(s) it feeds
_SPEC_MAP = {
    "objective": (1,),
    "scope": (3,),
    "acceptance criteria": (11,),
    "required tests": (11,),
    "design constraints": (7, 8, 9, 10),
}
_SPEC_REQUIRED = (1, 3, 11)


class PlanError(ValueError):
    pass


@dataclass
class AcceptanceCheck:
    id: str
    command: str
    expect_exit: int
    text: str


@dataclass
class Plan:
    title: str
    text: str
    sha256: str
    sections: dict[str, str]
    format: str = "plan"
    allowed_paths: list[str] = field(default_factory=list)
    approvals: set[str] = field(default_factory=set)
    acceptance: list[AcceptanceCheck] = field(default_factory=list)
    manual_checks: list[str] = field(default_factory=list)


def _bullets(body: str) -> list[str]:
    """First token of each bullet: '- `backend/api/**` (why)' -> 'backend/api/**'.
    Unfilled template slots ('- {glob, e.g. ...}') are ignored."""
    items = []
    for line in body.splitlines():
        m = re.match(r"^\s*[-*]\s+`?([^`\s]+)", line)
        if m and not m.group(1).startswith("{"):
            items.append(m.group(1))
    return items


def _outside_fences(body: str) -> list[str]:
    """Lines outside ``` / ~~~ fenced code blocks: examples there (e.g. JSON objects)
    are not template slots."""
    lines, fence = [], ""
    for line in body.splitlines():
        m = re.match(r"^\s*(`{3,}|~{3,})", line)
        if m and not fence:
            fence = m.group(1)
        elif m and m.group(1).startswith(fence):
            fence = ""
        elif not fence:
            lines.append(line)
    return lines


def _subsection(text: str, name: str) -> str:
    m = re.search(rf"^###\s+{re.escape(name)}\s*$(.*?)(?=^##|\Z)", text, re.I | re.M | re.S)
    return m.group(1).strip() if m else ""


def _acceptance(body: str) -> tuple[list[AcceptanceCheck], list[str]]:
    checks, manual = [], []
    for ac_id, rest in _AC_LINE.findall(body):
        cmd = _AC_COMMAND.match(rest)
        if cmd and not cmd.group(1).startswith("{"):
            exit_m = _AC_EXIT.search(rest)
            code = int(exit_m.group(1)) if exit_m else 0
            checks.append(AcceptanceCheck(ac_id, cmd.group(1), code, rest))
        else:
            manual.append(f"{ac_id}: {rest}")
    return checks, manual


def _parse_spec(visible: str) -> dict[str, str]:
    status_m = _SPEC_STATUS.search(visible)
    status = status_m.group(1).lower() if status_m else "missing"
    if status != "approved":
        raise PlanError(
            f"spec status is '{status}', not 'approved': finish and approve it with /spec first"
        )
    numbered: dict[int, str] = {}
    parts = re.split(r"^##\s+(\d+)\.[^\n]*$", visible, flags=re.M)
    for num, body in zip(parts[1::2], parts[2::2], strict=True):
        numbered[int(num)] = body.strip()

    problems = [f"missing section '## {n}.'" for n in range(1, 13) if n not in numbered]
    for n in _SPEC_REQUIRED:
        body = numbered.get(n, "")
        if n in numbered and all(_PLACEHOLDER.match(line) for line in body.splitlines()):
            problems.append(f"section {n} is empty")
    for n in range(1, 13):
        slots = [ln for ln in _outside_fences(numbered.get(n, "")) if _TEMPLATE_SLOT.match(ln)]
        if slots:
            problems.append(f"section {n} still has a template slot: {slots[0].strip()[:60]!r}")
    if re.search(r"Unconfirmed \(to ask before Gate B\)", visible):
        problems.append("§12 still says 'Unconfirmed (to ask before Gate B)'")
    if problems:
        raise PlanError("spec is incomplete: " + "; ".join(problems))

    sections = {
        key: "\n\n".join(numbered[n] for n in nums if numbered.get(n))
        for key, nums in _SPEC_MAP.items()
    }
    for n, body in numbered.items():
        sections[f"§{n}"] = body
    return sections


def _parse_plan_format(visible: str) -> dict[str, str]:
    if not _APPROVED.search(visible):
        raise PlanError(
            "plan is not approved: add a line 'Status: approved' once you have reviewed it"
        )
    sections: dict[str, str] = {}
    parts = re.split(r"^##\s+(.+?)\s*$", visible, flags=re.M)
    for name, body in zip(parts[1::2], parts[2::2], strict=True):
        sections[name.strip().lower()] = body.strip()

    problems = []
    for req in REQUIRED_SECTIONS:
        body = sections.get(req)
        if body is None:
            problems.append(f"missing section '## {req.title()}'")
        elif all(_PLACEHOLDER.match(line) for line in body.splitlines()):
            problems.append(f"section '## {req.title()}' is empty or a placeholder")
    if problems:
        raise PlanError("plan is incomplete: " + "; ".join(problems))
    return sections


def parse_plan(text: str) -> Plan:
    # HTML comments are guidance for the author, never part of the plan's content.
    visible = re.sub(r"<!--.*?-->", "", text, flags=re.DOTALL)
    title_m = re.search(r"^#\s+(.+?)\s*$", visible, re.M)
    if not title_m or title_m.group(1).startswith(("<", "{")):
        raise PlanError("plan has no '# Title' heading (or still has the template placeholder)")

    is_spec = bool(_SPEC_STATUS.search(visible) and re.search(r"^##\s+1\.", visible, re.M))
    if is_spec:
        sections = _parse_spec(visible)
        allowed = _bullets(_subsection(visible, "Allowed paths"))
        approvals = _bullets(_subsection(visible, "Approvals"))
    else:
        sections = _parse_plan_format(visible)
        allowed = _bullets(sections.get("allowed paths", ""))
        approvals = _bullets(sections.get("approvals", ""))

    checks, manual = _acceptance(sections["acceptance criteria"])
    return Plan(
        title=title_m.group(1),
        text=text,
        sha256=hashlib.sha256(text.encode()).hexdigest(),
        sections=sections,
        format="spec" if is_spec else "plan",
        allowed_paths=allowed,
        approvals={a.lower() for a in approvals},
        acceptance=checks,
        manual_checks=manual,
    )


def load_plan(path: Path) -> Plan:
    if not path.is_file():
        raise PlanError(f"plan file not found: {path}")
    return parse_plan(path.read_text(encoding="utf-8"))


def slugify(title: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
    return slug[:40].rstrip("-") or "task"
