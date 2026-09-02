#!/usr/bin/env python3
"""Minimal HPC remote-shell driver (mirrors mat-core CurlMcpTransport).

Usage: scx.py <cluster_id> <command> [timeout_seconds]
Prints business JSON {code, data, message} from remote_shell_execute.
"""
import json
import os
import re
import subprocess
import sys

MCP_KEY = os.environ.get("MAT_MCP_KEY", "")
BASE = os.environ.get("MAT_MCP_BASE", "https://mcp-gateway.example.internal/api")
SERVICE_ID = "7552849000000000000"
URL = f"{BASE}/mcp/{MCP_KEY}/{SERVICE_ID}/mcp"


def curl(body: str, sid: str = None, max_time: int = 30) -> str:
    args = [
        "curl", "-k", "-s", "--noproxy", "*",
        "-H", "Content-Type: application/json",
        "-H", "Accept: application/json, text/event-stream",
    ]
    if sid:
        args += ["-H", f"Mcp-Session-Id: {sid}"]
    args += ["-D", "-", "-d", body, "--max-time", str(max_time), URL]
    p = subprocess.run(args, capture_output=True, text=True, timeout=max_time + 30)
    return p.stdout


def init() -> str:
    body = json.dumps({
        "jsonrpc": "2.0", "id": 1, "method": "initialize",
        "params": {
            "protocolVersion": "2024-11-05", "capabilities": {},
            "clientInfo": {"name": "stress-runner", "version": "0.1"},
        },
    })
    out = curl(body)
    m = re.search(r"mcp-session-id:\s*(\S+)", out, re.I)
    if not m:
        raise RuntimeError(f"no mcp-session-id in response:\n{out[:500]}")
    return m.group(1)


def call(sid: str, name: str, args: dict, timeout_s: int = 60) -> dict:
    body = json.dumps({
        "jsonrpc": "2.0", "id": 1, "method": "tools/call",
        "params": {"name": name, "arguments": args},
    })
    out = curl(body, sid, max_time=timeout_s + 10)
    for line in out.split("\n"):
        if not line.startswith("data: "):
            continue
        try:
            mcp = json.loads(line[6:])
            text = mcp["result"]["content"][0]["text"]
            return json.loads(text)
        except Exception:
            continue
    raise RuntimeError(f"empty MCP stream:\n{out[:500]}")


def main() -> None:
    cluster = sys.argv[1]
    command = sys.argv[2]
    timeout_s = int(sys.argv[3]) if len(sys.argv) > 3 else 60
    if not MCP_KEY.startswith("sk-"):
        sys.exit("MAT_MCP_KEY missing/invalid")
    sid = init()
    r = call(sid, "remote_shell_execute",
             {"clusterId": cluster, "command": command, "timeoutSeconds": timeout_s},
             timeout_s)
    print(json.dumps(r, ensure_ascii=False))


if __name__ == "__main__":
    main()
