---
name: matgen
# description 禁半角冒号（frontmatter 纪律，同 gaussian-calc）。
description: Use this skill for MATERIAL CANDIDATE DISCOVERY AND PRE-SCREENING (找材料、筛材料、材料检索、候选结构、逆向设计、生成候选结构、ML 预筛、凸包稳定性、新颖性、VASP 计算方案) via the matgen MCP service. You map user intent to a search/design spec, run OPTIMADE-backed retrieval and/or candidate generation, MACE ML pre-screening with evidence grading, and produce a VASP plan. The loop ENDS at vasp_plan — actual DFT execution is NOT part of this skill (use vasp-calc); all ML numbers must be reported as predictions, never as DFT results.
version: 0.1.4-demo
metadata:
  adapted-for: mat-dsh
  source: ~/aiagent/matgen 的 matgen-mcp 0.3.x README（Tools/术语表/Resources 节）+ docs/MCP落地方案.md 证据分级
  adaptation: 2026-09-24 首版——matgen 工具面（mcp__matgen__*，8 工具，经 127.0.0.1:18080 隧道连 HPC pod 常驻服务）的协议 SOP；定位为「候选发现与前筛」，闭环止于 vasp_plan，执行段交 vasp-calc（matstream）；证据分级 A–E 与六级漏斗口径全文来自 matgen-mcp README 术语表，未做二次演绎；0.1.1 首测复盘（session b0014645）——画像字段速查表入册（模型未读 schema 资源自造字段连错 5 次），「无任选元素字段、HAS ANY 走 optimade_filter 直写」显式化；0.1.2 二测复盘（session 8ac5f49b）——material_search 的 session 内去重语义入册（同 session 重复检索返回空被误判为故障，模型绕行自建排序，违反工具面分工；后经源码复核修正为兜底过滤语义，真根因是裸 spec 无过滤 bug，已在 matgen 0.3.x 服务端修复）；0.1.3 三测复盘（session b9ee147a）——pod 服务重启后 mcp-client 死 session（-32600 Session not found）的处置入册（dsh-web.sh restart，禁止自写代理绕行）
---

# 材料候选发现与前筛（matgen）

## 定位与分工：本 skill 找候选，不跑计算

matgen 服务做四件事：**意图 → 画像**（LLM 只做这步）、**检索**（OPTIMADE 后端
数据库查证）、**生成**（原型替换 / MatterGen 扩散采样）、**ML 预筛**（MACE
弛豫 + E_hull + 新颖性 + 六级漏斗），最后出 **vasp_plan 计算方案**。它是
DFT 之前的漏斗——**闭环止于方案，不执行任何计算**。

| 用户想要 | 用哪个 |
|---|---|
| 找/筛/排序候选材料（数据库物性为准） | **本 skill** 检索路（A/B 级证据） |
| 设计/生成新候选结构（替换掺杂、扩散采样） | **本 skill** 生成路（D 级候选 + ML 预筛） |
| 属性条件闭环调优（bulk_modulus 目标） | **本 skill** conditioning_loop |
| 真跑 VASP 得 DFT 数 | **vasp-calc**（本 skill 的 vasp_plan 产出只是方案；matstream 链是执行段） |
| 只按已知结构查 CIF/POSCAR | mcp__optimade__*（matgen 内部同上游，但单点查结构不必开会话） |

环境：工具全部经 `mcp__matgen__<name>` 调用。若调用报连接错误，是本机隧道
（`scripts/matgen-tunnel.sh`）未起——如实告知用户执行 `matgen-tunnel.sh start`，
**不要**绕道改参数。若报 `Session not found`（-32600），是 pod 侧服务重启过、
dsh 的 mcp-client 持有失效 session——处置是告知用户执行
`scripts/dsh-web.sh restart`（隧道与 pod 服务都不用动），**禁止**自写代理/绕行
工具面。排障第一入口是 `mcp__matgen__server_info`（version /
device / queue 一次看全）；会话卡住先查 queue 再下结论。

## 工作流（双路编排，画像一次生成）

