"""Task lifecycle: create -> implement -> verify/remediate (bounded) -> await ship -> ship."""

from __future__ import annotations

import json
import os
import shutil
import signal
import time
from pathlib import Path
from typing import Any

from . import agent, guards, proc, ship, verify
from .plan import Plan, PlanError, load_plan, parse_plan, slugify
from .state import RepoLock, Store, TaskState, total_cost

EXIT_OK, EXIT_FAILED, EXIT_NEEDS_HUMAN, EXIT_STOPPED = 0, 1, 3, 130


class Orchestrator:
    def __init__(self, repo: Path, cfg: dict[str, Any]) -> None:
        self.repo = repo
        self.cfg = cfg
        self.store = Store(repo)

    # ---------- helpers ----------

    def limits(self, st: TaskState) -> dict[str, Any]:
        return {**self.cfg.get("limits", {}), **st.limits}

    def plan_of(self, st: TaskState) -> Plan:
        """The frozen copy recorded at start; edits to the original don't leak in."""
        text = (self.store.task_dir(st.id) / "plan.md").read_text(encoding="utf-8")
        plan = parse_plan(text)
        if plan.sha256 != st.plan_sha256:
            raise SystemExit(f"frozen plan for {st.id} was modified; refusing to continue")
        return plan

    def log(self, st: TaskState, event: str, **data: Any) -> None:
        self.store.log(st.id, event, **data)

    def finish(self, st: TaskState, status: str, reason: str = "", stage: str | None = None) -> int:
        st.status, st.reason = status, reason
        if stage:
            st.stage = stage
        st.pid = 0
        self.store.save(st)
        self.log(st, status, msg=reason or status)
        return {
            "failed": EXIT_FAILED,
            "needs_human": EXIT_NEEDS_HUMAN,
            "stopped": EXIT_STOPPED,
        }.get(status, EXIT_OK)

    # ---------- start ----------

    def create(
        self,
        plan_path: Path,
        auto_ship: bool,
        limits: dict[str, Any],
        base: str | None,
        simplify: bool = True,
    ) -> TaskState:
        try:
            plan = load_plan(plan_path)
        except PlanError as e:
            raise SystemExit(f"refusing to start: {e}") from None
        if not shutil.which(self.cfg["agent"].get("command", "claude")):
            raise SystemExit(f"Claude Code CLI not found: {self.cfg['agent'].get('command')}")

        g = self.cfg["git"]
        base = base or g.get("base", "main")
        base_sha = proc.git(self.repo, "rev-parse", "--verify", f"{base}^{{commit}}")
        dirty = proc.git(self.repo, "status", "--porcelain")

        task_id = time.strftime("%Y%m%d-%H%M%S-") + slugify(plan.title)
        branch = g.get("branch_prefix", "orch/") + slugify(plan.title)
        n = 2
        while proc.git(
            self.repo, "rev-parse", "--verify", "-q", f"refs/heads/{branch}", check=False
        ):
            branch = f"{g.get('branch_prefix', 'orch/')}{slugify(plan.title)}-{n}"
            n += 1
        worktree = (
            self.repo.parent / g.get("worktree_root", f"{self.repo.name}.worktrees") / task_id
        )
        worktree.parent.mkdir(parents=True, exist_ok=True)
        # New branch in a separate worktree: the main checkout (and any uncommitted work in it)
        # is never touched.
        proc.git(self.repo, "worktree", "add", "-q", "-b", branch, str(worktree), base_sha)

        st = TaskState(
            id=task_id,
            title=plan.title,
            plan_source=str(plan_path.resolve()),
            plan_sha256=plan.sha256,
            branch=branch,
            base=base,
            base_sha=base_sha,
            worktree=str(worktree),
            session_id=agent.new_session_id(),
            auto_ship=auto_ship,
            limits=limits,
            simplify="" if simplify else "disabled",
        )
        d = self.store.task_dir(task_id)
        d.mkdir(parents=True, exist_ok=True)
        (d / "plan.md").write_text(plan.text, encoding="utf-8")
        self.store.save(st)
        self.log(
            st,
            "created",
            branch=branch,
            worktree=str(worktree),
            base=f"{base}@{base_sha[:10]}",
            plan_sha256=plan.sha256[:16],
        )
        if dirty:
            self.log(
                st,
                "note",
                msg="main checkout has uncommitted changes; they are untouched "
                "and NOT part of this task (the task starts from the committed base)",
            )
        return st

    # ---------- run loop ----------

    def run(self, st: TaskState) -> int:
        with RepoLock(self.store):
            old = {
                s: signal.signal(s, lambda *_: proc.STOP.set())
                for s in (signal.SIGINT, signal.SIGTERM)
            }
            try:
                return self._loop(st)
            finally:
                for s, h in old.items():
                    signal.signal(s, h)

    def _loop(self, st: TaskState) -> int:
        plan = self.plan_of(st)
        lim = self.limits(st)
        wt = Path(st.worktree)
        if not wt.is_dir():
            return self.finish(st, "failed", f"worktree missing: {wt}")
        st.pid, st.status = os.getpid(), st.stage
        self.store.save(st)
        tick = time.monotonic()

        while True:
            now = time.monotonic()
            st.elapsed_seconds += now - tick
            tick = now
            self.store.save(st)
            if proc.STOP.is_set():
                return self.finish(st, "stopped", "stopped by user")
            if st.elapsed_seconds > lim["task_timeout_minutes"] * 60:
                return self.finish(st, "failed", "task time limit reached")
            remaining = lim["max_budget_usd"] - total_cost(st)
            if remaining <= 0 and st.stage in ("implementing", "remediating", "answering"):
                return self.finish(st, "failed", f"budget exhausted (${total_cost(st):.2f})")

            if st.stage in ("implementing", "remediating", "answering"):
                rc = self._agent_turn(st, plan, lim, remaining)
                if rc is not None:
                    return rc
            elif st.stage == "verifying":
                rc = self._verify(st, plan, lim)
                if rc is not None:
                    return rc
            elif st.stage == "simplifying":
                rc = self._simplify(st, plan, lim)
                if rc is not None:
                    return rc
            elif st.stage == "awaiting_ship":
                return self.ship(st) if st.auto_ship else self.finish(st, "awaiting_ship")
            elif st.stage in ("shipping", "shipped"):
                return self.ship(st)
            else:
                return self.finish(st, "failed", f"unknown stage {st.stage}")

    def _setup_if_needed(self, st: TaskState, lim: dict[str, Any]) -> proc.Result | None:
        wt = Path(st.worktree)
        h = verify.setup_hash(self.cfg, wt)
        if h == st.setup_hash:
            return None
        self.log(st, "setup", msg="installing verification environment")
        fail = verify.run_setup(self.cfg, wt, lim["check_timeout_seconds"])
        if fail is None:
            st.setup_hash = h
        return fail

    def _agent_turn(
        self, st: TaskState, plan: Plan, lim: dict[str, Any], remaining: float
    ) -> int | None:
        wt = Path(st.worktree)
        if not st.setup_hash:
            fail = self._setup_if_needed(st, lim)
            if fail:
                return self.finish(
                    st,
                    "needs_human",
                    "initial environment setup failed:\n" + verify.clip(fail.output, 500, 1500),
                    stage="implementing",
                )
        prompt = self._prompt(st, plan, lim)
        n = st.agent_calls + 1
        self.log(st, "agent", msg=f"turn {n} ({st.stage}), budget left ${remaining:.2f}")

        def call() -> agent.AgentTurn:
            resume = st.session_started or agent.session_exists(st.session_id)
            return agent.invoke(
                self.cfg,
                wt,
                prompt,
                st.session_id,
                resume=resume,
                budget_usd=remaining,
                timeout=lim["agent_timeout_minutes"] * 60,
                transcript=self.store.task_dir(st.id) / f"agent-{n:02d}.txt",
            )

        turn = call()
        if turn.status == "error" and "No conversation found" in turn.raw:
            # Transcript gone (e.g. purged): start a fresh session. Nothing is lost because
            # every prompt carries the full plan and the latest failures.
            self.log(st, "note", msg="session not found; starting a new session")
            st.session_id, st.session_started = agent.new_session_id(), False
            turn = call()
        st.agent_calls = n
        if turn.session_seen:
            st.session_started = True
        if turn.cost_usd is not None:
            # --resume reports the whole conversation's total, so take the max.
            st.cost_usd = max(st.cost_usd, float(turn.cost_usd))
        self.log(
            st,
            "agent_result",
            status=turn.status,
            cost_usd=round(st.cost_usd, 4),
            summary=turn.summary[:300],
        )
        if st.stage == "answering":
            st.pending_answer = ""

        if turn.status == "stopped":
            return self.finish(st, "stopped", "stopped by user during agent turn")
        if turn.status == "budget":
            return self.finish(st, "failed", f"budget exhausted (${total_cost(st):.2f})")
        if turn.status == "auth":
            return self.finish(
                st,
                "needs_human",
                f"Claude Code authentication/billing problem (not retried): {turn.summary[:300]}",
            )
        if turn.status == "error":
            return self.finish(
                st, "failed", f"agent error (see agent-{n:02d}.txt): {turn.summary[:300]}"
            )
        if turn.status in ("needs_human", "blocked"):
            st.questions = turn.questions
            st.agent_summary = turn.summary
            return self.finish(
                st,
                "needs_human",
                f"agent reported {turn.status}: {turn.summary[:500]}",
                stage="answering",
            )
        if turn.status == "timeout":
            st.warnings.append(f"agent turn {n} hit the time limit; verifying what it left")
        st.agent_summary = turn.summary or st.agent_summary
        st.questions = []
        st.stage = "verifying"
        return None

    def _prompt(self, st: TaskState, plan: Plan, lim: dict[str, Any]) -> str:
        pb = agent.plan_block(plan.text, plan.sha256)
        header = (
            f"Task {st.id}. Working directory: {st.worktree} "
            f"(git worktree, branch {st.branch}, base {st.base}).\n"
        )
        if st.stage == "implementing":
            return (
                header + "Implement the approved plan below, including its required tests.\n\n"
                f"{pb}\n\nAfter your turn the orchestrator independently runs:\n"
                f"{agent.checks_overview(self.cfg, plan.acceptance)}\n"
                "Run the relevant checks yourself before finishing, then report your status."
            )
        if st.stage == "answering":
            return (
                header + "A human answered your questions. Their answer is authoritative "
                "for the points it covers; the plan still applies otherwise.\n\n"
                f"<human_answer>\n{st.pending_answer}\n</human_answer>\n\n"
                f"{pb}\n\nContinue implementing, run the checks, and report your status."
            )
        failures = (self.store.task_dir(st.id) / "last_failures.md").read_text(encoding="utf-8")
        return (
            header + f"Independent verification after your last turn FAILED "
            f"(remediation {st.remediations} of {lim['max_remediations']}).\n"
            "Diagnose the root cause of each failure and fix it within the approved plan. "
            "Do not weaken or skip tests or add suppressions. If the fix needs anything "
            "outside the plan, report needs_human.\n\n"
            f"{failures}\n\nThe approved plan, unchanged:\n{pb}"
        )

    def _verify(self, st: TaskState, plan: Plan, lim: dict[str, Any]) -> int | None:
        wt = Path(st.worktree)
        suffix = "-simplified" if st.simplify == "checking" else ""
        it = self.store.task_dir(st.id) / f"verify-{st.agent_calls:02d}{suffix}"
        it.mkdir(parents=True, exist_ok=True)

        setup_fail = self._setup_if_needed(st, lim)
        tree = verify.stage_all(wt)
        changed = verify.changed_files(wt, st.base_sha)
        if setup_fail:
            results = [
                verify.CheckResult(
                    "setup",
                    "failed",
                    True,
                    setup_fail.code,
                    round(setup_fail.seconds, 1),
                    "setup",
                    setup_fail.output,
                )
            ]
        else:
            self.log(st, "verify", msg=f"{len(changed)} changed files; running checks")
            results = verify.run_checks(self.cfg, wt, changed, lim["check_timeout_seconds"])
            if plan.acceptance and self.cfg.get("acceptance", {}).get("enabled", True):
                results += verify.run_acceptance(plan.acceptance, wt, lim["check_timeout_seconds"])
        if proc.STOP.is_set():
            return self.finish(st, "stopped", "stopped by user during verification")
        violations, warnings = guards.check(self.cfg, wt, st.base_sha, changed, plan)

        for r in results:
            (it / f"{r.name}.log").write_text(f"$ {r.command}\nexit {r.code}\n\n{r.output}")
        st.last_verification = verify.to_records(results)
        (it / "summary.json").write_text(
            json.dumps(
                {
                    "tree": tree,
                    "checks": st.last_verification,
                    "violations": [str(v) for v in violations],
                    "warnings": warnings,
                },
                indent=2,
            )
        )
        st.warnings = sorted(set(st.warnings) | set(warnings))
        for r in results:
            self.log(
                st, "check", name=r.name, status=r.status, required=r.required, seconds=r.seconds
            )
        for v in violations:
            self.log(st, "guard", msg=str(v))

        fixable = [r for r in results if r.required and r.fixable()]
        fix_viol = [v for v in violations if v.fixable]
        human = [r for r in results if r.blocks_success() and not r.fixable()]
        human_viol = [v for v in violations if not v.fixable]

        if st.simplify == "checking":
            # The simplifier is optional polish: it never costs a remediation attempt and
            # never blocks the task. Any failure discards its changes.
            if not (human or human_viol or fixable or fix_viol):
                st.simplify, st.verified_tree, st.stage = "applied", tree, "awaiting_ship"
                self.log(st, "simplify", msg=f"simplification kept; checks pass (tree {tree[:12]})")
                return None
            bad = [f"{r.name}: {r.status}" for r in human + fixable] + [
                str(v) for v in human_viol + fix_viol
            ]
            self._revert_simplify(st, "checks failed after simplification: " + "; ".join(bad))
            return None

        if human or human_viol:
            lines = [f"check {r.name}: {r.status}" for r in human] + [str(v) for v in human_viol]
            return self.finish(
                st,
                "needs_human",
                "verification needs a human:\n  " + "\n  ".join(lines),
                stage="verifying",
            )
        if not fixable and not fix_viol:
            st.verified_tree = tree
            st.stage = "awaiting_ship"
            self.log(st, "verified", msg=f"all required checks passed (tree {tree[:12]})")
            if st.simplify == "" and self.cfg.get("simplify", {}).get("enabled", False):
                st.pre_simplify_tree = tree
                st.pre_simplify_files = [p for s, p in changed if s != "D"]
                st.pre_simplify_verification = st.last_verification
                st.stage = "simplifying"
            return None

        fp = verify.fingerprint(fixable, [str(v) for v in fix_viol])
        if st.remediations >= lim["max_remediations"]:
            return self.finish(
                st,
                "failed",
                f"retry limit reached ({st.remediations} remediations); checks still failing",
                stage="remediating",
            )
        if lim.get("stop_on_repeated_failure", True) and fp == st.last_failure_fingerprint:
            return self.finish(
                st,
                "failed",
                "no progress: remediation produced identical failures",
                stage="remediating",
            )
        st.last_failure_fingerprint = fp
        st.remediations += 1
        st.stage = "remediating"
        (self.store.task_dir(st.id) / "last_failures.md").write_text(
            self._failure_report(fixable, fix_viol), encoding="utf-8"
        )
        return None

    @staticmethod
    def _failure_report(
        results: list[verify.CheckResult], violations: list[guards.Violation]
    ) -> str:
        parts = ['<untrusted source="verification output">']
        for r in results:
            parts.append(
                f"### {r.name}: {r.status} (exit {r.code})\n$ {r.command}\n{verify.clip(r.output)}"
            )
        parts.append("</untrusted>")
        if violations:
            parts.append("Policy violations in your diff (from the orchestrator):")
            parts += [f"- {v}" for v in violations]
        return "\n\n".join(parts)

    # ---------- simplify ----------

    def _simplify(self, st: TaskState, plan: Plan, lim: dict[str, Any]) -> int | None:
        """One code-simplifier pass over the verified diff, in a fresh session.

        Runs after the first green verification (so the tests have just proven the behaviour)
        and is re-verified by the same checks. Its changes are kept only if everything still
        passes and it stayed within the task's non-test source files.
        """
        sc = self.cfg.get("simplify", {})
        wt = Path(st.worktree)
        # Always start from the verified tree (also makes resume after a stop idempotent).
        if verify.stage_all(wt) != st.pre_simplify_tree:
            proc.git(wt, "read-tree", "--reset", "-u", st.pre_simplify_tree)

        tests = self.cfg.get("guards", {}).get("test_globs", [])
        files = [p for p in st.pre_simplify_files if not verify.matches(p, tests)]
        if not files:
            return self._skip_simplify(st, "skipped", "no non-test source files in the diff")
        budget = min(float(sc.get("max_budget_usd", 2.0)), lim["max_budget_usd"] - total_cost(st))
        if budget < 0.05:
            return self._skip_simplify(st, "skipped", "not enough budget left")

        n = len(list(self.store.task_dir(st.id).glob("simplify-*.txt"))) + 1
        self.log(st, "simplify", msg=f"running {sc['agent']} on {len(files)} files")
        plugin_dir = (Path(__file__).parent / sc["plugin_dir"]).resolve()
        extra = ["--plugin-dir", str(plugin_dir), "--agent", sc["agent"]]
        if sc.get("model"):
            extra += ["--model", sc["model"]]
        file_list = "\n".join(f"- {p}" for p in files)
        prompt = (
            f"Simplify the code this task changed in {st.worktree} (branch {st.branch}). "
            f"It already passes every check. See the changes with "
            f"`git diff --cached {st.base_sha[:12]}`.\n\n"
            f"Files you may edit (and no others):\n{file_list}\n\n"
            "The approved plan, for context only (do not implement anything new):\n"
            f"{agent.plan_block(plan.text, plan.sha256)}"
        )
        turn = agent.invoke(
            self.cfg,
            wt,
            prompt,
            agent.new_session_id(),
            resume=False,
            budget_usd=budget,
            timeout=float(sc.get("timeout_minutes", 10)) * 60,
            transcript=self.store.task_dir(st.id) / f"simplify-{n:02d}.txt",
            system_prompt="simplify.md",
            extra=extra,
        )
        if turn.cost_usd is not None:
            st.simplify_cost_usd += float(turn.cost_usd)  # fresh session: per-call total
        if turn.status == "stopped":
            return self.finish(st, "stopped", "stopped by user during simplification")
        if not turn.ok or turn.status != "done":
            self._revert_simplify(st, f"simplifier ended with {turn.status}: {turn.summary[:200]}")
            return None

        new_tree = verify.stage_all(wt)
        if new_tree == st.pre_simplify_tree:
            return self._skip_simplify(st, "no_changes", turn.summary[:500])
        touched = proc.git(wt, "diff", "--name-only", st.pre_simplify_tree, new_tree).split()
        outside = [p for p in touched if p not in files]
        if outside:
            self._revert_simplify(st, f"simplifier edited files outside its scope: {outside}")
            return None
        st.simplify, st.simplify_note, st.stage = "checking", turn.summary[:1000], "verifying"
        return None

    def _skip_simplify(self, st: TaskState, outcome: str, note: str) -> int | None:
        st.simplify, st.simplify_note, st.stage = outcome, note, "awaiting_ship"
        self.log(st, "simplify", msg=f"{outcome}: {note[:200]}")
        return None

    def _revert_simplify(self, st: TaskState, note: str) -> None:
        wt = Path(st.worktree)
        verify.stage_all(wt)
        proc.git(wt, "read-tree", "--reset", "-u", st.pre_simplify_tree)
        if verify.stage_all(wt) != st.pre_simplify_tree:
            raise proc.GitError("could not restore the verified tree after simplification")
        st.verified_tree = st.pre_simplify_tree
        st.last_verification = st.pre_simplify_verification
        st.simplify, st.simplify_note, st.stage = "reverted", note[:1000], "awaiting_ship"
        self.log(st, "simplify", msg=f"reverted: {note[:300]}")

    # ---------- ship ----------

    def ship(self, st: TaskState) -> int:
        if st.status == "shipped":
            print(f"already shipped: {st.pr_url}")
            return EXIT_OK
        if st.stage not in ("awaiting_ship", "shipping"):
            raise SystemExit(f"task {st.id} is not verified (status {st.status}); nothing to ship")
        try:
            ship.preflight_gh(self.cfg, self.repo, st.id)
            st.stage = st.status = "shipping"
            self.store.save(st)
            if not st.commit_sha:
                msg = f"{st.title}\n\n{st.agent_summary}".strip()
                st.commit_sha = ship.commit(st, self.cfg, msg)
                self.store.save(st)
                self.log(st, "committed", sha=st.commit_sha[:12])
            if not st.pushed:
                ship.push(st, self.cfg)
                st.pushed = True
                self.store.save(st)
                self.log(st, "pushed", branch=st.branch)
            if not st.pr_url:
                from .report import pr_body

                st.pr_url = ship.open_pr(
                    st, self.cfg, self.repo, st.title, pr_body(st, self.plan_of(st))
                )
                self.store.save(st)
        except ship.ShipBlocked as e:
            print(str(e))
            if st.commit_sha:
                return self.finish(st, "needs_human", str(e), stage="shipping")
            self.finish(st, "awaiting_ship", str(e).splitlines()[0], stage="awaiting_ship")
            return EXIT_NEEDS_HUMAN
        except proc.GitError as e:
            return self.finish(st, "needs_human", str(e), stage="shipping")
        self.log(st, "pr", url=st.pr_url)
        return self.finish(
            st, "shipped", f"PR opened: {st.pr_url} (review and merge manually)", stage="shipped"
        )
