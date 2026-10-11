---
name: spec
description: "Settle every requirement up front by asking all the questions before any code is written, record them in a spec file (specs/*.md), and after approval hand implementation to the orchestrator (python3 -m orchestrator). This skill never implements. Use when the user says \"spec\", \"specification\", \"requirements\", or \"plan this feature\"; when a new feature or system is big enough that requirements should be pinned down before building; or when asked to revise an existing spec. Do not use for just reading or explaining an existing spec."
---

# /spec: settle the decisions up front, then hand off to the orchestrator

> **Modified for this repository** from dualform-labs/spec-skill @ 340ea16 (Apache-2.0), translated to English.
> Changes are listed in `VENDORED.md`. This skill only plans. After approval, implementation runs through
> `python3 -m orchestrator` (isolated worktree, independent verification, PR for human review). It never
> implements in this session.

The point of the spec phase is to make the implementing agent autonomous. Ask everything that needs asking before implementation, and finish the spec as **"an instruction file that a fresh AI session, given only this file, could complete without asking a single question."**
After approval, the orchestrator implements unattended; this session does not implement. The implementing agent can't ask questions mid-run, so any ambiguity left in the spec turns directly into a stop (`needs_human`) or rework.

When to use it: any one of: work that spans multiple files or half a day or more; two or more decisions only the user can make; expensive to redo.
Don't use it for one-line fixes or obvious single-shot tasks (too much process); just do those directly.
If the requirements are already concrete in the conversation, take the **lightweight path**: skip R1–R3, go straight to drafting (Gate A still applies), and replace the interview with a playback plus Gate B. The mandatory R3 question can't be skipped: after Gate A passes and right before presenting the full text, ask it on its own with AskUserQuestion, record the answer in §12, then run Gate B.

## Steps

### 0. Arguments and mode
- `/spec <one-line summary>`: use the summary as the seed and start at step 1.
- `/spec <path to an existing spec>` (or the same feature name as an existing spec): revision mode (see "Revision (re-run)"). Matching by feature name happens after step 1 has fixed the save location, against that `specs/` directory (until then, start in normal mode).
- No argument: infer the target from recent conversation. If you can't, make the first AskUserQuestion "what are we building?" (candidates plus free text).
- **Output language (decide once, first):** read `config.yml` in the skill directory (missing = `output_language: auto`). It sets the language of interview questions, playbacks and the spec's prose (§1–13): `ja` = Japanese, `en` = English, `auto` = the main language of the conversation or project. Code, commands, paths, slugs and technical terms are always English. AskUserQuestion option labels follow this language too. If the user wants a different language, tell them to edit that one line in `config.yml` and start a new session.

