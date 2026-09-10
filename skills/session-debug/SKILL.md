---
name: session-debug
description: 'Analyze DeepSeek Harness session.jsonl or session.jsonl.zstd trajectories: reconstruct turns and steps, pair tool calls with results, find errors and stale skill roots, inspect latency, and produce redacted reports.'
version: 0.3.0
metadata:
  adapted-for: mat-dsh
  adaptation: 2026-09-03 M2 吸收 ts/qst2/qst3 压测实证：新增「读数时效」节（zstd 块延迟落盘≥15min、RPC projection 重启后冻结、重启前双源确认）、turn/end reason.kind 归因规则（缺 turn/end=turn 被杀）、工具错误 fatal/benign 分类、行结构速查、"返回层崩溃≠远端没跑"签名（TDZ `Cannot access 'id' before initialization`，mat_gaussian 远端动作已执行）、运行细节（stdout/stderr、勿 2>/dev/null）；版本 0.2.0 续跳号；2026-09-10 M3 新增「缺陷归源：workflow/skill 侧问题不绕行」原则——绕行签名清单（手工提取替代 post/自绘产物/改链绕开推进缺陷/手改源码）、四元组输出要求（现象→绕行动作→被掩盖缺陷→源头修复建议）、科学试错与明文备选路径不算绕行的边界、multistep-irc-0909 standalone post FileNotFoundError 实证，报告模板加 Defect routing 行；版本 0.3.0（新原则按功能升 minor）
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

运行细节：必须从仓库根目录运行；JSON 结果走 stdout、诊断噪声走 stderr——首次排障不要用 `2>/dev/null`（会把失败原因一起吞掉，表现为静默无输出）。

## 读数时效（先读，2026-09-03 实证）

轨迹文件是**最终一致**的，不能当实时状态用：

- `session.jsonl.zstd` 的压缩块**延迟落盘**，实测可滞后 15 分钟以上——"文件最后事件时间很久"**不等于** turn 挂起。
- dsh 重启后 RPC（如 `session.list` 的 projection、`lastPromptAt`）也可能停留在旧值；重启后投递的 prompt 可能 accepted 却迟迟不起 turn。
- 判定"turn 是否在跑"用**实时事件流**（mux/websocket）或拉长观察窗口；zstd 读数只用于**已闭合 turn 的取证**。
- 要重启 dsh（杀所有在途 turn、被杀 turn 不留 `turn/end`）前，必须**双源确认** turn 真挂（实时流无事件 + 会话外 job 状态对账），重启后在轨迹/报告里标注人工重启边界。

## 排障顺序

1. **文件完整性**：确认 zstd 可解压；确认 JSONL 行可解析。
2. **会话概况**：记录 session id、cwd、存储行数、展开后逻辑事件数和活动时长；**同时记录读数时点与最后事件时间的差**——差值大说明读数滞后，结论要降权。
3. **生命周期**：检查 turn/step 是否闭合，以及 turn 的结束原因。归因规则：`turn/end` 的 `data.reason.kind` ∈ `completed` / `error` / `interrupted`；**缺 `turn/end` = turn 被杀死**（典型：dsh 静默重启、进程崩溃），不是"还在跑"。
4. **序列一致性**：压缩 chunk 行展开后再检查 seq gap、duplicate 和 out-of-order。
5. **工具关联**：按 callId 配对 `tool/call` 与 `tool/result`，列出 failed/unmatched，并**区分致命与良性**：影响业务结果（计算、监控、post）的失败要逐条归因；呈现层失败（如 `read_image` 读图）单独归类，不触发全量重查。行结构速查：`tool/call` 在 `data.{turn,step,callId,name,arguments}`；`tool/result` 文本在 `data.message.content[].content[].text`（`isError` 在外层）。
6. **错误原因**：优先读取结构化 `data.error`；其次读取 tool-result 的 `isError` 与脱敏文本。
7. **Skill 根目录**：检查 `skill` 返回的 `Base directory for this skill`。`/tmp/.../skills/...` 会报告 `stale-skill-root`。
8. **耗时热点**：列出最慢 step 和最慢工具，区分用户等待、远端作业等待与程序异常。
9. **结论分层**：分别报告业务任务、结果解析、文件传输和最终 turn 状态；`turn completed` 不代表所有工具成功。**警惕"返回层崩溃 ≠ 远端没跑"**：同一工具连续多次相同 error（如 `Cannot access 'id' before initialization` TDZ）且该工具有远端副作用时，远端动作（落盘、sbatch、作业提交）可能已执行——必须先会话外对账（`mat_job_status`/sacct/远端文件），不能按"工具未执行"往下走（2026-09-03 实证：mat_gaussian 4/4 崩溃但作业已提交）。

## 缺陷归源：workflow/skill 侧问题不绕行

轨迹里的问题按层归因后，**凡属 workflow / skill 侧的问题，结论一律是"回源头修复"，不得把 agent 的绕行当成可接受的恢复**。绕行掩盖缺陷：后续每个会话都会再踩同一个坑，且结构化报错、log 签名等现场证据被自造产物覆盖，事后定位成本翻倍。

- **绕行签名**（分析时逐条点名）：手工 grep/提取替代 workflow `post`、自绘 plots 替代 workflow 原生产物、改 standalone/换链路绕开组合推进缺陷、手改 gjf 或远端部署源码（D11 红线）、本地模拟替代远端真实链路。
- **每个绕行签名必须输出四元组**：现象与结构化报错 → agent 绕行动作 → 被掩盖的 workflow/skill 缺陷（假设 + 定位路径）→ 源头修复建议（workflow 版本线缺陷 / skill 条目 / kb 知识库）与回归断言。
- **不算绕行的边界**：科学层试错（换初猜、调参、CalcAll 稳 Hessian 等方法论内重试）与 skill 明文许可的备选路径不在此列；判定标准是**根因是否在 workflow/skill 侧、且被 agent 私有替代品遮蔽**。
- 实证（2026-09-09 multistep-irc-0909）：standalone post 四连 `FileNotFoundError(2, 'No such file or directory')`（UNKNOWN_ERROR、不带文件名）被"手工提取 + 自绘图件"绕行收口；根因实为 `--json post.json` 相对 cwd 落空 + payload 缺失走裸报错通道——绕行让该错误通道缺陷多存活一整轮，最终靠轨迹取证 + 远端现场比对才闭环（修复方向：load_payload 结构化 VALIDATION_FAILED、点名路径与 cwd 解析规则）。

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
Lifecycle: turns / steps / unclosed boundaries（缺 turn/end 的 turn 单列并归因）
Tools: total / matched / failed（fatal vs benign 分列）/ unmatched
Errors: seq / turn / step / tool / redacted reason
Latency: slowest steps and tools
Skill roots: normal or stale-skill-root
Read freshness: 读数时点 vs 最后事件时间差（滞后大须声明并降权结论）
Defect routing: workflow/skill 侧问题逐条列出（现象 / agent 绕行签名 / 源头修复建议）；绕行计数单列，科学层试错不算
Conclusion: primary fault, affected outcome, recommended retry boundary（含"返回层崩溃但远端已执行"的对账结论，若有）
```
