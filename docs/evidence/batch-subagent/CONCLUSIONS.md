# batch-subagent spike 结论页（CONCLUSIONS）

2026-09-15 单日完成 A–E 五相位。场景：11 任务 Gaussian 批量（8 正常 + 2 注入失败 +
1 harness 注入），主 agent 组合经理 + 3 类角色工人子 agent fan-out + 确定性监控/预算闸。
计划：`docs/superpowers/plans/2026-09-15-mat-batch-subagent-spike.md`。

## 一、假设判定（H1–H8）

| # | 假设 | 判定 | 关键证据 |
|---|---|---|---|
| H1 | fan-out 后主会话上下文 ≤ solo 外推 1/3（操作化 ≤100k） | **confirmed** | 五相位会话（各自全新会话、manifest 恢复）：44.5k / 50.4k / 59.1k / 75.3k，全部 <100k；solo 外推 11×28k≈300k。更准确的结论形态：**每相位上下文有界且与组合规模解耦** |
| H2 | exec-gate 串行化限定 fan-out 收益边界（集群 I/O 集中、判断 fan-out） | **partial** | 构造上成立：提交/监控全集中在经理（C 相 10 连发全走闸串行）、工人全部本地化（prep/analyst 零 exec）。但闸排队的量化数据未单独采集 |
| H3 | 等待期零模型请求（通知驱动唤醒） | **confirmed** | producer 服务端轮询（零 LLM）；C 相提交后 agent 收回合等通知；全程零手动 squeue/sacct 轮询（transcript + agent 摘要双证） |
| H4 | 10 作业通知合并唤醒 ≤3 轮 | **confirmed（优于假设）** | C 相 9 份完成通知**全部并入同一回合**的下一步收件箱（turn_starts=1）——宿主收件箱批处理一次吸收 |
| H5 | 契约把工人结论压成 ≤10 行结构化数据 | **confirmed** | 20 份实弹裁决（11 prep + 2 triage + 9 interpret 中的代表）全过校验、0 编造、0 拒收；分诊 evidence 5 行/200 字符上限实测生效 |
| H6 | 预算闸超限结构化拒绝 | **confirmed** | 6 单测（先红后绿）+ X-EXTRA 实弹拒绝（工具层原文）+ 重试上限/核时回放逻辑 + 扩声明闭环（budgetAmendment 留档） |
| H7 | 工人异常可发现可处置 | **partial** | 契约失败路径实证（V9 诚实 ok:false、needs_human 处置）；**真 stopReason 死亡全程未发生**，处置路径只有协议无实弹 |
| H8 | toolFilter 角色隔离生效 | **confirmed** | 探针引擎级证实（mat_exec 不在制备工工具目录）；triage 用白名单内只读 exec；全程无越权调用迹象 |

## 二、成本对照

| 项 | 值 |
|---|---|
| 主会话 LLM 总调用 / 输出 tokens | 125 次 / ≈74.6k（B 24/15.7k、C 14/14.6k、D 26/17.6k、E 61/26.4k） |
| 集群 sbatch / 估计核时 | 11 次 / 5.5 核时（实际作业多为 15–21 秒级） |
| 注入失败成本 | F1 失败于 2 秒（零浪费）；F2 注入未生效（完成即正常结果） |
| 一次性事故 | skill-filesystem / tool-subagent 双 disabled 环境破损（spike 前置核对抓获并修复） |

**对照基线**（2026-09-01 压测）：单任务会话 28–31k 上下文、14–24 LLM 调用。
本 spike：组合 11 任务的每相位会话 44–75k——**skill 装载与协议开销只付一次，
任务数的边际上下文成本 ≈ +2–5k/任务**（对照 solo 每任务重付全款）。

## 三、工程件去留

| 件 | 判定 | 后续 |
|---|---|---|
| P1 manifest（portfolio.ts + CLI） | **保留投产** | 补：workdir 绝对路径字段、settle 时 properties 快照、retry 轮 verdict 命名、amend-budget 一等命令、注入任务 retryPolicy 字段 |
| P2 层间契约（contracts.ts） | **保留投产** | 补：prep 自检"同侧原子对间距"规则（V5 教训）、structure 行内 charge/mult 分隔符规范化 |
| P3 预算闸（budget.ts + budget-hook） | **保留投产** | 补：token 维度预算（当前只管 sbatch/重试/核时）；估算档与实际核时对账 |
| P4 角色挂载（3 工具实例 + batch-roles/orchestrator skills） | **保留投产** | rc.8 下 outputSchema 不可按次传（行配置限制）——保持 prompt 契约 + 父侧校验形态 |

## 四、demo→engineering 新增清单（本 spike 实测产生）

1. **子 agent 用量计量缺口**：job_output 不带 per-child usage，成本核算缺一角——
   需 subagent registry 侧补 usage 快照（宿主侧）或台账扩展（插件侧）。
2. **相位间数据传递走清单**：E 相 31 次 exec 补读 result.json（job_output 8KB
   上限 + 跨会话局限）——settle 时把 properties 摘要写进 manifest 即消。
3. **路径歧义在编排语境复现**：`~/workspace` vs 远端 HOME（09-01 压测 skill 问题
   #5）——workdir 绝对路径在提交时入 manifest。
4. **任务规格钉死纪律**：V1–V8 跑成 opt-only（harness prompt 未钉死 opt+freq）——
   经理默认值不可依赖，规格必须随任务声明进 manifest。
5. **上游 bug（反馈 HPC workflow 侧）**：result.json 诊断分类器把 l202 输入
   错误误标为 kb:ts-step-limit（F1 分诊工发现，三重证据）。

## 五、下一相位建议

1. **continuable shepherd（原 Phase F）**：本 spike 验证了一次性工人 fan-out；可续
   shepherd（提交→唤醒→条件分支→reportFrom）仍零实弹，是批量架构最后一块未验证
   拼图。建议带上述 1/2/4 三项修正后再开。
2. **组合经理无状态化定为标准操作模式**：每相位全新会话 + manifest 恢复已三次实
   战通过——这比长寿命经理会话更抗漂移、可续跑、可审计，写进 batch-orchestrator。
3. **压测放大**：11→50 任务级（manifest 增量行 + 收件箱批处理的规模上限探测）。
