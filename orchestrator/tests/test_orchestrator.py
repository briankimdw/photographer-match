"""Acceptance tests for the orchestrator, using fake `claude` and `gh` executables.

Run from the repository root:  python3 -m unittest discover -s orchestrator/tests -t . -v
Each test builds a throwaway git repo with a local bare "remote"; nothing touches GitHub.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path

from orchestrator import cli, proc
from orchestrator.state import Store

HERE = Path(__file__).resolve().parent

GOOD_IMPL = "def add(a, b):\n    return a + b\n"
BAD_IMPL = "def add(a, b):\n    return a - b\n"
GOOD_TEST = (
    "import unittest\n\nfrom calc import add\n\n\n"
    "class T(unittest.TestCase):\n    def test_add(self):\n        self.assertEqual(add(2, 3), 5)\n"
)

PLAN = """# Add an add() function

Status: approved

## Objective
calc.add returns the sum of two numbers.

## Scope
- calc.py and its test.

## Acceptance criteria
- add(2, 3) == 5

## Design constraints
- Plain Python, no dependencies.

## Required tests
- tests/test_calc.py covers add.
"""

CONFIG = """
[limits]
max_remediations = {max_remediations}
task_timeout_minutes = 10
agent_timeout_minutes = 1
check_timeout_seconds = 60
max_budget_usd = 5.0
stop_on_repeated_failure = {stop_on_repeated}

[git]
base = "main"
remote = "origin"
branch_prefix = "orch/"
worktree_root = "worktrees"

[agent]
command = "{claude}"
allowed_tools = ["Read", "Edit(./**)"]
disallowed_tools = ["Bash(git push *)"]

[setup]
commands = []
rerun_on = []

[simplify]
enabled = {simplify}
plugin_dir = "plugins/code-simplifier"
agent = "code-simplifier:code-simplifier"
max_budget_usd = 1.0

[[checks]]
name = "unit"
cwd = "."
cmd = "python3 -m unittest discover -s tests -t ."
required = true
{extra_checks}

[guards]
protected = ["orchestrator/**", ".gitignore", "specs/**"]
test_globs = ["tests/**"]
secret_file_globs = ["**/.env", "**/.env.*"]
secret_file_allow = ["**/.env.example"]
migration_globs = ["migrations/**/*.sql"]

[ship]
gh = "{gh}"
commit_trailers = ["Co-Authored-By: Claude <noreply@anthropic.com>"]
"""


SPEC = """# Calculator add and sub

- status: approved        <!-- draft | approved -->
- project: calc
- created: 2026-10-10 / approved: 2026-10-10
- revision: 1

## 1. Purpose and definition of success
calc can add and subtract two numbers.

## 2. Users and context
Internal helper module.

## 3. Scope
**Do (v1):**
- add(a, b) and sub(a, b) in calc.py
**Won't do (explicitly out of scope / deferred):**
- multiplication

## 4. Inputs, outputs and interface
add(2, 3) -> 5, sub(5, 3) -> 2.

## 5. Main flow and state
N/A: pure functions.

## 6. Data and persistence
N/A: nothing persisted.

## 7. Failure handling
Non-numbers raise TypeError.

## 8. Non-functional requirements (as numbers)
Each call under 1 ms.

## 9. Environment, constraints and prohibitions
Plain Python 3.12, no dependencies.

## 10. Integration with existing assets
Extends calc.py.

