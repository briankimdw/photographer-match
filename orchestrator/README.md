# Plan orchestrator

You write and approve a plan. The orchestrator gets Claude Code to implement it, verifies the result itself, sends failures back to Claude until the checks pass (within set limits), and then opens a pull request for you to review. It never merges or deploys.

```
/spec <idea> → interview → specs/<slug>.md (you approve)      or hand-write plans/<name>.md
        │
plan (you approve) → worktree + branch → claude implements → checks run outside the agent
        ↑                                                         │ fail (bounded retries)
        └──── failure output, plan re-sent, same Claude session ──┘
                                                                  │ pass
                      code-simplifier pass (fresh session) → same checks again
                                     │ pass: keep it   │ any failure: discard it
                     you review → `ship` → commit, push branch, open PR → you merge
```

## Setup (once)

1. **Claude Code CLI** logged in (`claude auth status`).
2. **Backend dev tools** in the venv:
   `backend/.venv/bin/pip install -r backend/requirements-dev.txt`
   (Each task builds its own venv in its worktree. This one is for running checks by hand.)
3. **gitleaks** on PATH, for the secrets check.
4. **GitHub CLI**, needed only for the PR step: `sudo apt install gh && gh auth login`. Without it, a verified task stops just before committing and prints these same instructions.

Everything is Python 3.12 standard library. Run commands from the repo root.

## Write a plan

There are two ways. Both produce a file you approve, and the orchestrator never writes or infers one.

### Option A (recommended): `/spec` in Claude Code

Open a normal Claude Code session in this repo and run `/spec <one-line idea>`. The `spec` skill lives in `.claude/skills/spec/`. It's adapted from [dualform-labs/spec-skill](https://github.com/dualform-labs/spec-skill); see `VENDORED.md` for the changes. It:

1. Reads the repo and this orchestrator's config, so it only asks what you have to decide.
2. Interviews you in rounds of multiple-choice questions, each with a recommended default.
3. Writes `specs/<slug>.md` using a 13-section template.
4. Has a fresh agent try to implement from the spec alone, and fills any gaps it would have to ask about.
5. Shows you the full spec. **Approve** sets `status: approved` and prints the `start` command. The skill never implements anything itself.

```bash
python3 -m orchestrator start --plan specs/<slug>.md
```

For spec files, the orchestrator:

- **Requires** `- status: approved`, sections `## 1.` to `## 12.`, no unfilled `{…}` template slots, and no "Unconfirmed (to ask before Gate B)" entries.
- **Runs command acceptance criteria as required checks.** These are the `` - [ ] AC-n: `command` → … (exit N) `` lines in §11. Each runs with `bash -c` from the repo root, alongside the checks below. Failures go back to Claude like any other check.
- **Lists `Visual:` acceptance criteria in the PR** as manual checks for the reviewer.
- **Reads `### Allowed paths` (§10) and `### Approvals` (§12)** exactly like the plan format's sections.

### Option B: hand-write a plan

Copy `plans/TEMPLATE.md` to `plans/<name>.md` and fill it in. The orchestrator refuses a plan that lacks any of these sections, or where one is only a placeholder:

- `## Objective`
- `## Scope`
- `## Acceptance criteria`
- `## Design constraints`
- `## Required tests`

It also refuses any plan without a `Status: approved` line. Acceptance criteria written as `` - AC-1: `command` `` run as required checks here too.

There are two optional sections:

- `## Allowed paths`: globs. A change to any file outside them is sent back to Claude to revert.
- `## Approvals`: pre-approve `destructive-migration`, `test-removal` or `lint-suppression`. Without an approval, these pause the task for you.

When a task starts, it freezes a copy of the plan along with its sha256. Editing the original file afterwards has no effect on the running task.

## Commands

```bash
python3 -m orchestrator start --plan plans/add-thing.md     # run until verified, then pause
python3 -m orchestrator start --plan plans/x.md --auto-ship # ...and push + open the PR without pausing
python3 -m orchestrator start --plan plans/x.md --no-simplify  # skip the code-simplifier pass
python3 -m orchestrator status [TASK] [--json]               # TASK defaults to the latest task
python3 -m orchestrator logs [TASK] [-f]                     # event log
python3 -m orchestrator logs [TASK] --files                  # list transcripts / check logs
python3 -m orchestrator logs [TASK] --file agent-02.txt      # one agent turn (prompt + output)
python3 -m orchestrator logs [TASK] --file verify-02/pytest.log
python3 -m orchestrator stop [TASK]                          # interrupt cleanly (SIGINT)
python3 -m orchestrator resume [TASK] [--answer "..."]       # continue after stop/pause/failure
python3 -m orchestrator resume [TASK] --max-remediations 6 --budget 15   # raise limits and retry
python3 -m orchestrator ship [TASK]                          # commit, push, open PR (verified tasks only)
python3 -m orchestrator list
```

