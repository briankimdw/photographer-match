#!/usr/bin/env python3
"""Stand-in for the GitHub CLI. Records every call to gh_calls.jsonl; keeps PRs in prs.json."""

import json
import sys
from pathlib import Path

here = Path(__file__).resolve().parent
args = sys.argv[1:]
body = sys.stdin.read() if "--body-file" in args else ""
with (here / "gh_calls.jsonl").open("a") as f:
    f.write(json.dumps({"args": args, "body": body}) + "\n")

prs_file = here / "prs.json"
prs = json.loads(prs_file.read_text()) if prs_file.exists() else []

if args[:2] == ["auth", "status"]:
    sys.exit(0)
if args[:2] == ["pr", "list"]:
    head = args[args.index("--head") + 1]
    print(json.dumps([p for p in prs if p["head"] == head]))
    sys.exit(0)
if args[:2] == ["pr", "create"]:
    head = args[args.index("--head") + 1]
    url = f"https://github.example/pr/{len(prs) + 1}"
    prs.append({"url": url, "head": head, "state": "OPEN", "body": body})
    prs_file.write_text(json.dumps(prs))
    print(url)
    sys.exit(0)
print(f"fake gh: unsupported {args}", file=sys.stderr)
sys.exit(1)