### Allowed paths
- calc.py
- tests/**

## 11. Acceptance criteria (runnable checks)
- [ ] AC-1: `python3 -c "from calc import add; assert add(2, 3) == 5"` → no output (exit 0)
- [ ] AC-2: `python3 -c "from calc import sub; assert sub(5, 3) == 2"` → no output (exit 0)
- [ ] AC-3: `python3 -c "from calc import add; add('a', 1)"` → TypeError (exit 1)
- [ ] AC-4: Visual: read calc.py → both functions have docstrings

## 12. Decision log (two layers)
### User decisions (D): never re-asked; only the user can change them
- D-1: no float rounding (2026-10-10)
### AI placeholders (T): the user can veto; may be added during implementation
- T-1: module-level functions — reason: matches existing calc.py
### Do-not-decide areas: the agent stops and asks (needs_human) on these
- none (user answered 2026-10-10)
### Approvals
- test-removal

## 13. Implementation log and evidence
<!-- logs live in the PR -->
"""

ADD_SUB_IMPL = GOOD_IMPL + "\n\ndef sub(a, b):\n    return a - b\n"


def sh(cwd: Path, *args: str) -> str:
    return subprocess.run(args, cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()


class OrchestratorTest(unittest.TestCase):
    def setUp(self) -> None:
        proc.STOP.clear()
        os.environ.pop(proc.RECURSION_VAR, None)
        self.tmp = Path(tempfile.mkdtemp(prefix="orch-test-"))
        self.repo = self.tmp / "repo"
        self.remote = self.tmp / "remote.git"
        self.bin = self.tmp / "bin"
        self.bin.mkdir()
        for name in ("fake_claude.py", "fake_gh.py"):
            shutil.copy(HERE / name, self.bin / name)
            (self.bin / name).chmod(0o755)

        sh(self.tmp, "git", "init", "-q", "--bare", "-b", "main", str(self.remote))
        self.repo.mkdir()
        sh(self.repo, "git", "init", "-q", "-b", "main")
        sh(self.repo, "git", "config", "user.email", "test@example.com")
        sh(self.repo, "git", "config", "user.name", "Test")
        (self.repo / "calc.py").write_text("def add(a, b):\n    raise NotImplementedError\n")
        (self.repo / "tests").mkdir()
        (self.repo / "tests" / "__init__.py").write_text("")
        (self.repo / "tests" / "test_base.py").write_text(
            "import unittest\n\n\nclass Base(unittest.TestCase):\n"
            "    def test_truth(self):\n        self.assertTrue(True)\n"
        )
        (self.repo / ".gitignore").write_text(".orchestrator/\n__pycache__/\n")
        sh(self.repo, "git", "add", "-A")
        sh(self.repo, "git", "commit", "-q", "-m", "base")
        sh(self.repo, "git", "remote", "add", "origin", str(self.remote))
        sh(self.repo, "git", "push", "-q", "origin", "main")

        self.plan = self.tmp / "plan.md"
        self.plan.write_text(PLAN)
        self.write_config()

    def tearDown(self) -> None:
        os.environ.pop(proc.RECURSION_VAR, None)
        shutil.rmtree(self.tmp, ignore_errors=True)

    # ---------- helpers ----------

    def write_config(
        self,
        max_remediations: int = 3,
        stop_on_repeated: bool = True,
        extra_checks: str = "",
        gh: str | None = None,
        simplify: bool = False,
    ) -> None:
        self.config = self.tmp / "config.toml"
        self.config.write_text(
            CONFIG.format(
                max_remediations=max_remediations,
                stop_on_repeated=str(stop_on_repeated).lower(),
                claude=self.bin / "fake_claude.py",
                gh=gh or (self.bin / "fake_gh.py"),
                extra_checks=extra_checks,
                simplify=str(simplify).lower(),
            )
        )

    def scenario(self, *turns: dict) -> None:
        (self.bin / "scenario.json").write_text(json.dumps(list(turns)))

    def cli(self, *args: str) -> int:
        out = StringIO()
        with redirect_stdout(out):
            try:
                rc = cli.main(["--repo", str(self.repo), "--config", str(self.config), *args])
            except SystemExit as e:
                self.last_output = out.getvalue() + str(e.code)
                return 2 if not isinstance(e.code, int) else e.code
        self.last_output = out.getvalue()
        return rc

    def calls(self) -> list[dict]:
        p = self.bin / "calls.jsonl"
        return [json.loads(x) for x in p.read_text().splitlines()] if p.exists() else []

    def gh_calls(self) -> list[list[str]]:
        p = self.bin / "gh_calls.jsonl"
        return [json.loads(x)["args"] for x in p.read_text().splitlines()] if p.exists() else []

    def state(self):  # type: ignore[no-untyped-def]
        store = Store(self.repo)
        return store.load(store.latest_id())

    def remote_branches(self) -> list[str]:
        return sh(self.remote, "git", "branch", "--format=%(refname:short)").split()

    def good_turn(self, **kw: object) -> dict:
        return {"write": {"calc.py": GOOD_IMPL, "tests/test_calc.py": GOOD_TEST}, **kw}

    # ---------- acceptance tests ----------

    def test_plan_is_required(self) -> None:
        self.scenario(self.good_turn())
        self.assertNotEqual(self.cli("start", "--plan", str(self.tmp / "missing.md")), 0)
        self.assertIn("not found", self.last_output)

        self.plan.write_text(PLAN.replace("Status: approved", "Status: draft"))
        self.assertNotEqual(self.cli("start", "--plan", str(self.plan)), 0)
        self.assertIn("not approved", self.last_output)

        self.plan.write_text(
            PLAN.replace(
                "## Required tests\n- tests/test_calc.py covers add.\n", "## Required tests\nTBD\n"
            )
        )
        self.assertNotEqual(self.cli("start", "--plan", str(self.plan)), 0)
        self.assertIn("required tests", self.last_output.lower())

        self.assertEqual(self.calls(), [], "agent must not run without an approved plan")
        self.assertEqual(sh(self.repo, "git", "branch", "--list", "orch/*"), "")

    def test_happy_path_auto_ship_opens_pr_and_never_merges(self) -> None:
        self.scenario(self.good_turn(summary="implemented add"))
        rc = self.cli("start", "--plan", str(self.plan), "--auto-ship")
        st = self.state()
        self.assertEqual((rc, st.status), (0, "shipped"), self.last_output)
        self.assertEqual(st.pr_url, "https://github.example/pr/1")
        self.assertIn(st.branch, self.remote_branches())
        msg = sh(self.remote, "git", "log", "-1", "--format=%B", st.branch)
        self.assertIn(f"Orchestrator-Task: {st.id}", msg)
        self.assertEqual(
            sh(self.remote, "git", "rev-parse", "main"),
            sh(self.repo, "git", "rev-parse", "main"),
            "main must be untouched",
        )
        verbs = [a[:2] for a in self.gh_calls()]
        self.assertIn(["pr", "create"], verbs)
        self.assertFalse(any("merge" in a for a in self.gh_calls()))
        body = json.loads((self.bin / "prs.json").read_text())[0]["body"]
        self.assertIn("| `unit` | ✅", body)
        self.assertIn("Not merged or deployed", body)

        # First turn creates the session; plan is in the prompt; env is scrubbed.
        call = self.calls()[0]
        self.assertIn("--session-id", call["argv"])
        self.assertIn("<approved_plan", call["prompt"])
        self.assertEqual(call["env"].get(proc.RECURSION_VAR), "1")

    def test_failure_output_reaches_agent_and_remediation_reruns_checks(self) -> None:
        self.scenario(
            {"write": {"calc.py": BAD_IMPL, "tests/test_calc.py": GOOD_TEST}},
            {"write": {"calc.py": GOOD_IMPL}, "summary": "fixed subtraction bug"},
        )
        rc = self.cli("start", "--plan", str(self.plan))
        st = self.state()
        self.assertEqual((rc, st.status), (0, "awaiting_ship"), self.last_output)
        self.assertEqual((st.agent_calls, st.remediations), (2, 1))
        second = self.calls()[1]
        self.assertIn("--resume", second["argv"], "remediation must resume the same session")
        self.assertIn(st.session_id, second["argv"])
        self.assertIn("FAILED", second["prompt"])
        self.assertIn("AssertionError: -1 != 5", second["prompt"])
        self.assertIn('<untrusted source="verification output">', second["prompt"])
        self.assertIn("<approved_plan", second["prompt"], "plan re-sent on every turn")
        # Without --auto-ship nothing leaves the machine until `ship`.
        self.assertEqual(self.gh_calls(), [])
        self.assertNotIn(st.branch, self.remote_branches())

        self.assertEqual(self.cli("ship"), 0, self.last_output)
        self.assertEqual(self.state().status, "shipped")
        self.assertIn(st.branch, self.remote_branches())

    def test_retries_stop_at_limit_and_no_pr(self) -> None:
        self.write_config(max_remediations=2, stop_on_repeated=False)
        self.scenario({"write": {"calc.py": BAD_IMPL, "tests/test_calc.py": GOOD_TEST}})
        rc = self.cli("start", "--plan", str(self.plan), "--auto-ship")
        st = self.state()
        self.assertEqual((rc, st.status), (1, "failed"))
        self.assertIn("retry limit", st.reason)
        self.assertEqual(st.agent_calls, 3)  # implementation + 2 remediations
        self.assertEqual(self.gh_calls(), [])
        self.assertNotIn(st.branch, self.remote_branches())
        self.assertEqual(sh(Path(st.worktree), "git", "rev-list", "--count", "main..HEAD"), "0")

    def test_no_progress_stops_early(self) -> None:
        self.scenario({"write": {"calc.py": BAD_IMPL, "tests/test_calc.py": GOOD_TEST}})
        rc = self.cli("start", "--plan", str(self.plan))
        st = self.state()
        self.assertEqual((rc, st.status), (1, "failed"))
        self.assertIn("no progress", st.reason)
        self.assertEqual(st.agent_calls, 2)

    def test_resume_raises_limit_after_failure(self) -> None:
        self.write_config(max_remediations=1, stop_on_repeated=False)
        self.scenario(
            {"write": {"calc.py": BAD_IMPL, "tests/test_calc.py": GOOD_TEST}},
            {"write": {"calc.py": BAD_IMPL + "\n"}},
            {"write": {"calc.py": GOOD_IMPL}},
        )
        self.assertEqual(self.cli("start", "--plan", str(self.plan)), 1)
        self.assertEqual(self.cli("resume", "--max-remediations", "2"), 0, self.last_output)
        self.assertEqual(self.state().status, "awaiting_ship")

    def test_needs_human_pauses_and_answer_resumes(self) -> None:
        self.scenario(
            {"status": "needs_human", "summary": "ambiguous", "questions": ["Floats or ints?"]},
            self.good_turn(),
        )
        rc = self.cli("start", "--plan", str(self.plan), "--auto-ship")
        st = self.state()
        self.assertEqual((rc, st.status, st.stage), (3, "needs_human", "answering"))
        self.assertEqual(st.questions, ["Floats or ints?"])
        self.assertEqual(self.gh_calls(), [])

        self.assertNotEqual(self.cli("resume"), 0)
        self.assertIn("--answer", self.last_output)
        self.assertEqual(self.cli("resume", "--answer", "ints only"), 0, self.last_output)
        self.assertIn("<human_answer>\nints only", self.calls()[1]["prompt"])
        self.assertEqual(self.state().status, "shipped")

    def test_test_weakening_is_sent_back_not_accepted(self) -> None:
        skipped = GOOD_TEST.replace(
            "    def test_add", "    @unittest.skip('later')\n    def test_add"
        )
        self.scenario(
            {"write": {"calc.py": BAD_IMPL, "tests/test_calc.py": skipped}},
            self.good_turn(),
        )
        rc = self.cli("start", "--plan", str(self.plan))
        self.assertEqual(rc, 0, self.last_output)
        self.assertIn("[suppression]", self.calls()[1]["prompt"])

    def test_deleting_tests_needs_human(self) -> None:
        self.scenario({**self.good_turn(), "delete": ["tests/test_base.py"]})
        rc = self.cli("start", "--plan", str(self.plan), "--auto-ship")
        st = self.state()
        self.assertEqual((rc, st.status), (3, "needs_human"))
        self.assertIn("test-removal", st.reason)
        self.assertEqual(self.gh_calls(), [])

    def test_destructive_migration_needs_human(self) -> None:
        self.scenario(
            {
                **self.good_turn(),
                "write": {
                    **self.good_turn()["write"],
                    "migrations/002_drop.sql": "drop table bookings;\n",
                },
            }
        )
        rc = self.cli("start", "--plan", str(self.plan), "--auto-ship")
        self.assertEqual((rc, self.state().status), (3, "needs_human"))
        self.assertIn("destructive SQL", self.state().reason)

    def test_flaky_check_is_not_counted_as_passed(self) -> None:
        flaky = self.tmp / "flaky.py"
        flaky.write_text(
            "import pathlib, sys\np = pathlib.Path(__file__).with_suffix('.n')\n"
            "n = int(p.read_text()) if p.exists() else 0\np.write_text(str(n + 1))\n"
            "sys.exit(1 if n % 2 == 0 else 0)\n"
        )
        self.write_config(
            extra_checks=f'[[checks]]\nname = "flaky"\ncmd = "python3 {flaky}"\nrequired = true\n'
        )
        self.scenario(self.good_turn())
        rc = self.cli("start", "--plan", str(self.plan), "--auto-ship")
        st = self.state()
        self.assertEqual((rc, st.status), (3, "needs_human"))
        self.assertIn("flaky: flaky", st.reason)
        self.assertEqual(self.gh_calls(), [])

    def test_unavailable_required_check_blocks(self) -> None:
        self.write_config(
            extra_checks='[[checks]]\nname = "scanner"\ncmd = "no-such-tool-xyz"\nrequired = true\n'
        )
        self.scenario(self.good_turn())
        self.assertEqual(self.cli("start", "--plan", str(self.plan), "--auto-ship"), 3)
        self.assertIn("scanner: unavailable", self.state().reason)

    def test_uncommitted_user_changes_are_preserved(self) -> None:
        (self.repo / "calc.py").write_text("# my local edit\n")
        (self.repo / "notes.txt").write_text("untracked user file\n")
        before = sh(self.repo, "git", "status", "--porcelain")
        self.scenario(self.good_turn())
        self.assertEqual(self.cli("start", "--plan", str(self.plan), "--auto-ship"), 0)
        self.assertEqual(sh(self.repo, "git", "status", "--porcelain"), before)
        self.assertEqual((self.repo / "calc.py").read_text(), "# my local edit\n")
        self.assertEqual((self.repo / "notes.txt").read_text(), "untracked user file\n")
        self.assertEqual(sh(self.repo, "git", "branch", "--show-current"), "main")
        # The task's commit contains only the agent's work, not the user's edits.
        st = self.state()
        self.assertEqual((Path(st.worktree) / "calc.py").read_text(), GOOD_IMPL)

    def test_missing_gh_stops_before_any_remote_action(self) -> None:
        self.write_config(gh="/nonexistent/gh")
        self.scenario(self.good_turn())
        rc = self.cli("start", "--plan", str(self.plan), "--auto-ship")
        st = self.state()
        self.assertEqual((rc, st.status), (3, "awaiting_ship"))
        self.assertIn("gh auth login", self.last_output)
        self.assertEqual(st.commit_sha, "")
        self.assertNotIn(st.branch, self.remote_branches())

    def test_ship_is_idempotent(self) -> None:
        self.scenario(self.good_turn())
        self.assertEqual(self.cli("start", "--plan", str(self.plan), "--auto-ship"), 0)
        sha = self.state().commit_sha
        self.assertEqual(self.cli("ship"), 0)
        # Simulate a crash after the PR was created but before state recorded it.
        store = Store(self.repo)
        st = self.state()
        st.status, st.stage, st.pr_url = "shipping", "shipping", ""
        store.save(st)
        self.assertEqual(self.cli("ship"), 0)
        self.assertEqual(self.state().commit_sha, sha)
        creates = [a for a in self.gh_calls() if a[:2] == ["pr", "create"]]
        self.assertEqual(len(creates), 1)
        self.assertEqual(sh(self.remote, "git", "rev-list", "--count", f"main..{st.branch}"), "1")

    def test_changes_after_verification_block_ship(self) -> None:
        self.scenario(self.good_turn())
        self.assertEqual(self.cli("start", "--plan", str(self.plan)), 0)
        (Path(self.state().worktree) / "calc.py").write_text("def add(a, b):\n    return 0\n")
        self.assertNotEqual(self.cli("ship"), 0)
        self.assertIn("changed since it was verified", self.last_output)
        self.assertEqual(self.gh_calls()[-1][:2], ["auth", "status"])

    def test_secrets_not_passed_to_agent(self) -> None:
        os.environ["FAKE_SERVICE_TOKEN"] = "s3cret"
        try:
            self.scenario(self.good_turn())
            self.cli("start", "--plan", str(self.plan))
        finally:
            os.environ.pop("FAKE_SERVICE_TOKEN")
        self.assertNotIn("FAKE_SERVICE_TOKEN", self.calls()[0]["env"])

    def test_agent_cannot_commit_env_file(self) -> None:
        self.scenario(
            {**self.good_turn(), "write": {**self.good_turn()["write"], ".env": "KEY=x\n"}},
            {"delete": [".env"]},
        )
        self.assertEqual(self.cli("start", "--plan", str(self.plan)), 0, self.last_output)
        self.assertIn("[secret-file] .env", self.calls()[1]["prompt"])

    def test_stop_interrupts_running_task_and_resume_finishes(self) -> None:
        import sys
        import time

        self.scenario({**self.good_turn(), "sleep": 60}, self.good_turn())
        base = [
            sys.executable,
            "-m",
            "orchestrator",
            "--repo",
            str(self.repo),
            "--config",
            str(self.config),
        ]
        root = HERE.parent.parent
        run = subprocess.Popen(
            [*base, "start", "--plan", str(self.plan)],
            cwd=root,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        deadline = time.monotonic() + 20
        while not (self.bin / "calls.jsonl").exists() and time.monotonic() < deadline:
            time.sleep(0.2)
        subprocess.run([*base, "stop"], cwd=root, check=True, capture_output=True)
        self.assertEqual(run.wait(timeout=45), 130)
        st = self.state()
        self.assertEqual((st.status, st.stage), ("stopped", "implementing"))
        self.assertEqual(sh(self.repo, "git", "branch", "--show-current"), "main")
        self.assertEqual(self.cli("resume"), 0, self.last_output)
        self.assertEqual(self.state().status, "awaiting_ship")

    def test_recursive_invocation_refused(self) -> None:
        os.environ[proc.RECURSION_VAR] = "1"
        self.scenario(self.good_turn())
        self.assertEqual(self.cli("start", "--plan", str(self.plan)), 2)
        self.assertEqual(self.calls(), [])

    def test_auth_failure_is_not_retried(self) -> None:
        self.scenario({"raw": "Invalid API key · Please run /login", "exit": 1})
        rc = self.cli("start", "--plan", str(self.plan))
        st = self.state()
        self.assertEqual((rc, st.status, st.agent_calls), (3, "needs_human", 1))
        self.assertIn("authentication", st.reason)

    # ---------- code-simplifier pass ----------

    SIMPLE_IMPL = "def add(a, b):\n    return b + a\n"

    def test_simplify_runs_after_green_and_is_kept_when_checks_pass(self) -> None:
        self.write_config(simplify=True)
        self.scenario(
            self.good_turn(summary="implemented"),
            {"write": {"calc.py": self.SIMPLE_IMPL}, "summary": "reordered operands"},
        )
        rc = self.cli("start", "--plan", str(self.plan), "--auto-ship")
        st = self.state()
        self.assertEqual((rc, st.status, st.simplify), (0, "shipped", "applied"), self.last_output)
        self.assertEqual((st.agent_calls, st.remediations), (1, 0))

        impl, simp = self.calls()
        argv = simp["argv"]
        self.assertEqual(argv[argv.index("--agent") + 1], "code-simplifier:code-simplifier")
        plugin = Path(argv[argv.index("--plugin-dir") + 1])
        self.assertTrue((plugin / "agents" / "code-simplifier.md").is_file())
        self.assertTrue(argv[argv.index("--append-system-prompt-file") + 1].endswith("simplify.md"))
        self.assertIn("--session-id", argv, "simplifier runs in its own fresh session")
        self.assertNotIn(st.session_id, argv)
        self.assertIn("- calc.py", simp["prompt"])
        allowed = simp["prompt"].split("(and no others):\n", 1)[1].split("\n\n", 1)[0]
        self.assertEqual(allowed, "- calc.py", "tests are off-limits to the simplifier")

        shipped = sh(self.remote, "git", "show", f"{st.branch}:calc.py") + "\n"
        self.assertEqual(shipped, self.SIMPLE_IMPL)
        self.assertTrue((self.store_dir() / "verify-01-simplified" / "summary.json").is_file())
        body = json.loads((self.bin / "prs.json").read_text())[0]["body"]
        self.assertIn("Simplification (code-simplifier plugin): applied", body)

    def test_simplify_that_breaks_checks_is_discarded_without_using_retries(self) -> None:
        self.write_config(simplify=True)
        self.scenario(self.good_turn(), {"write": {"calc.py": BAD_IMPL}})
        rc = self.cli("start", "--plan", str(self.plan), "--auto-ship")
        st = self.state()
        self.assertEqual((rc, st.status, st.simplify), (0, "shipped", "reverted"), self.last_output)
        self.assertIn("checks failed after simplification", st.simplify_note)
        self.assertEqual((st.agent_calls, st.remediations), (1, 0))
        self.assertEqual(len(self.calls()), 2, "no remediation turn for a bad simplification")
        self.assertEqual(sh(self.remote, "git", "show", f"{st.branch}:calc.py") + "\n", GOOD_IMPL)
        self.assertTrue(all(c["status"] == "passed" for c in st.last_verification))

    def test_simplify_touching_tests_is_discarded(self) -> None:
        self.write_config(simplify=True)
        self.scenario(
            self.good_turn(),
            {"write": {"tests/test_calc.py": GOOD_TEST.replace("2, 3), 5", "1, 1), 2")}},
        )
        self.assertEqual(self.cli("start", "--plan", str(self.plan)), 0, self.last_output)
        st = self.state()
        self.assertEqual(st.simplify, "reverted")
        self.assertIn("outside its scope", st.simplify_note)
        self.assertEqual((Path(st.worktree) / "tests/test_calc.py").read_text(), GOOD_TEST)
        self.assertEqual(sh(Path(st.worktree), "git", "write-tree"), st.verified_tree)

    def test_simplify_with_no_changes(self) -> None:
        self.write_config(simplify=True)
        self.scenario(self.good_turn(), {"summary": "already clear"})
        self.assertEqual(self.cli("start", "--plan", str(self.plan)), 0, self.last_output)
        st = self.state()
        self.assertEqual((st.simplify, st.status), ("no_changes", "awaiting_ship"))
        self.assertFalse((self.store_dir() / "verify-01-simplified").exists())

    def test_simplifier_error_never_blocks_the_task(self) -> None:
        self.write_config(simplify=True)
        self.scenario(self.good_turn(), {"raw": "API Error: overloaded", "exit": 1})
        rc = self.cli("start", "--plan", str(self.plan), "--auto-ship")
        st = self.state()
        self.assertEqual((rc, st.status, st.simplify), (0, "shipped", "reverted"))

    def test_no_simplify_flag(self) -> None:
        self.write_config(simplify=True)
        self.scenario(self.good_turn())
        self.assertEqual(self.cli("start", "--plan", str(self.plan), "--no-simplify"), 0)
        self.assertEqual((self.state().simplify, len(self.calls())), ("disabled", 1))

    def store_dir(self) -> Path:
        store = Store(self.repo)
        return store.task_dir(store.latest_id())

    # ---------- /spec skill format ----------

    def test_spec_format_is_parsed(self) -> None:
        from orchestrator.plan import parse_plan

        plan = parse_plan(SPEC)
        self.assertEqual((plan.format, plan.title), ("spec", "Calculator add and sub"))
        self.assertIn("add and subtract", plan.sections["objective"])
        self.assertIn("multiplication", plan.sections["scope"])
        self.assertIn("Plain Python", plan.sections["design constraints"])
        self.assertEqual(plan.allowed_paths, ["calc.py", "tests/**"])
        self.assertEqual(plan.approvals, {"test-removal"})
        self.assertEqual(
            [(a.id, a.expect_exit) for a in plan.acceptance],
            [("AC-1", 0), ("AC-2", 0), ("AC-3", 1)],
        )
        self.assertEqual(
            plan.acceptance[0].command, 'python3 -c "from calc import add; assert add(2, 3) == 5"'
        )
        self.assertEqual(len(plan.manual_checks), 1)
        self.assertIn("Visual", plan.manual_checks[0])

    def test_spec_must_be_approved_and_complete(self) -> None:
        from orchestrator.plan import PlanError, parse_plan

        cases = {
            "status is 'draft'": SPEC.replace("- status: approved", "- status: draft"),
            "missing section '## 5.'": SPEC.replace("## 5. Main flow and state", "## Flow"),
            "template slot": SPEC.replace("Extends calc.py.", "{conventions to follow}"),
            "Unconfirmed": SPEC.replace(
                "- none (user answered 2026-10-10)", "- Unconfirmed (to ask before Gate B)"
            ),
        }
        for expected, text in cases.items():
            with self.assertRaises(PlanError) as cm:
                parse_plan(text)
            self.assertIn(expected, str(cm.exception))

    def test_braces_in_fenced_code_are_not_template_slots(self) -> None:
        from orchestrator.plan import parse_plan

        example = 'Extends calc.py.\n```json\n[\n  {"a": 1},\n  {"b": 2}\n]\n```'
        plan = parse_plan(SPEC.replace("Extends calc.py.", example))
        self.assertIn('{"a": 1}', plan.text)

    def test_unfilled_skill_template_is_rejected(self) -> None:
        from orchestrator.plan import PlanError, parse_plan

        skill = HERE.parent.parent / ".claude" / "skills" / "spec" / "SKILL.md"
        body = skill.read_text().split("```markdown\n", 1)[1].split("\n```\n", 1)[0]
        with self.assertRaises(PlanError) as cm:
            parse_plan(body.replace("- status: draft", "- status: approved"))
        self.assertIn("template", str(cm.exception))

    def test_spec_acceptance_commands_are_required_checks(self) -> None:
        spec = self.tmp / "spec.md"
        spec.write_text(SPEC)
        self.scenario(
            self.good_turn(summary="add only"),
            {"write": {"calc.py": ADD_SUB_IMPL}, "summary": "added sub"},
        )
        rc = self.cli("start", "--plan", str(spec), "--auto-ship")
        st = self.state()
        self.assertEqual((rc, st.status), (0, "shipped"), self.last_output)
        self.assertEqual(st.remediations, 1)
        first, second = self.calls()
        self.assertIn("AC-2 (required, from the plan", first["prompt"])
        self.assertIn("### AC-2: failed", second["prompt"])
        self.assertIn("ImportError", second["prompt"])
        names = {c["name"]: c["status"] for c in st.last_verification}
        self.assertEqual(
            {k: names[k] for k in ("AC-1", "AC-2", "AC-3")},
            {"AC-1": "passed", "AC-2": "passed", "AC-3": "passed"},
        )
        body = json.loads((self.bin / "prs.json").read_text())[0]["body"]
        self.assertIn("| `AC-3` | ✅", body)
        self.assertIn("Manual checks for the reviewer", body)
        self.assertIn("- [ ] AC-4: Visual: read calc.py", body)

    def test_agent_cannot_edit_specs(self) -> None:
        self.scenario(
            {**self.good_turn(), "write": {**self.good_turn()["write"], "specs/x.md": "hi\n"}},
            {"delete": ["specs/x.md"]},
        )
        self.assertEqual(self.cli("start", "--plan", str(self.plan)), 0, self.last_output)
        self.assertIn("[protected] specs/x.md", self.calls()[1]["prompt"])

    def test_source_has_no_merge_or_deploy_path(self) -> None:
        src = "\n".join(p.read_text() for p in (HERE.parent).glob("*.py"))
        for forbidden in ('"merge"', '"--force', '"--admin"', '"deploy"', '"--no-verify"'):
            self.assertNotIn(forbidden, src)
        push_lines = [ln for ln in src.splitlines() if '"push"' in ln]
        self.assertEqual(len(push_lines), 1)
        self.assertNotRegex(push_lines[0], r'"-f"|\+|force')


if __name__ == "__main__":
    unittest.main()
