# shepherd spike Phase A'–B'（2026-09-16）：工程修正 + 机制实验

## Task 1（C1/C2/C3，TDD 全绿 483 测试 + typecheck 干净）

- portfolio 任务新字段：`workdir`（远端绝对路径）、`properties`（settle 物性快照）、
  `spec`（计算规格钉死，spec.task 空串拒收）；CLI update 透传
  `--workdir/--spec/--properties-file`。
- `mat-tools/src/manifest-hook.ts`：mat_gaussian 三接线点——提交成功记
  workdir、producer onResult 快照 properties（原子写、失败不连坐结算）。
- `scripts/fold-child-usage.ts`：子会话 usage 折叠（DSH_HOME 环境变量指路），
  对 V1 校准/Phase B 两个既有会话回放数字逐位一致（5/1810/30658、24/15652/44517）。

## Task 2（C4/C5）

- overlay：`tool-subagent-control` 显式启用（第三个同款 disabled 坑）；
  `subagent_shepherd` 挂载（continuable、maxDepth 0、deny 全部 agent 生成/控制
  工具、flash/16384）。dump 见 task-a2-composed-dump-config.yml。
- skills：batch-roles 增 shepherd 节（波内不结束回合等硬纪律）；orchestrator 增
  标准操作模式（无状态经理）与链式委托协议。服务已重启加载。

## Task 0 + Task 3 合并：S7/B' 机制实验（session-3e5efe03，零集群）

一次会话同时完成 S7 定向实验与 B' 四件套探针：

| 机制 | 结果 |
|---|---|
| S7 owner-disposed 清理 | **confirmed**：continuable 子结束回合 20 秒后父侧 job_list = `(no background jobs)`——sleep 60 不可能已完成，作业被回合边界清理（父侧第 3 步观察为权威证据；注意子 agent 复盘时把消失误读为"正常完成并清理"——归因幻觉，机制结论不受影响） |
| continuable 启动 | 返回 `{subagentId: 46cdf2c0…}` ✓ |
| send_message（对已 settled 子） | `message queued as the next turn` → 子被冷恢复唤醒（无宿主重启即走了 coldResume 路径）✓ |
| reportFrom | 父会话收到 `Background subagent 46cdf2c0… reported:` + 内容，source=`{kind:'subagent-report', form:'relay'}` ✓ |
| interrupt_agent | `interrupt requested` 接受 ✓ |

**S1 机制链全通、S7 负发现坐实**（上游反馈项：continuation manager 不感知 jobs，
settled 可续子的后台作业被取消删除——设计约束"波内不结束回合"必要且充分）。