`start` and `resume` run in the foreground. To run one in the background, use `nohup … &` and watch it with `logs -f`. Only one task runs per repo at a time (enforced by a lock file).

Exit codes:

| Code | Meaning |
|---|---|
| 0 | Verified, or shipped |
| 1 | Failed (retry limit, no progress, budget, time, agent error) |
| 2 | Refused (no plan or bad plan, already running, recursion) |
| 3 | Needs you (agent question, flaky or unavailable check, guard, `gh` missing) |
| 130 | Stopped |

### When a task pauses (`needs_human`)

- **Claude asked a question.** Run `status` to see it, then `resume --answer "…"` (or `--answer-file`). The answer goes to the same Claude session.
- **A check is flaky or unavailable** (network down, missing tool). Fix the cause, then `resume`. Verification reruns.
- **A guard fired** (test deleted, destructive SQL, edit to an existing migration). Inspect the worktree. Either make the change yourself and `resume`, or add the approval to a new plan.

## What runs each iteration

Checks are configured in `orchestrator/config.toml`. They run in the task's worktree with a scrubbed environment and dummy Supabase settings:

| Check | Command (from `backend/`) | Required |
|---|---|---|
| ruff-lint | `ruff check .` | yes |
| ruff-format | `ruff format --check <changed .py files>` | yes |
| mypy | `mypy .` | yes |
| pytest | `python -m pytest` | yes |
| secrets | `gitleaks protect --staged` (the task's whole diff) | yes |
| pip-audit | `pip-audit -r requirements.txt` | no (needs network) |
| frontend-build | `npm ci && npm run build` | yes, but only when `frontend/**` changed |
| AC-n | the plan's command acceptance criteria (`bash -c`, repo root, exit code decides) | yes |

The format check covers only the files a task changes, because two existing files aren't ruff-formatted and the orchestrator doesn't reformat code outside a task's scope. `B904` is ignored for the same reason (see `backend/pyproject.toml`).

Each failed check is rerun once with nothing changed. If it passes the second time it's reported as **flaky**, and the task pauses; a flaky check never counts as passed. A check that can't run (missing tool, offline) is **unavailable**. Unavailable required checks pause the task.

The **guards** inspect the diff at the same point. Claude is sent back to fix these:

- edits to protected files (`orchestrator/`, `plans/`, `specs/`, `backend/pyproject.toml`, `requirements-dev.txt`, `conftest.py`, `.gitignore`, `.claude/`)
- changes outside the Allowed paths
- `.env` or key files
- added `skip`/`xfail`/`noqa`/`type: ignore`

These pause the task for you:

- deleted tests or test functions
- destructive SQL in a migration
- edits to an existing migration

Dependency changes and net removal of asserts become review notes in the PR.

## Simplification pass (code-simplifier plugin)

After the first green verification, the [code-simplifier](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/code-simplifier) agent from Anthropic's official plugins runs once. It's invoked with `--plugin-dir orchestrator/plugins/code-simplifier --agent code-simplifier:code-simplifier`.

**Why it runs here:**

- **Not during the fix loop.** Simplifying code that doesn't work yet wastes effort and mixes two jobs.
- **After the checks first pass.** The tests have just proven the behaviour, so the same checks can confirm the simplifier preserved it.
- **Before the PR.** Its changes go into what you review.

**Safety rules:**

- **Fresh session.** It gets an independent look, without the implementer's context or reasoning.
- **Limited scope.**
  - It may edit only the task's changed non-test files. It's told this, and any edit to another file or a test discards its changes.
  - It's never allowed to touch tests: they're the proof that behaviour didn't change.
- **The same checks and guards run again.** If anything fails, its changes are discarded with `git read-tree --reset -u <verified tree>`, and the task ships the already-verified version.
- **It can't block or degrade a task.**
  - It never uses a remediation attempt.
  - It never triggers `needs_human`.
  - Errors, timeouts and running out of budget all count as "discarded".
- **Python standards.** The plugin's built-in standards are for JS/React, so `prompts/simplify.md` gives it this repo's Python standards and the limits above.
- **Bounded.** It runs once per task, with its own spend cap (`[simplify].max_budget_usd`, default $2, which also counts toward the task budget) and a 10-minute timeout.
- **Pinned.** The plugin is vendored, unmodified, at a pinned commit (`plugins/code-simplifier/VENDORED.md`), so nothing is fetched at run time.

The PR description and `status` report the outcome: applied, no changes needed, or changes discarded (with the reason).

To turn it off, run `start --no-simplify` for one task, or set `[simplify].enabled = false`.

## Limits and stop conditions (`[limits]` in config; `--max-remediations`, `--budget`, `--timeout` flags)

| Limit | Default |
|---|---|
| Remediation attempts after the first implementation | 4 |
| Total Claude spend | $10 |
| Task wall-clock time | 45 min |
| Per Claude call | 20 min |
| Per check | 10 min |

A task also stops early in these cases:

- A remediation leaves the exact same failures (no progress).
- Claude Code reports an auth or billing error. This is never retried.
- Claude reports `needs_human` or `blocked`.

## Safety model

- **Your checkout is never touched.** Each task works in its own git worktree under `../photographer-match.worktrees/<task>`, on a new `orch/<slug>` branch from the committed `main`. Your uncommitted changes stay where they are and aren't included in the task.
- **No force-push, reset or discard.** If the remote branch already exists with different contents, the push is refused.
- **No merge or deploy code path exists.** A test asserts this.
- **Shipping is idempotent.** Before acting, `ship` checks for an existing commit (via the `Orchestrator-Task:` trailer), an existing remote branch and an existing PR. It refuses if the worktree changed after verification.
- **Claude's permissions are minimal.** It runs with `--permission-mode dontAsk` and `--permission-prompts none`: anything not explicitly allowed is denied. The rules are:
  - Edits are allowed only inside the worktree.
  - Bash is limited to the project's test, lint and type tools.
  - Denied: git history and branch commands, `git push`, `gh`, `claude`, the orchestrator itself, `curl`/`wget`, WebFetch/WebSearch, subagents.
  - Reading `.env` files, `~/.ssh`, `~/.config/gh` or Claude's credentials is denied.
- **Repository-provided config is ignored.** `--setting-sources user --strict-mcp-config --disable-slash-commands` means `.claude/` settings, hooks, MCP servers and skills from the repo don't load.
- **Secrets stay out.** Claude and the checks get an allowlisted environment, so `GH_TOKEN`, API keys, `SSH_AUTH_SOCK` and similar are dropped. Gitignored `.env` files don't exist in worktrees.
- **Recursion is blocked.** `ORCHESTRATOR_ACTIVE=1` is set for Claude and the checks, and the CLI refuses `start`, `resume` and `ship` when it sees it.
- **Untrusted text is labelled.** Test and command output is wrapped in `<untrusted>` tags, and the system prompt says to treat it as data. The full approved plan is re-sent every turn: separate CLI calls are never assumed to share context, although remediation turns do `--resume` the task's session.

## State and logs

Everything is kept under `.orchestrator/tasks/<task-id>/` (gitignored):

| File | Contents |
|---|---|
| `state.json` | Task state |
| `plan.md` | Frozen copy of the plan |
| `log.jsonl` | Event log |
| `agent-NN.txt` | Full prompt and output for each Claude turn |
| `verify-NN/` | Per-check logs and `summary.json` |
| `last_failures.md` | What Claude was sent most recently |

To clean up after a PR is merged:

```bash
git worktree remove ../photographer-match.worktrees/<task-id>
git branch -d orch/<slug>
```

## Tests

```bash
python3 -m unittest discover -s orchestrator/tests -t . -v
```

The suite runs 33 hermetic acceptance tests using a fake `claude` and a fake `gh`, a throwaway repo and a local bare remote. They cover:

- plan required
- happy path to PR
- failure output reaching Claude
- remediation then a rerun
- retry limit and no-progress stop
- `needs_human` question, then `--answer`
- guard behaviour
- flaky and unavailable checks
- uncommitted changes preserved
- `gh` missing
- idempotent ship
- tree changed after verification
- environment scrubbing
- `stop` then `resume`
- recursion refused
- auth errors not retried
- no merge or force-push path
- simplifier: kept when checks pass, discarded when it breaks checks, touches tests or errors, never uses a retry, `--no-simplify`
- `/spec` files: parsed, refused when unapproved or unfilled (including the skill's own blank template), acceptance commands run as required checks and fed back on failure, `Visual:` criteria listed in the PR, `specs/` protected
