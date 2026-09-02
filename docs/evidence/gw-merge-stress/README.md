# gw-merge-test 压测证据（2026-09-01）

对 gaussian-calc skill v0.7.4-demo + `~/workspace/.demo-deploy/gw-merge-test/`（gaussian-workflow + calcflow 合并代码，经 env.sh PYTHONPATH overlay）的 20 会话端到端压测。

## 内容

- `2026-09-01-stress-table.md` — 结果表（会话号/task/exit/耗时/result.json 一致性/偏差备注）+ 判定清单汇总 + 归因分类（代码/文档/agent/基础设施）
- `SOP.md` — 复用方法论：集群准备、编排设施、交互应答政策、判定清单、已知坑与收尾
- `prompts/` — 20 条 verbatim prompt（只含科学意图，不含任何命令/协议）
- `raw/sessions.json` — 会话注册表（name → sessionId）
- `raw/interactions.jsonl` — watchdog 交互审计（每个 question/approval 与应答）
- `raw/design-message.txt` — 压测设计原文（矩阵 A–H 与判定清单）
- `tools/` — 可复用编排工具：`sess.py`（dsh RPC）、`wave.py`（波次发射）、`watch.mjs`（交互 watchdog）、`reflaky.py`（offline-400 重发）、`status.py`（总览）、`scx.py`（HPC remote-shell）

## 关键结论速览

- 门禁先行 20/20；三阶段 + sbatch 全对；数值零幻觉（唯一瑕疵 b1 的文件存在性声称）
- **代码问题 4 项**：ts 路由被默认参数覆盖；dipole/polar/tddft post 不提取属性；多波组合顶层 result.json 丢前波；resp post chk 命名不匹配 → status=error
- **skill 文档 1 项**：`~/workspace` 本机/集群歧义无默认约定
- **agent 行为 2 项**：b1 轻幻觉、f3 未上集群即下结论

运行环境：dsh web (127.0.0.1:3080) + mat/deepseek-v4-flash effort=high，集群 11250 昆山 Agent0。