### 1. Investigate first: questions are the last resort
**Asking what you could have looked up, or what the conversation already answered, is a stall.** Before asking anything:
1. **Sweep the conversation.** Pull out requirements, constraints and preferences already stated and put them on a do-not-re-ask list. Record those answers in §12 as dated D-n entries when drafting (stated in conversation = the user's decision; this record is what prevents re-asking across sessions).
2. **Identify and read the project.** git root, existing `specs/`, CLAUDE.md, README, the main code.
   Settle the tech stack, existing conventions and reusable assets here (don't ask). If an existing spec in `specs/` covers the same feature, treat it as the source of truth and switch to revision mode (don't create a new file because of a slug spelling difference).
   Also read `orchestrator/README.md` and `orchestrator/config.toml`. The verification that runs outside the agent after implementation (ruff, mypy, pytest, gitleaks, ...) and its constraints (external services are mocked, no network or real credentials, protected files) are premises for §9 and §11 (don't ask).
3. **Check environment constraints.** Global working rules and constraints already in memory (budget, banned tech, machine setup) are premises, not questions.
4. **Look up external facts yourself.** Technical feasibility and limits (does the library have the feature, API limits and pricing, SDK/platform specifics, version differences) are checked with WebSearch and WebFetch (or an official-docs MCP if available) before they go into the spec. Asking the user "can X do Y?" is a stall: **research facts, ask only for decisions** (intent, preferences, priorities). Record researched facts in §9/§10 with a one-line source.
5. **Filter what's left.** Keep only what only the user can decide, and prepare a recommended default for each.

The spec file always lives at the root of this repository: `specs/<kebab-slug>.md` (create `specs/` if missing). The orchestrator takes this path via `--plan`.
Slugs are lowercase kebab-case. Translate a non-English feature name into English for the slug (e.g. "Low-stock alert!" → `low-stock-alert`).

### 2. Interview: every question goes through AskUserQuestion
**Never ask a bare text question. Every question uses the AskUserQuestion tool.** It shows as a structured dialog and reaches notification/remote setups, so the user can answer while away; a bare text question doesn't.
- Core questions the user may want to answer in their own words (purpose and definition of success, a walkthrough of the flow, concrete input/output examples, "the accident that must never happen") also go through AskUserQuestion, with the recommended answer and typical answer types as options. The user can pick an option or write in the auto-provided free-text field; add "pick the closest, or write your own" to the question.
- Choices that enumerate naturally (interaction style, failure policy, storage/distribution, priorities) become options directly.
- **One round = one AskUserQuestion call (up to 4 questions).** Batch independent questions into one call to cut rounds (dependent questions go to the next round).

AskUserQuestion rules:
- Up to 4 questions per call, 2–4 options each, headers of 12 characters or fewer. **Don't add "Other" or "None" options** (free text is added automatically, and the user can skip).
- Put the recommended option first with "(Recommended)" at the end of its label. For multi-select questions use multiSelect: true and phrase the question for multiple answers.
- Visual/UI choices may include a preview mock (ASCII layout etc.) to compare (previews only work on single-select questions; if unsupported, show the mocks as plain text first).
- Questions whose answer is a premise for another question don't go in the same call (next round).
- Skip anything already answered by free text or the conversation.
- Filter each question with "does the answer change the design?" If not, don't ask; make it a placeholder (T).
- Where AskUserQuestion is unavailable, present numbered text options with a recommended default instead.

Round structure (coarse to fine, most irreversible first; shorten when answers resolve things):
| R | Settles | Contents (→ template §) |
|---|---|---|
| 1 | Direction: purpose, context, boundaries, deal-breakers | Definition of success / who uses it and when / v1 scope and "won't do" / prohibitions, deadline, environment (→ §1·2·3·9) |
| 2 | Skeleton: the core of the feature | I/O formats (get real examples) / walkthrough of the main flow / persistent data and what must not be lost / how far it integrates with existing assets (→ §4·5·6·10) |
| 3 | Outline: failures, non-functionals, verification | Policy for unexpected input and the worst accident / numeric non-functional thresholds (seconds, counts, cost) / acceptance scenarios / how much may be decided by placeholder (→ §7·8·11·12) |
| 4 | Close: zero misunderstanding | No new questions. Play back every answer plus the placeholder list as "my understanding is...". If nothing is unresolved, R4 can merge into Gate B's full-text presentation |

Handling answers:
- End each round with a one-paragraph summary of your understanding, to catch mismatches immediately.
- If an answer pre-empts another topic, drop that question and add it to the do-not-re-ask list.
- If a free-text answer spans several topics, split it by topic in the playback and say which topic each part was recorded under.
- If an answer is vague, rephrase as options or concrete examples and re-ask **once**. If still vague, go with the recommendation, marked clearly as a T placeholder.
- If the user answers with a question ("which do you think?"), give your recommendation and reason immediately, add "if there's no objection I'll settle on this", and move on. Include it in the next playback; if not corrected, record it as D (don't ask the same question again).
- In R3, always ask with AskUserQuestion: "I'll fill in details with placeholders. Is there any area **you don't want me to decide on my own**?" (example options: "Nothing in particular, go ahead (Recommended)", "Yes, specified in free text"). Record the answer in §12 "Do-not-decide areas". The implementing agent must stop and report `needs_human` before making a new decision in those areas.
  **Even when rounds are shortened, or after the user says "go ahead", this one question is always asked on its own** (it confirms the scope of delegation itself and can't be skipped). If skipped or unanswered, record "none (user skipped YYYY-MM-DD)" in §12 with its source.
- If the user says "go ahead / up to you", fill the remaining topics (including later rounds) with recommended defaults as T placeholders and move to drafting.
- After R2 you may save what's known so far with status: draft plus a list of unfilled topics at the end of the file (overwritten in later rounds; protects interview results from a dropped session).

### 3. Draft: Gate A (self-check)
**Write the spec in the output language chosen in step 0 (code, commands, slugs and technical terms always English). Fill §1–12 and save the file immediately with status: draft before presenting it** (leave §13 as the template comment; implementation logs live in the PR and task logs). Save first, present second, so the interview isn't lost if the session drops before approval.
Every section has one of only three kinds of basis: ① the user's answer ② the result of your own investigation ③ a T placeholder (with a one-line reason). Presenting blanks or "TBD" violates the rules. If a section genuinely has nothing to say, write "N/A" plus a one-line reason (don't fake completeness with placeholders).

Gate A = **the autonomy check**: "Could a fresh AI session, handed only this file, complete the implementation without asking anything?" What counts as settled, per topic:

| § | Topic | Settled when |
|---|------|-----------|
| 1 | Purpose, definition of success | The moment the user will think "glad we built this" fits in one sentence |
| 2 | Users and context | Personal use vs. distributed is clear, plus frequency and situations of use |
| 3 | Scope boundary | Both the v1 features and the "won't do" list exist |
| 4 | I/O and interface | Input examples, output examples and the entry point (CLI/GUI/API/automatic) are concrete |
| 5 | Main flow | One use is described start to finish; interruption and concurrent runs are decided |
| 6 | Data and persistence | What to keep / what can be volatile / what must not be lost are distinguished |
| 7 | Failure handling | An explicit policy for unexpected input (stop, warn and continue, skip, retry, fall back, ...) and "the accident that must never happen" are written down |
| 8 | Non-functional | Performance, sensitive data and cost are numbers/thresholds (adjectives = not settled) |
| 9 | Environment, constraints | Runtime environment, prohibitions and deadline (deal-breakers) are settled |
| 10 | Existing assets | Integrate / replace / standalone is decided, and what may be touched is settled |
| 11 | Acceptance criteria | Every item is runnable: a copy-pasteable command, or numbered visual steps plus the expected result. Adjective-only ACs fail. Command ACs follow the §11 template format so the orchestrator can run them as required checks |
| 12 | Delegation | The line between "placeholder is fine" and "don't decide this on your own" is settled |

**Gate A is not passed by self-declaration.** Do one of:
- (a) Give a fresh-context general-purpose subagent **only** the spec file and have it list "what would you ask if you had to implement from this alone?" Any question at all means it's not ready; fix that item and re-check.
- (b) Where subagents aren't available, output a table in chat quoting one supporting line from the relevant section for each of the 12 topics (a topic you can't quote = No).

Any remaining No is the subject of another question (or a placeholder). The only exception: the lightweight path's temporary §12 entry "Unconfirmed (to ask before Gate B)" is the one acceptable No; fill it with the mandatory R3 question right after, before Gate B.

### 4. Present and approve: Gate B
1. **Present the full spec as plain text** (the whole thing, not a summary; don't cram long text into an AskUserQuestion body).
2. Confirm with one AskUserQuestion: "Approve this spec?"
   - Options: **"Approve (Recommended)", "I want changes"**
3. Branches:
   - **I want changes**: don't redo the whole interview; update only the affected sections, show the diff, and run Gate B again.
   - **Approve**: set status: approved and approved: {YYYY-MM-DD}, save, show this command, and **stop**:
     `python3 -m orchestrator start --plan specs/<slug>.md` (add `--auto-ship` to go all the way to the PR after verification)

### 5. Don't implement: hand off to the orchestrator
This skill doesn't write code. If the user asks "just implement it now" after approval, don't implement in this session; point them to the command above (so the work goes through the isolated worktree, independent verification outside the agent, guards and a PR). If they still want to implement by hand, that happens outside this skill.

What the orchestrator takes care of (don't duplicate it in the spec):
- Implements in an isolated worktree and, after every turn, runs the §11 command ACs plus ruff, mypy, pytest, gitleaks etc. outside the agent, sending failures back a bounded number of times.
- Hands the implementing agent a copy of the spec frozen at start, on every turn (editing the file mid-run has no effect).
- Lists visual ACs in the PR description as manual checks for the reviewer.
- Leaves results, cost and remaining risks in the PR description and `.orchestrator/tasks/<id>/`. The spec stays at status: approved (progress isn't written back).
- Stops with `needs_human` when the implementing agent needs a decision (`python3 -m orchestrator resume --answer "..."`). To keep that answer in the spec as well, revise it (revision +1) and add a D-n entry to §12.

## Spec template (follow the format exactly)

```markdown
# {Feature name}

- status: draft        <!-- draft | approved -->
- project: {target project root}
- created: {YYYY-MM-DD} / approved: no
- revision: 1

## 1. Purpose and definition of success
{The problem it solves. The moment, a week after it ships, when the user thinks "glad we built this".}

## 2. Users and context
{Who (just me / small group / public), how often, in what situations.}

## 3. Scope
**Do (v1):**
- {…}
**Won't do (explicitly out of scope / deferred):**
- {…}

## 4. Inputs, outputs and interface
{Input format and real example / output format and real example / entry point (CLI, GUI, API, automatic).}

## 5. Main flow and state
{One typical use, start to finish. Behaviour on interruption, retry and concurrent runs.}

## 6. Data and persistence
{What to keep / what can be volatile / what must not be lost, and its backup / where it's stored.}

## 7. Failure handling
{Unexpected input: stop | warn and continue | skip | retry | fall back. Retry policy for environment failures. The accident that must never happen.}

## 8. Non-functional requirements (as numbers)
{Performance: within N seconds / sensitive data and whether it may leave the system / cost ceiling: N per month.}

## 9. Environment, constraints and prohibitions
{Runtime environment (machine, resident or manual) / technologies and services that must not be used / deadline and priorities.}

## 10. Integration with existing assets
{Integrated or standalone / what may be changed and what must not be touched / conventions to follow.}

### Allowed paths
<!-- Optional. If present, the orchestrator sends back any change outside these globs. Include test paths. Delete the subsection if unused. -->
- {glob, e.g. backend/api/**}

## 11. Acceptance criteria (runnable checks)
<!-- Every item = a runnable command, test, or numbered visual steps, plus the expected result. Adjectives only = not allowed.
     An AC a stub would pass (file exists, import succeeds, --help runs, ...) has zero verification power and fails —
     when in doubt, ask "would an unimplemented stub pass this AC?". At least one AC runs a real §4 example end to end.
     Format required by the orchestrator:
     Command AC = "- [ ] AC-n: `command` → expected result (exit N)". The text inside the first backticks runs as-is with
     bash -c from the repository root, and only the exit code decides pass/fail ((exit N) defaults to 0). Make the command
     itself verify the expected output (a pytest test, | grep -q, ...). No dependence on the network, real credentials or a
     running server (call the API through TestClient). The backend venv is backend/.venv.
     Visual AC = "- [ ] AC-n: Visual: steps → expected result" is not run automatically; the reviewer checks it from the PR. -->
- [ ] AC-1: `{command}` → {expected result} (exit 0)
- [ ] AC-2: Visual: {steps} → {what should be observed}

## 12. Decision log (two layers)
### User decisions (D): never re-asked; only the user can change them
- D-1: {decision} ({YYYY-MM-DD})
### AI placeholders (T): the user can veto; may be added during implementation
- T-1: {placeholder} — reason: {one line on why it's the most reasonable assumption}
### Do-not-decide areas: the implementing agent stops and asks (needs_human) only when a new decision touches these
- {The R3 answer as given. If none, write "none (user answered / user skipped YYYY-MM-DD)" with its source. On the lightweight path, write "Unconfirmed (to ask before Gate B)" when drafting, and always overwrite it with the answer.}
### Approvals
<!-- Optional. One per line, only to pre-approve orchestrator guards: destructive-migration / test-removal / lint-suppression -->

## 13. Implementation log and evidence
<!-- Implementation logs and AC evidence live in the orchestrator's PR description and .orchestrator/tasks/<id>/. You may add the PR URL here. -->
```

§1–10 are **hand-distilled decisions**, not transcripts, in 2–5 lines each. §11 contains only checks that exist and can actually be run.

## Status transitions
`draft → approved` (the only two statuses this skill writes)
- A transition is always an edit to the file's status line (plus the date line). A verbal-only transition is invalid.
- If the work is interrupted between drafting and approval (session dropped, user left), leave status: draft and list the unfilled topics at the end of the file (resume from there with a diff-only interview).
- Requirement changes after approval go through revision (below). A running orchestrator task uses the copy frozen at its start and isn't affected; start a new task to pick up changes.

## Revision (re-run)
`/spec <path to an existing spec>` or re-running with the same feature name:
- **status: draft (interrupted before approval)**: resume, not a revision. Continue the diff-only interview from the unfilled-topics list at the end of the file (if there's no list, resume at Gate B; revision unchanged).
- **status: approved**: one AskUserQuestion (options: "No changes, implement with the orchestrator (Recommended)", "There are changes"). No changes: show the start command and stop. Changes: revision mode.
- **Anything else (implementing / done from older versions)**: treat as revision mode.
- **Revision mode:** read the existing spec and **never reopen D-n (user decisions)**. Ask only about what changes or is added.
  This is also where T placeholders get confirmed (T → D promotion): don't raise new questions; check individually only the T entries this change touches, and promote the rest together on the re-approval at Gate B.
  Bump revision by 1, add a one-line note of the change, set status back to draft, and run Gate B again. Even small additions go through Gate B again (the orchestrator only accepts approved specs).

## Prohibitions
- **Don't ask what you can look up.** "What language is this project in?" wastes a question and costs trust.
- **Never reopen settled decisions.** Once something is known it's never asked again. Re-confirm only through "my understanding is..." playback.
- **No leading questions** ("we'll implement it as X, right?"). Present neutral options with a recommendation and a reason, so rejecting is cheap.
- **No blank open questions** ("tell me the requirements", "anything else?"). Always include examples, options or a default.
- **One question, one topic.** Compound questions turn unanswered parts into silent agreement.
- **Don't interrogate with jargon.** Not "do you need idempotency?" but "should it be safe if the same action runs twice?" Ask about behaviour.
- **Don't start from HOW.** You may ask for preferred means, but always trace them back to the goal and validate them together.
- **No non-functional agreement without a number.** Nothing is settled until it's in seconds, counts or money.
- **No ACs a stub would pass, and no ACs that can't be run** (anti-Potemkin). The orchestrator runs command ACs mechanically.
- **Don't implement in this session.** Once approved, hand off to the orchestrator.

Investigate before you ask. Once you ask, write it down. Once approved, hand it off.
