# mat 规模轮计划（scale-round：工程收口 + 50 任务压测）

> 前置结论：`mat-dsh/docs/evidence/shepherd-spike/CONCLUSIONS-2.md` §五。执行沿用全部铁律
> （宿主零修改/evidence 落盘 `docs/evidence/scale-round/`/TDD/每相位 commit）。预算：
> 50 sbatch 上限 + 重试余量（实际作业秒级，估算口径 ≤26 核时）。

**Goal:** 两件事——(1) 收口上轮三条改进中的前两条（估算计价对账、无人值守自愈扫描）；
(2) 50 任务级压测，探组合架构（无状态经理 + manifest + 收件箱批处理 + exec-gate 串行）
的规模上限。

**假设清单：**

| # | 假设 | 判定手段 |
|---|---|---|
| K1 | 估算取数以 manifest spec 优先（pre_json 兜底、32 核缺省）后，SH3 类误拒消除 | 单测 + 实弹对账 |
| K2 | 台账可按 sacct 实际核时回写（估算计费 vs 实际的两本账可对） | reconcile 纯逻辑测试 + 50 作业批量对账 |
| K3 | 无人值守自愈：批量中断后新会话凭 manifest stale 扫描接续（不靠人工注入指令） | 压测中途重启实验 |
| K4 | 50 任务下主会话上下文仍有界（≤150k 判线，任务数 5 倍于 spike 1） | token 折叠 |
| K5 | 50 份完成通知的收件箱批处理：唤醒轮次 ≤5 | 会话事件计数 |
| K6 | exec-gate 串行提交的单作业边际墙钟（H2 的量化补课） | 台账时间戳差分 |
| K7 | manifest 增量行/show 在 50 行规模仍可操作（经理读的是紧凑表不是全量 JSON） | 会话观察 |

**场景：** 几何扰动扫描（真实科研形态）——10 个已知良好小分子（H2O/CH4/NH3/CH3OH/
H2CO/HCN/CH3F/CO/HF/N2）× 5 档键长缩放（0.95/0.98/1.00/1.02/1.05）= 50 个 opt 任务。
缩放保几何有效性（制备缺陷率应≈0；如出现天然失败按分诊协议处理，不注入）。

**相位：**
- **A''（工程收口，TDD）**
  - E1：budget-hook 估算取数顺序 manifest task.spec.resources → pre_json.resources → 32
  - E2：`reconcileLedger(manifest, sacct 行)`（纯逻辑，mat-core）+ `scripts/reconcile-ledger.ts`
    （批量 sacct 一发 + actualCoreHours 回写 + 估算/实际两本账 diff 报告）
  - E3：`portfolio-cli stale`（submitted 未结算任务列表）+ batch-orchestrator 自愈扫描协议
    （新会话第一步：show + stale → 对 submitted 未结算者 sacct 对账/manual post；对
    pending/prepared 者继续原计划）
- **B''（50 任务压测）**
  1. 经理会话 init 50 任务（taskId M01–M50，spec 全同 opt 8 核档，预算 55/1/26）
  2. 10 个 prep 工人 × 5 任务（缩放参数在委托 prompt 钉死）
  3. 串行 50 次 mat_gaussian（task_ref 全带）——**中途第 ~25 个任务时实验方重启服务**
  4. 新经理会话自愈接续（stale 扫描 → 对账 → 继续提交剩余）——K3
  5. 全结算后 reconcile-ledger 两本账对账——K2
  6. 分析师 fan-out（2×25）+ 经理汇总（可选，视上下文余量）
- **C''：CONCLUSIONS-3**

**风险与中止：** 队列拥堵 → 低峰执行、排队 >30min 的任务标 deferred 不阻塞；提交阶段
墙钟超 90min → 记部分结果中止；上游 400 瞬断 → 续跑协议。