```
用户意图（带隙类目标）
  │ 带隙目标先过 landscape_check（2026-10-12 E2E 教训产品化，0.4.1+）：
  │ landscape_check(elements, target_band_gap) 一次检索判可达性——
  │ RETRIEVAL_HIT（库里已有，直接检索取用，不要生成）/ INTERPOLATION
  │ （分布内部，生成合理）/ EDGE（贴上限可试）/ OUT_OF_LANDSCAPE
  │ （超已知上限 0.3+ eV，生成是打不存在的靶——转告 verdict_detail 的
  │ 扩域建议（同族替换）或与用户核口径，PBE 低估实验 40-50%）。
  │ DATA_UNAVAILABLE 是数据源问题，不等于目标不可达。
  ▼
按下表生成画像（extra_forbidden 严格校验——字段名错即整单被拒，
  │ 不要试错猜字段；细节可 read material://search-spec-schema / design-spec-schema）
  ▼
material_search_plan(search_spec)      ← 画像校验+补全，LLM 语义端
  │  validation.unsupported_constraints 单列未施加的约束——逐条转告用户，不静默
  ▼
material_search(session_id, ...)       ← 检索+去重+top-N 下载（A/B 级证据+分数）
  │
  ├─ 检索路：ml_screen(selection="search:topN")
  ├─ 生成路：structure_generate(engine=...) → ml_screen(selection="gen:all")
  │            （参数缺省自动继承画像 generation_hints；anchoring="db_anchored"
  │              时元素锚定会话最高分检索结构——先查再生成的落实）
  ▼
vasp_plan(session_id, properties, selection=...)   ← 闭环终点，方案交用户决定
```

### 画像字段速查表（MaterialSearchSpec，extra_forbidden）

| 层 | 字段 | 类型/枚举 | 说明 |
|---|---|---|---|
| 顶层 | `role` | `cathode`/`anode`/`electrolyte`/`generic` | 触发领域默认约束与软目标 |
| 顶层 | `hard_constraints` | **必填**（可为空对象） | 数据库侧过滤 |
| 顶层 | `soft_targets[]` | `property`+`op`(>,>=,<,<=,==,between)+`value`+`value_max`(between 必填)+`weight`+`source`(user/domain_default/agent_inferred) | 排序不过滤；source 必填保审计 |
| 顶层 | `assumptions[]` / `unverified_properties[]` / `clarifications[]` | 字符串列表 | 隐含假设/未验物性/待澄清，如实填 |
| 顶层 | `optimade_filter` | 字符串 | 直写 filter（见下"任选元素"） |
| 顶层 | `generation_hints` | 见 matgen README | 生成路参数（elements/n_samples/seed/anchoring/property_condition） |
| hard_constraints | `must_elements` / `exclude_elements` | 元素符号列表 | HAS ALL / NOT HAS 语义 |
| hard_constraints | `formula_contains` / `max_cell_size` / `space_group` | str / int>0 / int 列表 | 化学式包含 / n_sites 上限 / 空间群 |

**没有"任选元素"（HAS ANY）字段**——`allowed_tm`/`any_of_elements`/`elements_any_of`
等全是不存在的自造字段（首测实证连错 5 次）。要"Mn 或 Fe 至少其一"这类语义，
用 `optimade_filter` 直写：`elements HAS ANY "Mn","Fe"`（可与 must_elements 共存，
服务端合并）；或在 soft_targets/事后筛里近似。



- **session_id 贯穿全程**：检索/生成/预筛/方案都挂同一会话，工件落服务端
  `runs/{sid}/`（响应只是摘要，工件为准）；`material://sessions/{sid}/summary`
  可随时回看步骤流水。
- **selection 语法**（ml_screen / vasp_plan 通用）：`search:topN`、`gen:all`、
  `gen:topN`、`search:all`，或显式 structure_ids 列表；生成候选 ID 形如
  `gen:{n}-{formula}`，检索结构是 `provider:id`。
- **conditioning_loop**（bulk_modulus 目标专用）：要求画像带
  `generation_hints.property_condition`；每轮条件采样→L0→MACE EOS 拟合→
  规则调节（不是学习系统），hit 或 rounds 用尽即停，**未改善也如实留档**。

## plan.json 下游投递（vasp_plan → vasp-calc / mat_vasp）

`vasp_plan` 工件 `runs/{sid}/vasp/plan.json` 是 DAG（steps[].recipe / requires /
incar / potcar_list / core_hours）。真跑 DFT 经 vasp-calc 的 `mat_vasp`——
matstream 在作业内**自生成** INCAR/KPOINTS/POTCAR，不消费 plan 的 INCAR 原文；
plan 的角色是**链与档位的意图声明 + 核时预算参考**。映射：

| plan recipe | matstream task | 说明 |
|---|---|---|
| `static_relax`（ISIF=3） | `relax` | 全弛豫 |
| `static_energy` | `scf` | 静态能 |
| `band_dos` | `band` | 带隙/DOS |
| `voltage_curve` | — 无对应任务 | 如实告知用户留待后续，不硬凑链 |
| 需 +U（如 Mn 3d 磁性体系） | `relaxdftu;scfdftu;banddftu` | plan 默认无 +U，加 U 属用户决策 |

- **preset**：plan `PREC=Accurate`+`SIGMA=0.05` 对应 **medium**（默认档）；
  EDIFF 1E-5 介于 fast/medium 之间，取 medium 保守向上。
