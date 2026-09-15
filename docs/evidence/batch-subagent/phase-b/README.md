# Phase B：批量制备 fan-out（2026-09-15）

主会话 session-846b9d0d（workspace ~/workspace/batch-subagent）。
产物：`manifest-after-phaseb.json` + `verdicts/`（11 份裁决）+ 会话事件转印。

## 探针（前置于正式会话）

session-62d99ada（`probe-*` 文件）：单个 subagent_prep 实弹调用。三结论：
1. **provider 路由 OK**——agentOptions（mat/deepseek-v4-flash）语义正确，子 agent 正常创建运行。
2. **H8 证实（引擎级）**——制备工自报工具列表仅 bash/read/skill，`mat_exec` 不在目录：
   "拒绝发生在工具调用引擎层面而非运行时返回"。toolFilter 白名单是硬边界。
3. **子 agent skill 可见性 OK**——工人逐字引用了 batch-roles 的纪律条款。

## 正式会话结果

- **11 任务 manifest**（V1–V8 + F1/F2 注入 + V9 harness 注入）init 正确，预算声明
  （maxSbatch=12/retries=1/coreHours=5）随清单落盘（TDD 补的 budget 字段）。
- **6 个制备工 fan-out**（5×2 体系 + V9 单独）：主 agent 在同一回复并行发出，
  全部**以后台 subagent job 形态运行**（"started background subagent job"），经
  `job_output` 收割——后台 job + 通知收割模式在制备相位即被实证（H3 同构机制）。
- **契约通过率 11/11 一次过**，零拒收、零重试、零工人死亡。
- 工人质量：化学自检完整（电子数奇偶与多重度相容、键长/键角核对、最小原子间距
  >0.1 Å 检查），structure 字符串带 charge/mult 行内标注。
- **V9（外部文件缺失注入）**：工人诚实返回 `ok:false problem:"外部几何文件不存在"`，
  **没有编造结构**——契约失败路径干净走通。

## 指标（H1 判据输入）

| 指标 | Phase B（11 任务制备） | V1 校准（单任务全链） |
|---|---|---|
| 主会话 LLM 调用 | 24 | 5 |
| 主会话 sum_output | 15652 | 1810 |
| **主会话最终上下文** | **≈44.5k** | ≈30.7k |

11 任务制备 fan-out 的主上下文 ≈44.5k：相对单任务基线仅 +14k 增量，对照 solo 外推
（11×28k≈300k+ 或触发压缩）——**H1 方向性强支持**（最终判定待 Phase C–E 全链完成）。

工具面（48 次调用）：bash 16、write 12、subagent_prep 6、job_output 6、todo_write 5、
skill 2、read 1——清单操作全走 CLI（portfolio-cli），无手搓 JSON。

## 诚实偏差记录

1. **V9 相位语义瑕疵**：主 agent 把 ok:false 的 V9 也推进到 `prepared`（契约校验通过
   ≠ 制备成功）——协议应规定"ok:false → note needs_human、相位不动"。记入
   batch-orchestrator 待修（Phase C 前修订 skill）。
2. **相位摘要过简**：指令要求的拒收/死亡计数没出现在摘要里（本次恰好全零，无信息损失）。
3. **structure 格式漂移**：工人把 `charge=0 mult=1` 直接缀在末原子后（无分号分隔）——
   Phase C 解析时要容忍该形态。
4. **子 agent 逐个 token 用量不可得**：job_output 返回体不含 per-child usage，本相位
   成本核算只覆盖主会话。这是工程件清单新条目（子 agent 用量计量缺口）。
5. **H7 仅部分覆盖**：契约失败路径已观测；真 stopReason 死亡（error/max-tokens）未注入
   成功——本相位无自然死亡，H7 判定暂记 partial。
