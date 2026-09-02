#!/usr/bin/env python3
"""Launch a wave of stress-test sessions with stagger.

usage: wave.py <stagger_seconds> <name> [<name> ...]
Each <name> maps to prompts/<name>.txt; sessions land in the stress-run workspace.
Registry: sessions.json
"""
import json
import sys
import time

from sess import rpc

WS = "d04dc7e7-8fc5-4ac7-9259-6809af09c2eb"
REG = "~/stress-run/sessions.json"


def load_reg():
    try:
        with open(REG) as f:
            return json.load(f)
    except Exception:
        return {}


def save_reg(reg):
    with open(REG, "w") as f:
        json.dump(reg, f, ensure_ascii=False, indent=1)


def launch(name):
    text = open(f"~/stress-run/prompts/{name}.txt").read()
    r = rpc("session.create", {"workspaceId": WS})
    if not r.get("ok"):
        raise RuntimeError(f"session.create failed: {r}")
    sid = r["value"]["sessionId"]
    print(f"[{name}] created {sid}", flush=True)

    r = rpc("session.selectModel", {
        "sessionId": sid, "provider": "mat",
        "model": "deepseek-v4-flash", "reasoningEffort": "high"})
    if not r.get("ok"):
        raise RuntimeError(f"selectModel failed: {r}")
    print(f"[{name}] model set", flush=True)

    r = rpc("session.prompt", {
        "sessionId": sid, "mode": "steer",
        "content": [{"type": "text", "text": text}],
        "clientTimeZone": "Asia/Shanghai"})
    if not r.get("ok"):
        raise RuntimeError(f"prompt failed: {r}")
    print(f"[{name}] prompt sent ({len(text)} chars)", flush=True)

    reg = load_reg()
    reg[name] = {"sessionId": sid, "prompt": f"prompts/{name}.txt",
                 "sentAt": time.strftime("%Y-%m-%dT%H:%M:%S%z")}
    save_reg(reg)


def main():
    stagger = int(sys.argv[1])
    names = sys.argv[2:]
    for i, name in enumerate(names):
        for attempt in range(3):
            try:
                launch(name)
                break
            except Exception as e:
                print(f"[{name}] attempt {attempt + 1} failed: {e}", flush=True)
                if attempt == 2:
                    print(f"[{name}] GIVING UP", flush=True)
                else:
                    time.sleep(10)
        if i < len(names) - 1:
            print(f"... stagger sleep {stagger}s", flush=True)
            time.sleep(stagger)
    print("WAVE DONE", flush=True)


if __name__ == "__main__":
    main()
