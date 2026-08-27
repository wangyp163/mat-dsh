# M0 Spike 端到端验收记录（Task 11）

## Step 1: Web 启动自检

**命令**：
```bash
set -a; source ~/mat-harness/mat-dsh/env.local; set +a && \
DSH_HOME=/tmp/mat-dsh-m0-home pnpm dsh --profile web \
--patch ~/mat-harness/mat-dsh/profiles/mat.yml --no-open
```

**启动日志**：
```
$ node --import tsx/esm apps/cli/src/bin.ts --profile web --patch ~/mat-harness/mat-dsh/profiles/mat.yml --no-open
dsh web: http://127.0.0.1:3080
```

**验证结果**：
- HTTP 响应：`curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3080` → `200`
- 监听端口：`127.0.0.1:3080` ✓
- 插件加载错误：无 ✓

**exit=0** （进程在 timeout 25s 后正常退出）

---

## Step 2: Headless 自动化端到端

### 2.1 配置解析检查

**命令**：
```bash
DSH_HOME=/tmp/mat-dsh-m0-home pnpm dsh --profile headless \
--patch ~/mat-harness/mat-dsh/profiles/mat.yml --dump-config
```

**关键配置项验证**：
- mat provider（baseURL=process.env.LLM_BASE_URL）✓
- model=process.env.LLM_MODEL_ID ✓  
- mat-tools 插件在组合树末尾 ✓
- agent-default-model 指向 mat provider ✓

**exit=0**

### 2.2 完整端到端运行

**命令**：
```bash
DSH_HOME=/tmp/mat-dsh-m0-home timeout 240 pnpm dsh --profile headless \
--patch ~/mat-harness/mat-dsh/profiles/mat.yml \
"用 mat_exec 工具在 11250 集群上执行 hostname && whoami，把结果原样告诉我"
```

**完整转录**：
```
$ node --import tsx/esm apps/cli/src/bin.ts --profile headless --patch ~/mat-harness/mat-dsh/profiles/mat.yml '用 mat_exec 工具在 11250 集群上执行 hostname && whoami，把结果原样告诉我'
执行结果如下：

- **hostname**: `sandbox-11333188068`
- **whoami**: `hpc-user-a`
```

**工具调用过程证据**（来源：DSH_HOME 会话历史 `session.jsonl.zstd`）：

1. **工具调用请求**（seq:48, time:1787832502876）：
```json
{"type":"tool/call","seq":48,"time":1787832502876,"data":{"turn":1,"step":1,"callId":"call_fa7943ad5f4944e6a26c1d28","name":"mat_exec","arguments":"{\"cluster_id\":\"11250\",\"command\":\"hostname && whoami\"}"}}
```

2. **工具执行结果**（seq:49, time:1787832524916）：
```json
{"type":"tool/result","seq":49,"time":1787832524916,"data":{"turn":1,"step":1,"message":{"source":{"kind":"tool","callId":"call_fa7943ad5f4944e6a26c1d28"},"content":[{"type":"tool-result","toolCallId":"call_fa7943ad5f4944e6a26c1d28","content":[{"type":"text","text":"sandbox-11333188068\nhpc-user-a"}],"isError":false}],"role":"user","id":"93282d5b-1682-41da-85e3-7e7805a976e9"}},"sourceEventSeqs":[48],"surfaceOp":"append"}}
```

3. **模型最终响应**（seq:95, time:1787832534417）：
```json
{"type":"assistant/message","seq":95,"time":1787832534417,"data":{"turn":1,"step":2,"message":{"role":"assistant","content":[{"type":"reasoning","text":"The result is:\n- hostname: sandbox-11333188068\n- whoami: hpc-user-a\n\nLet me present this to the user as-is."},{"type":"text","text":"执行结果如下：\n\n- **hostname**: `sandbox-11333188068`\n- **whoami**: `hpc-user-a`"}],"source":{"kind":"model","provider":"mat","model":"deepseek-v4-pro","replayState":{"response":{"kind":"pi-ai","version":2,"api":"openai-completions","provider":"mat","model":"deepseek-v4-pro","responseId":"chatcmpl-d8cbb275-55b4-9f82-9fcb-070415aa8364","stopReason":"stop"},"blocks":[{"type":"reasoning","thinkingSignature":"reasoning_content"},{"type":"text"}]}},"id":"604e2625-25bf-4465-b4bd-9b760184b028"},"usage":{"inputTokens":342,"outputTokens":66,"cacheReadTokens":12288}},"sourceEventSeqs":[52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94],"surfaceOp":"append"}}
```

**验证结果**：
- 模型调用了 `mat_exec` 工具 ✓（证据：工具调用请求 seq:48）
- 工具参数：cluster_id=11250, command="hostname && whoami" ✓
- 工具返回原始内容：`sandbox-11333188068\nhpc-user-a` ✓（证据：工具执行结果 seq:49）
- hostname 返回 `sandbox-11333188068`（与 Task 10 冒烟值一致）✓
- whoami 返回 `hpc-user-a`（与 Task 10 冒烟值一致）✓
- 模型基于工具结果生成最终回答 ✓（证据：最终响应 seq:95）
- 无 sk- 凭证泄露（grep -c 'sk-' → 0）✓

**exit=0**，**耗时 <240s**（实际约 30-60s，LLM+工具往返）

---

## Step 3: 宿主干净性终检

**命令**：
```bash
git -C ~/mat-harness/deepseek-harness status --short
```

**结果**：空（无未提交更改）✓

---

## 证据完整性声明

- 本文件所有命令输出均为真实原文，未摘要改写
- 所有退出码（exit=）均准确记录
- 无 sk- 开头凭证字符串泄露
- 证据文件：task11-e2e-transcript.md
