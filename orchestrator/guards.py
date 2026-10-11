"""Diff policy checks that run alongside verification on every iteration.

Violations are either `fixable` (sent back to the agent, e.g. "remove this skip marker")
or need a human (the task pauses). Plans can pre-approve some kinds under `## Approvals`:
`destructive-migration`, `test-removal`, `lint-suppression`.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from . import proc
from .plan import Plan
from .verify import matches


@dataclass
class Violation:
    kind: str
    path: str
    detail: str
    fixable: bool

    def __str__(self) -> str:
        return f"[{self.kind}] {self.path}: {self.detail}"


_SUPPRESS = re.compile(
    r"pytest\.mark\.(skip|skipif|xfail)|pytest\.(skip|xfail)\(|unittest\.skip|@skip\b"
    r"|#\s*noqa|#\s*type:\s*ignore|#\s*pragma:\s*no cover|--deselect"
)
_DESTRUCTIVE_SQL = re.compile(
    r"\b(drop\s+(table|column|schema|database)|truncate\b|delete\s+from"
    r"|alter\s+table\b.*\b(drop|alter\s+column\s+\S+\s+(set\s+data\s+)?type)\b)",
    re.I,
)
_TEST_DEF = re.compile(r"^\s*(async\s+)?def\s+(test_\w+)")


def _split_diff(diff: str) -> dict[str, tuple[list[str], list[str]]]:
    """path -> (added lines, removed lines)."""
    files: dict[str, tuple[list[str], list[str]]] = {}
    cur: tuple[list[str], list[str]] | None = None
    for line in diff.splitlines():
        if line.startswith("diff --git "):
            path = line.split(" b/", 1)[-1]
            cur = files.setdefault(path, ([], []))
        elif cur is None or line.startswith(("+++", "---")):
            continue
        elif line.startswith("+"):
            cur[0].append(line[1:])
        elif line.startswith("-"):
            cur[1].append(line[1:])
    return files


def check(
    cfg: dict[str, Any], worktree: Path, base_sha: str, changed: list[tuple[str, str]], plan: Plan
) -> tuple[list[Violation], list[str]]:
    g = cfg.get("guards", {})
    approvals = plan.approvals
    out: list[Violation] = []
    warnings: list[str] = []

    if not changed:
        return [Violation("empty", "-", "no changes were made; implement the plan", True)], []

    diff = _split_diff(proc.git(worktree, "diff", "--cached", "-U0", "--no-renames", base_sha))
    tests = g.get("test_globs", [])

    for status, path in changed:
        added, removed = diff.get(path, ([], []))
        if matches(path, g.get("protected", [])):
            out.append(
                Violation(
                    "protected",
                    path,
                    "protected file changed; revert it (if the "
                    "plan truly requires it, report needs_human)",
                    True,
                )
            )
        if plan.allowed_paths and not matches(path, plan.allowed_paths):
            out.append(
                Violation(
                    "scope",
                    path,
                    "outside the plan's Allowed paths; revert it "
                    "(or report needs_human if the plan cannot be met otherwise)",
                    True,
                )
            )
        if matches(path, g.get("secret_file_globs", [])) and not matches(
            path, g.get("secret_file_allow", [])
        ):
            out.append(
                Violation(
                    "secret-file",
                    path,
                    "credential/env file must not be committed; delete it",
                    True,
                )
            )

        is_test = matches(path, tests)
        if is_test and status == "D" and "test-removal" not in approvals:
            out.append(Violation("test-removal", path, "test file deleted", False))
        if path.endswith(".py") and "lint-suppression" not in approvals:
            for line in added:
                if _SUPPRESS.search(line):
                    out.append(
                        Violation(
                            "suppression",
                            path,
                            f"adds a skip/suppression: "
                            f"{line.strip()[:120]!r}; fix the cause instead",
                            True,
                        )
                    )
        if is_test and "test-removal" not in approvals:
            gone = {m.group(2) for ln in removed if (m := _TEST_DEF.match(ln))}
            back = {m.group(2) for ln in added if (m := _TEST_DEF.match(ln))}
            for name in sorted(gone - back):
                out.append(Violation("test-removal", path, f"removes test {name}", False))
            dropped = sum(1 for ln in removed if ln.strip().startswith("assert"))
            if dropped > sum(1 for ln in added if ln.strip().startswith("assert")):
                warnings.append(
                    f"{path}: net removal of assert statements; review the test changes"
                )

        if matches(path, g.get("migration_globs", [])) and "destructive-migration" not in approvals:
            if status == "M":
                out.append(Violation("migration", path, "edits an existing migration", False))
            for line in added:
                if _DESTRUCTIVE_SQL.search(line):
                    out.append(
                        Violation(
                            "migration", path, f"destructive SQL: {line.strip()[:120]!r}", False
                        )
                    )
        if path.endswith(("requirements.txt", "package.json")) and status != "D":
            new = [ln.strip() for ln in added if ln.strip() and not ln.strip().startswith("#")]
            if new:
                warnings.append(f"{path}: dependency changes {new[:5]}; review supply-chain impact")
    return out, warnings
