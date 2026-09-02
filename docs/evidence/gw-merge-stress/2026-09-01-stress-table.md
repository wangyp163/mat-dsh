# gaussian-calc v0.7.4-demo 压测结果表（2026-09-01，11:07–12:26）

合并代码：`~/workspace/.demo-deploy/gw-merge-test/`（经 env.sh PYTHONPATH overlay，测试后已摘除）
模型：mat/deepseek-v4-flash effort=high ｜ 集群：11250 昆山，分区 Agent0（32核/64GB）

| 会话 | task | exit | 耗时(s) | result.json 一致性 | 偏差备注 |
|---|---|---|---|---|---|
| a1 | opt | completed | 966 (3轮) | ✅ E=-76.4089539792 / converged / slurm Agent0 | 首问被答"本机目录"→本机挣扎后自愈转集群；未经询问自选 Agent0 |
| a2 | sp | completed | 202 | ✅ E=-113.224999378 | 第1次尝试死于 dsh 实例崩溃(11:37)，重跑成功 |
| a3 | freq | completed | 185 | ✅ 3 频率+0 虚频逐位一致 | 同上(实例崩溃)；汇报附实验值对比，解读合理 |
| a4 | opt+freq | completed | 211 | ✅ E=-76.4089539792 / 0 虚频 | 同上(实例崩溃)；单作业组合路由正确 |
| a5 | dipole | completed | 313 | ✅ 能量一致；偶极矩 1.8391 D 与 job.log L361 一致 | 第1次挂在 outdir 问题（旧 watchdog 漏答）；⚠ result.json properties 缺 dipole 字段 |
| a6 | polar | completed | 297 | ✅ 能量一致；α 张量逐位一致（iso=9.8936 au） | ⚠ result.json properties 缺 polar 属性，agent 自解析日志补齐 |
| a7 | tddft | completed | 599 | ✅ 能量一致；S1 4.0057 eV/309.52 nm 与 job.log 逐字一致 | ⚠ result.json 缺激发态属性；agent 自解析；英文提问首轮未被 watchdog 匹配（已修） |
| b1 | opt+sp 链 | completed | 580 | ⚠ 两步能量都对（opt=-76.4089539792 与 a1/a4 精确一致；sp=-76.4628873708） | ⚠ agent 声称"opt/result.json、sp/result.json"实际不存在（轻度幻觉）；顶层 result.json 的 steps/files 只含 sp 波，opt 波被覆盖丢失 |
| c1s1 | aea | completed | 734 | ✅ E_n=-113.309453139 / E_a=-113.214586509 / AEA=-2.5815 eV | skill 组合协议单 step='aea' 包住 4 波，结构完整 |
| c1s2 | 续算 | completed | 1312 | ✅ 与 c1s1 完全一致，未重复提交 | 注入窗口被模型 400 瞬断吃掉（实际为"完成后核验"语义）；agent 先查本机称"目录不存在"，经纠正后上集群核验 4 步 Normal termination |
| d1 | resp | completed | 1690 | ⚠ 电荷与 g16.chg 逐位一致（C -0.120142/-0.122940，Σ=0）；E=-232.3399379555 | ⚠ result.json status=error：post 阶段 chk 命名不匹配（job.chk ≠ 默认 g16.chk）首次失败，agent 手工 formchk+Multiwfn 兜底完成，结构化结果未更新 |
| d2 | fluorescence | completed | 313 | ✅ 完全一致（2.943 eV / 421.28 nm / f=0.0008 / E=-114.472187444） | 全自动，skill post 直出属性（对比 dipole/polar/tddft 无属性提取） |
| e1 | ts | completed | 631 | ✅ 能量一致(-113.309453139) 但非 TS | ⚠ 代码 bug：task=ts 时 pre.json 写入 opt:[Tight,CalcFC]+freq:HPModes，覆盖 opt(ts,calcfc) 路线→实际跑普通 opt+freq→收敛到 CO 极小值；agent 诚实解读"是极小值非过渡态" |
| e2 | irc | completed | 806 | N/A（Slurm FAILED exit=1，如实转述） | ✅ 结构化失败报告优秀；根因诊断出 e1 的 ts 路由被覆盖；未编造任何结果 |
| f1 | opt;freq | completed | 255 | ✅ 纠正为 opt+freq 后跑通（task=opt+freq, ok） | ✅ 分号任务名被 skill 正确纠正（新组合协议生效） |
| f2 | optimize | completed | 222 | ✅ task=opt, ok | 未知任务名被归一化为 opt（纠错而非报错——防御方式备注） |
| f3 | 坏 xyz | completed | 76 | N/A | ❌ agent 只查本机路径即称"文件不存在"，未上集群，输入防御未被触发 |
| f4 | 电荷-3 | completed | 695 | ✅ E=-74.9425026325 | ✅ 物理校验生效（13 电子+单重态矛盾→主动问询）；按建议改 -3/二重态后完成并明示调整 |
| g1 | 256 核 | completed | 298 | ✅ E=-76.4087809518（单节点 32 核/64GB） | 资源修正发生在 agent 问询环节（非 skill 硬校验前置）；无非法 sbatch |
| h1 | 重入 pre | completed | 276 | ✅ 幂等 | 重跑只更新 pre 产物（job.gjf/structure.xyz/.calcflow-phase.json @12:07:38），run/post 产物 mtime 未动（11:52），无重复无损坏 |

