#!/usr/bin/env python3
"""Babysitter: auto-resend prompts for sessions killed by transient
'deepseek-v4-flash is offline' 400 errors. Runs forever, 60s period.

- Reads registry sessions.json (name -> sessionId, prompt file, retries).
- A session qualifies if its LAST turn/end reason is error with 'is offline'
  (or BadRequestError) AND it is not currently running.
- Resends the original prompt text (mode steer), increments retries,
  gives up after 3 retries per session.
- Never touches sessions whose last turn completed normally.
"""
import json
import sys
import time

sys.path.insert(0, "~/stress-run")
from sess import rpc, read_events  # noqa: E402

REG = "~/stress-run/sessions.json"
LOG = open("~/stress-run/reflaky.out", "a", buffering=1)


def log(*a):
    print(time.strftime("[%H:%M:%S]"), *a, file=LOG)


def last_turn_state(sid):
    evs = read_events(sid)
    last_end = None
    for e in evs:
        if e.get("type") == "turn/end":
            last_end = e
    if last_end is None:
        return None
    return last_end.get("data", {}).get("reason", {})


def main():
    while True:
        try:
            reg = json.load(open(REG))
            listing = rpc("session.list", {}).get("value", {}).get("items", [])
            running = {it["sessionId"] for it in listing if it.get("running")}
            for name, rec in list(reg.items()):
                sid = rec.get("sessionId")
                if not sid or sid in running:
                    continue
                retries = rec.get("retries", 0)
                if retries >= 3:
                    continue
                reason = last_turn_state(sid)
                if not reason or reason.get("kind") != "error":
                    continue
                msg = str(reason.get("error", {}).get("message", ""))
                if "is offline" not in msg and "BadRequestError" not in msg:
                    continue
                text = open(f"~/stress-run/{rec['prompt']}").read()
                r = rpc("session.prompt", {
                    "sessionId": sid, "mode": "steer",
                    "content": [{"type": "text", "text": text}],
                    "clientTimeZone": "Asia/Shanghai"})
                rec["retries"] = retries + 1
                json.dump(reg, open(REG, "w"), ensure_ascii=False, indent=1)
                log(f"{name} offline-error -> resent (retry #{retries + 1}) ok={r.get('ok')}")
        except Exception as e:
            log("loop error:", repr(e)[:200])
        time.sleep(60)


if __name__ == "__main__":
    main()
