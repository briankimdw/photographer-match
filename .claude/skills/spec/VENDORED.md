# Vendored: spec-skill

Source: https://github.com/dualform-labs/spec-skill (`skills/spec/`), commit
`340ea16d3bb4f2aaea71455a229df569a2cb21bc` (2026-08-26). Apache-2.0; `LICENSE` and `NOTICE`
are copied unchanged. Community project, not affiliated with Anthropic.

## Changes from upstream

`SKILL.md` has been **modified** for this repository:

- **Translated to English.** Upstream writes its rules in Japanese.
- **Plans only, never implements.** Upstream's Gate B offered "approve & start" and then built in
  the same session (its steps 5–6). That bypasses the orchestrator's isolated worktree,
  independent verification, guards and PR. Gate B now offers only **Approve** / **I want
  changes**. Approve sets `status: approved` and prints
  `python3 -m orchestrator start --plan specs/<slug>.md`. Step 5 explains the handoff.
- **Statuses are `draft → approved` only.** `implementing`/`done`, the completion report and §13
  evidence logging were removed: evidence now lives in the orchestrator's PR description and
  `.orchestrator/tasks/<id>/`.
- **Specs always go in this repo's `specs/`.** The `~/specs/` fallback was removed.
- **The investigation step reads the orchestrator's README and config**, so the spec's constraints
  and acceptance criteria match what the orchestrator verifies.
- **§11 acceptance criteria use a machine-runnable format.** The text in the first backticks runs
  with `bash -c` from the repo root, and the exit code decides pass/fail. The orchestrator runs
  these as required checks. `Visual:` ACs are listed in the PR for the reviewer.
- **New optional template subsections** read by the orchestrator: `### Allowed paths` (§10) and
  `### Approvals` (§12).
- **Do-not-decide areas (§12) tell the implementing agent to stop with `needs_human`.**
- **Revisions of approved specs always go back through Gate B**, because the orchestrator only
  accepts approved specs.

`config.yml`: `output_language` is pinned to `en`.

Not vendored: `scripts/spec-lint.sh` and `scripts/hooks-snippet.json`. At this commit the lint
script checks fields (`- log:`, evidence ledger, completion report) that the published template
never produces, so it would flag every spec. The orchestrator's own plan parser validates specs
instead.