- **结构**：`read material://sessions/{sid}/structures/{structure_id}` 拿
  POSCAR 原文，整段作为 `mat_vasp` 的 `structure`（structure_format=poscar，
  不要转写 CIF）。
- **投递纪律**（全在 vasp-calc 域）：先过环境门禁（mat_env_gate）；首次
  mat_vasp 调用不带 digest → `CONFIRM_REQUIRED`（零集群副作用，参数投影
  逐字呈给用户）；用户批准后同参 + `confirmed_digest` 复调。核时超 plan 的
  steps core_hours 时主动指出。
- **判读红线**：Slurm COMPLETED ≠ 物理收敛——看 `converged` flag 与 probe
  行；结果数值回填与 plan/库值对比时遵守本 skill 证据分级（DFT 结果对
  ML 预测是验证或推翻，不是同列）。



`wait=True`（默认，小批量）直接等结果；`wait=False` 返回 job 句柄，用
`ml_screen_status(job_id)` 轮询：

- `queued` → `queue_position`（FIFO 精确位次）+ `eta_seconds`（**粗估**，
  滚动均值 × 位次——参考值不是 SLA，别对用户报成承诺时间）
- `running` → phase + progress（relax/voltage/band_gap）
- `completed` → 完整结果；`failed` → 看 error，**勿再轮询**
- `interrupted` → 服务重启打断了它（参数没错，**相同参数重提即可**，别改参）

纪律：**一次 ≤5 个结构**（GPU 串行，单结构 35s–2min，更多拆批 + 轮询）；
token 紧张时 `summary_only=True` 只回摘要 + `fields=[...]` 白名单投影
（工件始终全量落盘，紧凑模式不丢数据）。

## 证据分级与诚实口径（报告必须遵守）

| 级 | 含义 |
|---|---|
| A | 实验数据库（ICSD 等） |
| B | DFT 计算值（数据库收录，method_tag 可比性） |
| C | ML 预测（**必带 uncertainty**，无不确定度即不合规） |
| D | 模型生成候选（结构本身是模型产物） |
| E | 弱证据/规则估计（如完全脱锂容量上界） |

- **"ML 预测，非 DFT"必须显式标注**——ml_screen 的一切数值（能量、E_hull、
  体积模量、带隙）都是 C 级；检索路的 A/B 级与生成路的 C/D 级**不得混排
  成同一可信度**呈现。
- `penalty: "missing"`（打分明细内）= 该物性**没测**，不是测了不达标——
  分数同为中性 0.5 但语义分开，报告时分开说。
- `assumptions`（如容量 `{"delithiation": "full"}`）是推导隐含假设，
  跨来源比较必须可见（完全脱锂是上界，实际 DoD 50–70%）。
- 生成路六级漏斗 `n_gen → n_L0 → n_converged → n_stable → n_novel →
  n_property_hit`；各级**未测定单列**（`n_stable_unevaluated` 等）——
  "E_hull 缺席"与"不稳定"是两句话。多 cohort（不同 seed/条件轮次）输出
  `funnels` 列表，按 cohort 分别读。
- E_hull 口径：数据源含 `mp` 时为全库竞争相（较可信）；无 mp 回退会话内
  凸包 + warning（**偏乐观**，报告要带这个限定）。

## 术语表（易混字段，转述前先对照）

- `converged`（bool）= 优化器在预算内达到 fmax，纯数值事实；
  `convergence`（三级 converged/near/failed）= 叠加阈值判级——
  **布尔 true 但判级 failed 是正常现象**（弛豫到位但体积变化超阈值）。
- 弛豫位移 rms/max > 3Å = 塌胞/相变告警（阈值未按生成结构校准，人工看）。
- `downloaded` = 检索条目是否已下载 POSCAR 工件（top-N 之外为 false，
  要结构先确认这个位再说"拿不到"）。
- **session 内公式去重是跨调用累积的**：同一 session_id 重复检索（即使
  改了 soft_targets/范围）会把之前已返回过的公式全部滤掉，可能
  `results: []` 而 `n_raw > 0`——**这是去重语义不是故障**。要新结果：
  换 session_id（推荐，旧会话工件不受影响）或放宽 hard_constraints。
  **禁止**因此绕行 mcp__optimade__ 自行翻页拉数据 + 本地排序——排序、
  证据分级、去重正是本 skill 工具面的职责，绕行等于丢弃这些保证。
- `interrupted` ≠ `failed`（见上节）；`job 不存在` = id 打错或工件被清理。
- 生成引擎：`prototype`（默认，检索原型+元素替换）vs `mattergen`（扩散
  采样，慢——CPU ~10min/结构，只在用户明确要生成模型路线时用）。
