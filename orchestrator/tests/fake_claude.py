#!/usr/bin/env python3
"""Stand-in for `claude -p` in tests. Replays scenario.json (next to this file) turn by turn.

Each turn: {"write": {path: text}, "delete": [path], "sleep": secs, "status": "done",
            "summary": "...", "questions": [...], "cost": 0.1, "exit": 0,
            "raw": "<replaces JSON output>"}
The last turn repeats once the list is exhausted. Every call is recorded in calls.jsonl
(argv, prompt, env) so tests can assert on what the orchestrator sent.
"""

import json
import os
import sys
import time
from pathlib import Path

here = Path(__file__).resolve().parent
turns = json.loads((here / "scenario.json").read_text())
log = here / "calls.jsonl"
n = sum(1 for _ in log.open()) if log.exists() else 0
turn = turns[min(n, len(turns) - 1)]

prompt = sys.stdin.read()
with log.open("a") as f:
    f.write(json.dumps({"argv": sys.argv[1:], "prompt": prompt, "env": dict(os.environ)}) + "\n")

time.sleep(turn.get("sleep", 0))
for rel, text in turn.get("write", {}).items():
    p = Path.cwd() / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text)
for rel in turn.get("delete", []):
    (Path.cwd() / rel).unlink()

if "raw" in turn:
    print(turn["raw"])
else:
    argv = sys.argv[1:]
    sid = (
        argv[argv.index("--resume") + 1]
        if "--resume" in argv
        else argv[argv.index("--session-id") + 1]
    )
    print(
        json.dumps(
            {
                "type": "result",
                "subtype": turn.get("subtype", "success"),
                "is_error": turn.get("exit", 0) != 0,
                "result": turn.get("summary", "ok"),
                "session_id": sid,
                "total_cost_usd": turn.get("cost", 0.05) * (n + 1),
                "structured_output": {
                    "status": turn.get("status", "done"),
                    "summary": turn.get("summary", "ok"),
                    "questions": turn.get("questions", []),
                },
            }
        )
    )
sys.exit(turn.get("exit", 0))
