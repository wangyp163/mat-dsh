# scale-round 结论页（CONCLUSIONS-3）

2026-09-16。计划：`docs/superpowers/plans/2026-09-16-mat-scale-round.md`。
三轮 spike 的收官轮：工程收口 + 50 任务规模验证。

## 一、判定汇总：K1–K7 全部 confirmed（K5 优于假设）

## 二、三轮总账（batch-subagent → shepherd → scale）

| 轮 | 验证的拼图 | 判定 |
|---|---|---|
| batch-subagent（H1–H8） | 一次性工人 fan-out、契约、预算闸、角色隔离 | 6 confirmed + 2 partial |
| shepherd（S1–S7） | continuable 牧羊人、通知唤醒、预算管自治体、冷恢复 | 7 confirmed（含 1 负发现坐实） |
| scale（K1–K7） | 估算对账、自愈扫描、50 任务规模、通知批处理上限 | 7 confirmed |

**架构定案**（demo→engineering 的最终形态）：
- 组合经理**无状态**（每相位/接任全新会话 + manifest 恢复）——三轮五种中断
  （服务重启×2、max-tokens 截断、上游 400 瞬断、会话死亡）全部无损失恢复。
- 数据在**清单**不在会话（spec 钉死 / properties 快照 / workdir / 台账两本账）；
  批量委托默认**瘦委托**（prompt 只给指针）——自含 prompt 不随规模扩展是实测红线。
- 判断力 fan-out 给一次性角色工人；多波链给 continuable 牧羊人（波内不结束回合）；
  集群 I/O 集中串行（中位 46s/提交）；一切提交过预算闸（估算计费、实际对账 6.5%）。

## 三、工程件最终清单（全部投产，mat-dsh 树内）

mat-core：portfolio（manifest+台账+对账）/ contracts（三契约）/ budget（闸+
reconcile）｜mat-tools：budget-hook / manifest-hook｜scripts：portfolio-cli（含
stale）/ reconcile-ledger / fold-child-usage / probe 系列｜skills：batch-orchestrator
（含自愈扫描）/ batch-roles（四角色）｜profiles：mat.yml（subagent 家族启用 +
4 角色挂载）。全仓 489 测试绿。

## 四、遗留改进项（按优先级）

1. **瘦委托进协议正文**：orchestrator 的 fan-out 节补"数据在清单、prompt 只给
   指针、每回复 ≤3 工人"红线（本轮教训，尚未写回 skill）。
2. 会话内凭证管道（若要经理自主 reconcile）；相位回写滞后窗口的监控语义。
3. 上游反馈 3 条不变（jobs 不感知/maxDepth 文档/per-child usage API）。
4. 规模下一档（200+）的未知数：manager 单回合结算 50 份通知的输出预算、
   exec-gate 串行 46s/提交的吞吐上限（50 任务 40 分钟——200 任务需并行提交面
   或分批经理，属新设计题）。

## 五、成本总计（三轮）

集群 70 sbatch，实际 ≈2.7 核时（全部秒级作业）；宿主仓零改动；
evidence 完整归档（docs/evidence/{batch-subagent,shepherd-spike,scale-round}/）。
