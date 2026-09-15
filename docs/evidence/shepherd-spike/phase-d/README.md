# Phase D'：冷恢复 stretch（2026-09-16，session-19ab8cfe + 牧羊人 350aae25）

## 实验时序

1. 00:50:32 波1 opt 提交入台账（job 122203884，牧羊人回合内等待通知）。
2. 00:50:37–00:41 **服务重启**（进程死亡）：producer/通知/自动 post 全灭；
   sacct 证实远端作业 COMPLETED（14s）——计算无损失，链路状态全丢。
3. 对同一经理会话 re-prompt 恢复指令 → 经理 agent 复活（S3 第一关）。
4. 经理 send_message 牧羊人（FIFO 排队）→ **coldResume 冷恢复**（S3 第二关）：
   牧羊人从持久化子会话唤醒，对账恢复——sacct 确认终态 → 按 skill 分步协议
   **手动 post** 恢复结构化 properties（E=-76.4089539033, converged）→ 门检通过。
5. 波2 freq 正常提交（job 122204097 COMPLETED 11s）→ 终检 → final。

## S3 判定：confirmed（全链）

| 环节 | 结果 |
|---|---|
| 经理会话复活（re-prompt 同 sid） | ✅ 19 调用 / ctx≈29.6k |
| 牧羊人冷恢复（send_message → coldResume） | ✅ 17 调用 / 6.5k 出 / ctx≈38.9k（含对账+post+波2 全程） |
| 对账协议（sacct + 手动 post + 门检） | ✅ 与 gaussian-calc 续跑 runbook 吻合 |
| 链完整性 | ✅ E=-76.4089539034 / 0 虚频 / phase=final / 台账 2 笔 |

## 注记

- 恢复指令由实验方注入是设计内动作；真正的无人值守恢复需要"重启后扫描
  manifest 中 submitted 未 settled 的任务"——经理自愈扫描协议，进
  CONCLUSIONS-2 改进项。
- 冷恢复后牧羊人的波内纪律天然解除（新回合），S7 机理不构成恢复障碍。
