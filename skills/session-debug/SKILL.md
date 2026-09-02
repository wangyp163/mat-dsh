---
name: session-debug
description: 'Analyze DeepSeek Harness session.jsonl or session.jsonl.zstd trajectories: reconstruct turns and steps, pair tool calls with results, find errors and stale skill roots, inspect latency, and produce redacted reports.'
version: 0.1.0
metadata:
  adapted-for: mat-dsh
---

# DSH 会话轨迹调试

用于分析本机 DeepSeek Harness 会话轨迹，特别是 `session.jsonl` 与 `session.jsonl.zstd`。

## 安全规则

- 默认使用仓库内 `scripts/session-debug.ts`；它会对常见 API key、Bearer token、Authorization、cookie、password 和 secret 脱敏。
- 不得打印、复制或提交 `env.local`、credentials 文件或任何凭据原文。
- 不要直接把完整轨迹输出到对话；优先输出聚合摘要，再按 seq/turn/step 定位少量相关事件。
- 原始轨迹只读。不要编辑或覆盖用户提供的 session 文件。
- 分析 `.zstd` 时让工具自动解压；不要先生成长期保存的明文副本。

## 标准命令

从仓库根目录运行：

```bash
pnpm debug:session <session.jsonl|session.jsonl.zstd>
pnpm debug:session <session.jsonl|session.jsonl.zstd> --json
```

按用途缩小输出：

```bash
pnpm exec tsx scripts/session-debug.ts timeline <path> --json
pnpm exec tsx scripts/session-debug.ts tools <path> --json
pnpm exec tsx scripts/session-debug.ts anomalies <path> --json
```

- `timeline`：turn、step、状态和耗时。
- `tools`：tool call/result 配对、耗时和失败状态。
- `anomalies`：序号、生命周期、工具失败和错误事件。
- `report`/`inspect`：完整结构化摘要。

## 排障顺序

1. **文件完整性**：确认 zstd 可解压；确认 JSONL 行可解析。
2. **会话概况**：记录 session id、cwd、存储行数、展开后逻辑事件数和活动时长。
3. **生命周期**：检查 turn/step 是否闭合，以及 turn 的结束原因。
4. **序列一致性**：压缩 chunk 行展开后再检查 seq gap、duplicate 和 out-of-order。
5. **工具关联**：按 callId 配对 `tool/call` 与 `tool/result`，列出 failed/unmatched。
6. **错误原因**：优先读取结构化 `data.error`；其次读取 tool-result 的 `isError` 与脱敏文本。
7. **Skill 根目录**：检查 `skill` 返回的 `Base directory for this skill`。`/tmp/.../skills/...` 会报告 `stale-skill-root`。
8. **耗时热点**：列出最慢 step 和最慢工具，区分用户等待、远端作业等待与程序异常。
9. **结论分层**：分别报告业务任务、结果解析、文件传输和最终 turn 状态；`turn completed` 不代表所有工具成功。

## stale-skill-root 处理

如果出现：

```text
[stale-skill-root] skill <name> resolved from temporary path /tmp/.../skills/<name>
```

按以下顺序处理：

1. 确认开发版已停止旧进程。
2. 检查 `profiles/mat.yml` 的 `skill-filesystem` 只使用仓库路径：

```text
~/mat-harness/mat-dsh/skills
```

3. 从仓库根目录重启：

```bash
./scripts/dsh-web.sh restart
```

4. 新建会话并重新加载 skill；旧轨迹是 append-only，不会被修复。
5. 分析新轨迹，确认 `stale-skill-root` 为零，且 resource base 不再位于 `/tmp`。

## 输出模板

最终报告至少包含：

```text
Session: id / cwd / rows / events / activity span
Lifecycle: turns / steps / unclosed boundaries
Tools: total / matched / failed / unmatched
Errors: seq / turn / step / tool / redacted reason
Latency: slowest steps and tools
Skill roots: normal or stale-skill-root
Conclusion: primary fault, affected outcome, recommended retry boundary
```