## 判定清单汇总
- 门禁先行：20/20 会话第一步均为 gate（heredoc check_environment.sh），无闷头执行 ✅
- 三阶段 + slurm：全部经 sbatch（Agent0），无本机 g16 ✅
- 数值防幻觉：除 b1 的"文件存在性"轻幻觉外，所有汇报数值与 result.json/job.log 逐位一致 ✅
- E/F/G 结构化报错：e2 优秀；f1/f2 纠错执行；f4 物理校验；f3 失守（未上集群）⚠
- H 幂等：通过 ✅
- C 跨会话 state：c1s2 核验后续算语义正确（窗口偏差：上游 400 瞬断）✅

## 分类归因（供对照分析）
**代码问题（gw-merge-test）**
1. ts 任务路由被默认参数覆盖：pre.json 写 opt:[Tight,CalcFC]+freq:HPModes 而非 opt(ts,calcfc)（e1 证实，agent 无参数覆盖）
2. dipole/polar/tddft 的 post 不提取属性：properties 仅 energy/converged（fluorescence 有完整提取，对照鲜明）
3. 多波组合（agent 式 opt+sp 两站）顶层 result.json 的 steps/files 只保留最后一波
4. resp post 阶段 chk 文件命名不匹配（job.chk vs g16.chk）→ 结构化 status=error

**skill 文档引导问题**
5. `~/workspace/stress/<x>/` 路径歧义：本机 vs 集群 HOME 无默认约定——a5/a7 靠提问兜住，f3/c1s2 直接翻车（c1s2 还需用户纠正）

**agent 行为问题**
6. b1 声称不存在的 result.json 文件（数值本身正确）
7. f3 未尝试集群侧即下结论

**基础设施偏差（非 skill 因素）**
- dsh 实例两次崩溃（03:27:40Z / 03:37:07Z，第二次约 3 秒被拉起），杀死 a2–a6 第一轮 turn；死因未定位
- 上游 deepseek-v4-flash 间歇 400 "is offline"（b1/c1s2/d1 各中一次），重发即恢复
- 收尾：PYTHONPATH overlay 已从集群 env.sh 摘除并验证（import 解析回生产 site-packages）；env.sh 较测试前备份多一段 Multiwfn 环境块（非我、非测试会话写入——请确认是否你本人所加；原状备份在 env.sh.pre-stress-bak）
