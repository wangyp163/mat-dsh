# M1 空闲 followup 唤醒验证（web 持久会话，2026-08-28）

## 目的

gaussian e2e（见 `2026-08-28-gaussian-e2e-web.md`）中模型选择了就地
`job_output wait:true`，终态由阻塞读本身报告，未走"空闲唤醒"路径。本测试在同一
web 会话（session-9fb87222）第二轮补验 **默认异步形态**：注册监控 → 模型结束轮次 →
宿主在作业终态后唤醒会话投递通知。

任务原文：

> 在 11250 集群的 Agent0 分区提交 2 个 sleep 45 的作业，用 mat_job_watch 一次性注册监控后，
> 直接回复我"已注册监控，等完成通知"，结束本轮。不要用 job_output 等待，不要手动轮询——
> 就靠会话里的完成通知唤醒你继续。收到通知后用 job_output 读最终状态表并汇报两个作业的终态。

## 轨迹（turn 2 → turn 3，时间线实测）

```text
T2 mat_exec cat > sleep_45_1.sh / sleep_45_2.sh        # 作业脚本上传
T2 mat_exec sbatch sleep_45_1.sh && sbatch sleep_45_2.sh  # 一次提交两个
   -> 120274931 / 120274933
T2 mat_job_watch {"job_ids":["120274931","120274933"]}
   -> background job mat-watch-2 registered
T2 模型回复"已注册监控"并结束轮次（未阻塞等待）
   ...约 60-75s（sleep 45 + 调度 + 轮询间隔）...
[seq 3399] agent/inbox/spliced {target: "next-turn",
   "background job mat-watch-2 (mat-watch: 11250 ×2 jobs) finished
    [status: completed, 2/2 settled (2 COMPLETED)]. Read its output with job_output."}
[seq 3403] user/message（notice 形态，source plugin: tool-jobs）
T3 reasoning: "The notification arrived. Let me read the final status table."
T3 job_output {"job_id":"mat-watch-2"}
   -> 120274931 COMPLETED exit=0 elapsed=46s
      120274933 COMPLETED exit=0 elapsed=46s
      2/2 settled (2 COMPLETED)
T3 最终答复：两作业终态表（COMPLETED / exit=0 / 46s）
```

## 判定

| 验证点 | 结果 |
|---|---|
| 注册后模型结束轮次（不忙等） | ✅ T2 无 job_output 等待调用 |
| 宿主后台轮询（零模型请求） | ✅ 空窗 ~60-75s 内无任何 LLM 活动 |
| 完成通知投递 | ✅ `agent/inbox/spliced` → next-turn + user/message notice |
| followup 唤醒开新轮 | ✅ turn 3 自动开始（sessionStats turns=3） |
| 通知后一次 job_output 拿全表 | ✅ 单次调用拿到汇总 + 逐作业终态行 |
| 监控段模型往返 | ✅ 2 次（T2 注册 + T3 读表），与作业时长/数量无关 |

## 三层验证汇总（M1 Step 7）

1. 单测：`pnpm test` 63/63 绿（job-state 13 + watch-loop 12 + fetch-transport 6 +
   client 选配 2 等新增），`pnpm typecheck` 0 错。
2. headless 实弹 ×2：curl 默认 + `MAT_TRANSPORT=fetch`，2×sleep30 批量 watch，
   监控段往返均 3 次，零手动轮询（`2026-08-28-fetch-transport-probe.md`）。
3. web 实弹：gaussian 全流程（skill → 门禁 → pre/run → sbatch → watch → post，
   E=-76.331 Ha）+ 空闲唤醒路径（本文档）。宿主仓 `git status --short` 全程为空。
