Vendored, unmodified, from https://github.com/anthropics/claude-plugins-official
(`plugins/code-simplifier`, commit b8e53f1c05dff3b6d751297f6527990ffc81c2f4, 2026-10-09).

Pinned so the loop never fetches or runs unreviewed plugin content. The agent's
JS/React "project standards" are overridden at call time by `orchestrator/prompts/simplify.md`
rather than by editing these files, so upstream updates can be diffed and re-copied.
