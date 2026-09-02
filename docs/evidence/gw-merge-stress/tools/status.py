#!/usr/bin/env python3
"""One-line-per-session status: running / turns / last transcript write."""
import json
import os
import subprocess
import sys
import time

sys.path.insert(0, "~/stress-run")
from sess import rpc  # noqa: E402

SESSIONS_ROOT = "~/.local/share/mat-dsh/sessions"


def main():
    reg = json.load(open("~/stress-run/sessions.json"))
    bysid = {v["sessionId"]: k for k, v in reg.items()}
    r = rpc("session.list", {})
    now = time.time()
    rows = []
    for it in r.get("value", {}).get("items", []):
        sid = it["sessionId"]
        name = bysid.get(sid)
        if not name:
            continue
        p = it.get("projections", {}).get("values", {})
        st = p.get("sessionStats", {})
        # transcript mtime
        age = "?"
        for ws in os.listdir(SESSIONS_ROOT):
            d = os.path.join(SESSIONS_ROOT, ws, sid)
            f = os.path.join(d, "session.jsonl.zstd")
            if os.path.exists(f):
                age = f"{int(now - os.path.getmtime(f))}s"
        rows.append((name, sid[:16], "RUN" if it.get("running") else "idle",
                     st.get("turns"), st.get("steps"), age,
                     (p.get("title") or "")[:24]))
    for row in sorted(rows):
        print("  ".join(str(x) for x in row))


if __name__ == "__main__":
    main()
