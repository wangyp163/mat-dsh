# shepherd spike 结论页（CONCLUSIONS-2）

2026-09-16 单日完成 A'–D'。计划：`docs/superpowers/plans/2026-09-15-mat-shepherd-spike.md`。
前置：batch-subagent spike（CONCLUSIONS.md）。本页判定 S1–S7 并给出机制结论与上游反馈清单。

## 一、假设判定

| # | 假设 | 判定 | 关键证据 |
|---|---|---|---|
| S1 | 可续机制实弹（启动/send_message/reportFrom/interrupt） | **confirmed** | 四件套零集群探针全通 + C' 真委托 6 份 report 全落地（source=subagent-report/relay）；FIFO 交付时机精确验证（链回合边界，不打断波内） |
| S2 | 牧羊人前台长回合通知驱动 | **confirmed** | SH4 子 agent 端到端链成（opt→freq，ctx≈40.1k）；SH5 波1（重启前）与波2（恢复后）两段长回合均通知推进 |
| S3 | 冷恢复（进程死亡后续链） | **confirmed（stretch 达成）** | 服务重启于波1 等待中 → 同会话 re-prompt 复活经理（29.6k）→ send_message coldResume 牧羊人（38.9k）→ sacct 对账+手动 post → 波2 → final；科学结果零损失 |
| S4 | 长寿会话上下文有界（<60k） | **confirmed** | 牧羊人：SH4 40.1k / SH5 38.9k / SH3 49.5k（止链含对账）；经理：29.6–60.6k |
| S5 | 预算闸管得住牧羊人 | **confirmed（戏剧性）** | SH3 freq 波被 BUDGET_REJECTED（台账 3.0/3.0 顶满），牧羊人 report 原文止链、未绕闸、未谎报相位 |
| S6 | 子会话用量可折叠 | **confirmed** | fold-child-usage 对 4 个子会话+3 个经理会话折叠，回放与既有基线逐位一致 |
| S7 | 负发现：settled 可续子的作业被 owner-disposed 清理 | **confirmed（实弹）** | 子结束回合 20s 后父侧 job_list=(no background jobs)（sleep 60 不可能完成）；父侧观察为权威，子复盘归因幻觉已备注 |

## 二、机制结论（批量架构的最后拼图）

1. **continuable shepherd 形态成立**，但正确姿势是"前台长回合跑波 + 回合边界可注入"，
   不是"睡觉等通知"（S7 机理不允许）。波内纪律写进角色协议后三个牧羊人零违例。
2. **自治边界经受住真实考验**：预算闸在子 agent 手里依然全局有效（S5），牧羊人在
   被拒时的行为（report 原文、止链、不谎报）正是"声明计划即预算"要的纪律。
3. **崩溃恢复闭环**：持久化子会话 + manifest 台账 + sacct 对账协议三者构成恢复
   三角——进程死亡只损失"通知"，不损失科学与账本。
4. **经理代跑是天然降级路径**（C' 首跑 maxDepth 踩坑时的自适应）：委托面失效时
   经理可直接按牧羊人协议执行，工程件（闸/清单/快照）不受影响。

## 三、上游反馈清单（宿主侧改进建议，均不阻塞使用）

1. **continuation manager 不感知 jobs**（S7 根因）：settled 可续子拥有的后台作业被
   owner-disposed 取消删除。建议：stateOf 把 owned jobs 计入等待态，或 job-done
   通知可唤醒 cold 子。当前 workaround=波内不结束回合。
2. **maxDepth 语义易误读**：0=工具实例完全不能委托（不是"禁止子再生"）。建议
   文档显式分层示例。
3. **per-child usage 无 API 面**：建议 subagent/end 事件或 job 快照带 usage 折叠。

## 四、本 spike 工程件去留

| 件 | 判定 | 备注 |
|---|---|---|
| C1 manifest 快照钩子（properties/workdir 自动落盘） | **保留投产** | 三跑全自动落盘零缺勤；相位间数据走清单成立 |
| C2 spec 钨死（manifest 规格字段） | **保留投产** | 牧羊人从清单读规格，零现场发挥 |
| C3 fold-child-usage | **保留投产** | 回放逐位一致；进 evidence 常规流程 |
| C4 shepherd 挂载（maxDepth 1 + deny 递归面） | **保留投产** | 含 maxDepth 语义注释（踩坑记录） |
| C5 skills（shepherd 节 + 无状态经理标准模式） | **保留投产** | 波内纪律三跑零违例 |

## 五、改进项（下一轮）

1. **估算计价与实际对账**：est 依赖调用方传 pre_json（SH3 教训——缺省 32 核计 2.0
   vs 实际 0.027）。改进：estimate 优先读 manifest spec.resources；settle 后按
   sacct 实际核时回写台账。
2. **无人值守自愈**：重启后经理扫描 manifest 中 submitted 未 settled 的任务自动
   走恢复协议（本次恢复指令是人工注入）。
3. **50 任务级压测**（batch spike 遗留）：收件箱批处理与 manifest 增量行的规模上限。

## 六、成本

- 集群：9 sbatch（C' 4+3 / D' 2），估算核时 6.0（受闸约束实际远小；作业多为
  11–14 秒级），零事故零配额浪费。
- 会话：3 经理 + 4 牧羊人 + 1 探针；牧羊人单链成本 6–14 次 LLM 调用 / ≈40k 上下文。
- 宿主仓全程零改动（铁律复核通过）。
