#!/usr/bin/env python3
"""dsh web instance /api RPC wrapper for the stress test.

Commands:
  ws-list                          list workspaces
  ws-create <path> <title>         create workspace
  new <workspaceId|cwd>            create blank session -> sessionId
  send <sessionId> <file|-> [mode] send prompt (default mode=send)
  list                             session summaries
  report <sessionId>               decode transcript: turns, last assistant msg, tool calls
"""
import json
import os
import subprocess
import sys
import uuid

BASE = "http://127.0.0.1:3080/api/"
SESSIONS_ROOT = "~/.local/share/mat-dsh/sessions"


def rpc(method, payload):
    rpcid = str(uuid.uuid4())
    body = json.dumps({"type": "client-request", "rpcId": rpcid,
                       "method": method, "payload": payload})
    p = subprocess.run(
        ["curl", "-s", "-m", "120", "-X", "POST", BASE + method,
         "-H", "content-type: application/json", "-d", body],
        capture_output=True, text=True)
    if not p.stdout.strip():
        raise RuntimeError(f"empty response for {method}: {p.stderr}")
    return json.loads(p.stdout)["result"]


def find_session_dir(session_id):
    for ws in os.listdir(SESSIONS_ROOT):
        d = os.path.join(SESSIONS_ROOT, ws, session_id)
        if os.path.isdir(d):
            return d
    return None


def read_events(session_id):
    d = find_session_dir(session_id)
    if d is None:
        return []
    f = os.path.join(d, "session.jsonl.zstd")
    if not os.path.exists(f):
        return []
    p = subprocess.run(["zstd", "-dc", f], capture_output=True, text=True)
    events = []
    for line in p.stdout.splitlines():
        try:
            events.append(json.loads(line))
        except Exception:
            pass
    return events


def cmd_report(session_id):
    events = read_events(session_id)
    if not events:
        print(json.dumps({"error": "no transcript found"}))
        return
    turns, assistants, tools, questions = [], [], [], []
    for e in events:
        t = e.get("type")
        if t == "turn/start":
            turns.append({"turn": e.get("data", {}).get("turn"), "start": e.get("time")})
        elif t == "turn/end":
            d = e.get("data", {})
            if turns:
                turns[-1]["end"] = e.get("time")
                turns[-1]["reason"] = d.get("reason", {}).get("kind")
                turns[-1]["duration_s"] = round((e.get("time", 0) - turns[-1]["start"]) / 1000, 1)
        elif t == "assistant/message":
            d = e.get("data", {})
            content = (d.get("message") or {}).get("content") or d.get("content") or []
            if content is None:
                content = []
            text = "".join(c.get("text", "") for c in content
                           if isinstance(c, dict) and c.get("type") == "text")
            assistants.append({"seq": e.get("seq"), "time": e.get("time"), "text": text})
        elif t == "tool/call":
            d = e.get("data", {})
            tools.append({"seq": e.get("seq"), "name": d.get("name") or d.get("toolName"),
                          "input": json.dumps(d.get("input", d.get("arguments", {})),
                                              ensure_ascii=False)[:300]})
        elif t == "tool/result":
            d = e.get("data", {})
            if tools:
                tools[-1]["result"] = json.dumps(d, ensure_ascii=False)[:300]
    print(json.dumps({
        "sessionId": session_id,
        "turns": turns,
        "toolCalls": tools,
        "assistantMessages": assistants[-3:],
        "lastAssistantText": assistants[-1]["text"] if assistants else None,
    }, ensure_ascii=False, indent=1))


def main():
    cmd = sys.argv[1]
    if cmd == "ws-list":
        print(json.dumps(rpc("workspace.list", {}), ensure_ascii=False, indent=1))
    elif cmd == "ws-create":
        print(json.dumps(rpc("workspace.create",
                             {"path": sys.argv[2], "title": sys.argv[3]}),
                         ensure_ascii=False))
    elif cmd == "new":
        arg = sys.argv[2]
        payload = {"workspaceId": arg} if arg.startswith("session-") or len(arg) > 30 else {"cwd": arg}
        print(json.dumps(rpc("session.create", payload), ensure_ascii=False))
    elif cmd == "model":
        # usage: model <sessionId> [provider model effort]
        sid = sys.argv[2]
        provider = sys.argv[3] if len(sys.argv) > 3 else "mat"
        model = sys.argv[4] if len(sys.argv) > 4 else "deepseek-v4-flash"
        effort = sys.argv[5] if len(sys.argv) > 5 else "high"
        print(json.dumps(rpc("session.selectModel", {
            "sessionId": sid, "provider": provider, "model": model,
            "reasoningEffort": effort}), ensure_ascii=False))
    elif cmd == "send":
        sid, src = sys.argv[2], sys.argv[3]
        mode = sys.argv[4] if len(sys.argv) > 4 else "send"
        text = sys.stdin.read() if src == "-" else open(src).read()
        print(json.dumps(rpc("session.prompt", {
            "sessionId": sid, "mode": mode,
            "content": [{"type": "text", "text": text}],
            "clientTimeZone": "Asia/Shanghai",
        }), ensure_ascii=False))
    elif cmd == "list":
        print(json.dumps(rpc("session.list", {}), ensure_ascii=False, indent=1))
    elif cmd == "report":
        cmd_report(sys.argv[2])
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
