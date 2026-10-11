# <Short task title — becomes the branch name and PR title>

Status: draft
<!-- Change to "Status: approved" once you have reviewed this plan. The orchestrator refuses
     unapproved plans. After starting, the plan is frozen: edits here don't affect a running task. -->

## Objective
What should be true when this is done, and why. One short paragraph.

## Scope
- What to change (endpoints, modules, tables, screens).
- Anything explicitly out of scope.

## Acceptance criteria
- Observable, checkable behaviours ("GET /x returns 404 when ...").
<!-- Lines in this form run as required checks (bash -c from the repo root, exit code decides):
- AC-1: `cd backend && .venv/bin/python -m pytest -q tests/test_x.py` (exit 0)
-->

## Design constraints
- Patterns to follow, libraries to use/avoid, security rules (e.g. "queries run as the user via SupabaseDep so RLS applies").

## Required tests
- Tests that must exist and pass (file and behaviour). External services must be mocked.

## Allowed paths
<!-- Optional. If present, changes outside these globs are rejected. Include the tests. -->
- backend/api/**
- backend/tests/**

## Approvals
<!-- Optional pre-approvals; leave empty unless you mean it:
- destructive-migration   (DROP/TRUNCATE/ALTER TYPE or editing an existing migration)
- test-removal            (deleting or removing existing tests)
- lint-suppression        (adding noqa / type: ignore / skip markers)
-->
