# Phase C'：链式委托实弹（2026-09-16，两跑）

## 第一跑（session-df243e34）：maxDepth 0 语义踩坑 + 经理代跑

`subagent_shepherd` 双派被宿主拒：`subagent depth 1 exceeds maxDepth 0`——
**maxDepth 0 的语义是"本工具实例完全不能委托"**（我误读为"禁止子再生"）。
修正为 1（牧羊人 depth 1 可创建、孙代 depth 2 必拒）。经理自适应改按牧羊人协议
代跑双链：**两链全绿**（SH1 E=-76.4089539034/0 虚频、SH2 E=-115.714405956/0 虚频），
预算台账/properties 快照/workdir 自动落盘全部照常——工程件与协议本身有效，
但"子 agent 形态"未测到（本跑计为协议验证跑）。

## 第二跑（session-9ec1415a）：真委托全机制实弹

- **并行真委托成功**：2 个 continuable 牧羊人（06aed41c=SH3、0f142c48=SH4）。
- **SH4 全链链成**（子 agent 端到端）：opt→freq、E=-115.714405956、0 虚频、
  phase=final、properties/workdir 自动落盘——S2 confirmed（子 agent 长回合内
  通知驱动推进）。
- **SH3 链止于预算闸（S5 戏剧性实证）**：其波1 未传 pre_json 资源档（默认 32 核
  档）→ 估费 2.0 核时；台账 0.5+2.0+0.5=3.0 顶满声明 → freq 波提交被
  BUDGET_REJECTED，牧羊人 report 原文止链、未绕闸、相位未谎报——自治边界在
  真实诱惑下守住。
- **send_message FIFO 时机精确验证**：波1 进度 report 到达后立即入队询问，实际
  在链回合结束后的续回合交付，未打断波内执行。
- **report 流**：6 份 report（2 波1 进度 + 2 终报 + 台账答复 + …）全部以
  subagent-report/relay 源落地。
- **用量折叠（S6/S4）**：SH4 全链牧羊人 13 调用/6.3k 出/ctx≈40.1k（<60k 判线）；
  SH3 止链牧羊人 39 调用/ctx≈49.5k；经理 20 调用/ctx≈60.6k。

## 工程注记（进 CONCLUSIONS-2）

1. 估算计价 vs 实际：SH3 opt 账面 2.0 核时 vs sacct 实际 0.027——估算依赖调用方
   传 pre_json 资源档，缺省按 32 核计。改进：estimate 从 manifest spec 读，
   或 settle 后按 sacct 实际值对账回写。
2. maxDepth 语义进 skill 文档（0=工具不能委托；N=允许到第 N 层）。
