# M2 三层验证（2026-08-28）

全部在 cluster 11250 实弹；宿主仓 `git status --short` 全程 0 行（硬门槛）。

## 第 0 层：单测 + typecheck

```text
pnpm vitest run → Test Files 17 passed (17)，Tests 145 passed (145)
pnpm typecheck → tsc -b && tsc --noEmit -p scripts 退出码 0
```

含回放契约 3 件（slurm-replay / gaussian-replay / efile-replay），fixtures 见
`packages/mat-core/test/contract/`（PROVENANCE.md 记录来源）。

## 第 1 层：tsx 实弹探针（零模型 token）

`scripts/probe-m2.ts`（MAT_TRANSPORT=fetch，MatClient 直连）。原始输出全量存档：
`2026-08-28-probe-m2-raw.log`。要点：

- **sinfo 5 列真实输出**：16 行，同名分区多状态行（drain\*/drng/mix/alloc/idle），
  Agent0 20 idle → 回填 fixture `slurm/sinfo-5col.txt`（替换合成件）。
- **四薄工具语义**：sbatch → `Submitted batch job 120283480`；squeue 对 PENDING 可见
  （`PENDING`，补充 M1「RUNNING 常空」实证）；scancel 后 queryJobStatus 返回
  `COMPLETING`（sacct 过渡态，透传不归一）。
- **gaussian 全阶段**（workdir `~/workspace/h2o-m2-probe`，job 120283614，Agent0
  elapsed 13s）：prepare 单命令 `PREP_READY`、pre/run `"status": "ok"`、
  **producer 27s 结算**：

```text
outcome: {"status":"completed","detail":"1/1 settled (1 COMPLETED); opt+freq E=-76.4089539792 converged=true imag=0"}
properties: {"energy":-76.4089539792,"converged":true,"frequencies_cm-1":[1713.1206,3727.1534,3849.0866],"imaginary_frequency_count":0}
```

**基准交叉验证（vs Python 时代实测）**：E Δ=2.1e-7 Ha；三频 Δ=[0.009, 0.017, 0.013] cm⁻¹；
imag=0 —— 三项近似阈值（0.001 Ha / 1.0 cm⁻¹ / =0）全过。pre/run/post 原始 stdout
回填 fixtures `gaussian/*.stdout.txt`。

## 第 2 层：headless 冒烟（一站式 + 阻塞读）

```bash
DSH_HOME=/tmp/mat-dsh-m2-home MAT_TRANSPORT=fetch pnpm --dir ../deepseek-harness dsh \
  --profile headless --patch profiles/mat.yml '<水 opt+freq 一站式任务>'   # exit=0
```

会话轨迹（session.jsonl.zstd 解包，tool-call-chunks）：**恰好 2 次工具调用**——
`mat_gaussian` + `job_output(wait:true)`，零手动 squeue/sacct。模型自写水几何
（坐标略异），结果 E=-76.408953979 / freqs=[1713.1313, 3727.1791, 3849.1023] / imag=0
（与基准同阈值内一致）。

## 第 3 层：web 基准验收（apiproxy 驱动，session-68059932）

`dsh-web.sh restart`（MAT_TRANSPORT=fetch 注入）+ `/tmp/m2-web-e2e.py`（断言脚本）。
任务：通知驱动形态（提交即收尾 → 完成通知 → job_output 读一次）。

```text
CALL mat_gaussian {"task":"opt+freq","cluster_id":"11250",...}  -> slurm 120285606, bg mat-slurm-1
CALL job_output    {"job_id":"mat-slurm-1"}                     -> 终态首读含 properties
```

| 验收项 | 结果 |
|---|---|
| 监控段模型往返 ≤2 | ✅ 恰好 2（mat_gaussian + job_output），turns=2（通知唤醒） |
| 零手动 squeue/sacct | ✅ 轨迹无任何 mat_exec 轮询 |
| E=-76.408954±0.001 Ha | ✅ -76.4089539792（Δ≈0） |
| freqs 三项各 ±1.0 cm⁻¹ | ✅ [1713.1183, 3727.1518, 3849.0867]（max Δ=0.018） |
| imag=0 | ✅ |
| producer 自动 post | ✅ properties/files 在 job_output 终态首读（无需 cat result.json） |

首轮教训（留档）：任务文本若要求「job_output wait:true 就地等待」，宿主默认 wait 30s
（tool-jobs `waitTimeoutMs`）小于作业时长时会早退一次，产生 3 次往返——是任务表述与
默认超时的组合，非 M2 缺陷；通知驱动形态为设计主路径。

token 用量（sessionStats）：turns=2 / steps=4 / outputTokens=745 / uncachedInput=7660。

## efile 实弹（凭证在场，账号授权缺失）

负路径意外发现规划期信息过时：**env.local 一直有 MAT_ACCESS_KEY/MAT_SECRET_KEY/
MAT_USER**（此前记录的"凭证缺口"不成立）。打码探针（/tmp/probe-token.mts）：

- 签名鉴权通过：`POST /user/v3/tokens` 返回 code='0' + 6 集群（11250/11276/11285/
  20073/20091/0-ac），签名自检向量一致。
- **所有真实集群 token_len=0、efileUrls=0**（仅 clusterId="0" 的 "ac" 条目有 260 字符
  token，无 efile 地址）→ 该账号 efile 服务未开通/未授权，上传下载无法实弹。
- 工具链行为符合设计：web 会话实测 `mat_upload` 调用返回
  `Error: cluster 11250 returned an empty token`（点名根因，非栈溢出）。

**遗留**：efile 正向实弹待账号授权（HPC 开放平台开通 efile）；单测/契约
（synthetic fixtures）与错误路径已覆盖，凭证到位后回填真实响应 fixtures。
