# M1 web gaussian 完整 e2e（异步监控全流程，2026-08-28）

## 驱动方式

`scripts/dsh-web.sh restart`（新代码上线，pgid=2282905，:3080）后，经宿主 apiproxy
HTTP API（web bundle 自带 `@deepseek-ai/dsh-host-apiproxy`）编程驱动 web 会话：

- `POST /api/session.create` `{cwd: <host repo>}` → `session-9fb87222`
- `POST /api/session.prompt` `{mode:'queue', content:[{type:'text',text:<任务>}]}`（driver: /tmp/m1-web-e2e.py）
- 轮询 `POST /api/session.history` 采集 `tool/call` 事件与 sessionStats/tokenUsage 投影

任务原文：

> 在 11250 集群上对水分子做一次 Gaussian opt 计算（B3LYP/6-31G，小体系快跑），分区用 Agent0。
> 请按 gaussian-calc skill 的完整流程走：环境门禁 → pre → run → sbatch 提交 →
> mat_job_watch 异步批量监控（注册后用 job_output wait:true 就地等待完成）→ post。
> 所有选项我已给定，不需要向我确认；全程不要手动 squeue/sacct 轮询。

## 轨迹（监控相关全量 + 关键节点）

```text
skill{"gaussian-calc"}                       -> ok（user-dsh skills 软链命中）
mat_exec bash .../check_environment.sh     -> 门禁过（g16-hy，11/11 tasks）
mat_exec sinfo -o '%P %a %l %D %t %N'      -> 分区采集
mat_exec gaussian-workflow -t opt -p pre   -> job.gjf 生成
mat_exec gaussian-workflow -t opt -p run   -> slurm.sh 生成（cat 核对）
mat_exec sbatch slurm.sh                   -> 120274124
mat_job_watch {"cluster_id":"11250","job_ids":["120274124"]}
                                            -> background job mat-watch-1 registered
job_output {"job_id":"mat-watch-1","wait":true,"timeout_ms":600000}
  RES: 120274124 UNKNOWN (not observed)
       120274124 COMPLETED exit=0 elapsed=4s
       1/1 settled (1 COMPLETED)
       [status: completed, 1/1 settled (1 COMPLETED)]
mat_exec gaussian-workflow -t opt -p post  -> 结构化结果
mat_exec grep "Normal termination|SCF Done|Optimization completed" job.log
```

**全程零 LLM 发起的 squeue/sacct**（grep 轨迹仅 sbatch / mat_job_watch / job_output 三条监控线）。
物性正确：水 B3LYP/6-31G opt 收敛，E = **-76.3309942266247 Ha**，`g16_optimized.xyz` 落盘。

## token 用量（sessionStats 投影，全流程单轮）

```json
{"turns":1,"steps":35,"llmMs":234468,"toolMs":361788}
{"uncachedInputTokens":50587,"outputTokens":7122,"cacheReadTokens":972544}
```

监控段（watch 注册 + 阻塞读 + 终态表）只占其中 3 步；相比同步轮询
（每轮 squeue/sacct 一次完整推理往返，30 分钟 Gaussian 作业数十轮），
异步路径与作业时长、作业数解耦——这也是 M1 的核心目标（批量计算 + 省 token）。

## 说明

- 本轮模型按 skill 指引选择了就地 `job_output wait:true`（阻塞在工具调用内），
  终态由 wait 本身报告；宿主对"已报告终态"的作业抑制重复完成通知
  （types.ts `reported` 语义），故此形态下无独立唤醒事件。
  空闲 followup 唤醒路径另行验证：见 `2026-08-28-followup-wake.md`。
- elapsed=4s 为该 Slurm 作业真实 ElapsedRaw（Agent0 空闲节点 + 水分子小体系）。
