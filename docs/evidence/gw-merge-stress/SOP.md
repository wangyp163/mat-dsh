# gaussian-calc skill 压测 SOP

适用：对 gaussian-calc skill（及其下层 gaussian-workflow / calcflow 合并代码）做端到端真实会话压测。
产出：会话号 / task / exit / 耗时 / result.json 一致性 / 偏差备注 的结果表（见 `2026-09-01-stress-table.md`）。

## 0. 设计原则（不可妥协）

1. **prompt 只表达科学意图**：不含命令、路径协议、环境细节（`--json`、三阶段、env.sh 一律不出现）。喂了命令就测不出 skill 的引导能力。
2. **每个 prompt 一个全新会话 + 独立 workdir**：测冷启动 skill 加载、门禁、目录隔离，杜绝上一会话记忆兜底。
3. **判定权在评审者**：agent 汇报数值必须与集群 `<workdir>/result.json`（或原始 job.log）对得上（防幻觉）；错误场景看是否优雅报错而非编造。

## 1. 集群侧准备

```bash
# HPC remote-shell 驱动（凭证从 env.local 取，勿用 shell 里可能过期的 MAT_MCP_KEY）
set -a && . ~/mat-harness/mat-dsh/env.local && set +a
python3 scx.py 11250 '<command>' [timeout]
```

- **待测代码 overlay**：把合并代码 PYTHONPATH 追加到 `~/workspace/demo/env.sh` 尾部，**必须带成对标记注释**（收尾按标记 sed 删除），追加前先备份：
  ```bash
  cp ~/workspace/demo/env.sh ~/workspace/demo/env.sh.pre-stress-bak
  cat >> ~/workspace/demo/env.sh <<'EOF'
  # >>> STRESS-TEST OVERLAY <日期> <代码目录> (remove after stress test) >>>
  export PYTHONPATH="$HOME/workspace/.demo-deploy/<dir1>:$HOME/workspace/.demo-deploy/<dir2>/src${PYTHONPATH:+:$PYTHONPATH}"
  # <<< STRESS-TEST OVERLAY END <<<
  EOF
  ```
- **门禁验证**：source env.sh 后跑 gate 脚本，确认 `ok:true`、协议版本、任务注册表齐全（新组合任务如 `opt+freq` 应出现）。
- **建 workdir**：`~/workspace/stress/<name>/` 每场景一个；畸形输入场景预置坏文件（如 `printf 'abc\n' > .../broken.xyz`）。
- **基线记录**：记下 `squeue` 既有作业，避免收尾时误判/误杀非本测试作业。

## 2. 本地编排设施（tools/ 已归档，可直接复用）

| 工具 | 作用 |
|---|---|
| `sess.py` | dsh `/api` RPC 封装：`ws-list` / `new` / `model` / `send` / `list` / `report`（解码 zstd 转录） |
| `wave.py` | 波次发射器：每场景 `session.create → selectModel → prompt(steer)`，间隔 stagger，登记 `sessions.json` |
| `watch.mjs` | 交互 watchdog：连 mux WS，按固定政策自动答 question/approval，审计 `interactions.jsonl` |
| `reflaky.py` | babysitter：60s 巡检，发现回合死于上游 400 "model offline" 即重发原 prompt（≤3 次） |
| `status.py` | 一行一会话总览（running/turns/steps/转录 staleness） |
| `scx.py` | HPC remote-shell 驱动（见上） |

发射前**必须**先起 watchdog 与 babysitter（后台、setsid、日志落盘）。

## 3. 会话发射

- 每会话三步：`session.create {workspaceId}` → `session.selectModel {provider:"mat", model:"deepseek-v4-flash", reasoningEffort:"high"}`（**实例默认 glm-5.3-flash 不支持 effort high，跳过此步必炸**）→ `session.prompt mode:"steer"`。
- 场景间 stagger ≥60s，避免门禁 heredoc 与 HPC MCP 并发冲击。
- 依赖时序：中断续算（C 组 s2）在 s1 作业已提交、未跑完时注入；E2 等 E1 收尾；H1 等 A4 收尾。
- `sessions.json` 记 name → sessionId / prompt 文件 / 发送时间 / 重试次数。

## 4. 交互应答政策（watchdog 规则要点）

按**语义**分类（id 与语言都不固定，见过的 id 就有 `cluster/cluster_confirm/cluster_id/partition/partition_confirm/outdir/correct_path/mult_choice`）：

| 场景 | 应答 |
|---|---|
| 集群选择 | 含 11250/昆山的选项 |
| `~/workspace/stress/x` 指哪里 | 集群 HOME 侧选项 |
| 分区 | Agent0 |
| 随机构型怎么来 | custom：由你自行生成合理的随机扰动构型 |
| 删除/覆盖 | custom：允许，仅限本会话 `~/workspace/stress/` 内 |
| 资源超限 | custom：按你的建议修正到集群允许范围后继续，并在汇报中说明 |

硬性技术约束（踩过的坑）：
- `selected` 必须是**逐字完整 option label**（`"Agent0 (Recommended)"` 而非 `"Agent0"`）；帧内**所有** question id 都要答，否则 `{"accepted":false,"reason":"bad-response"}`。
- pending question 会向**每个新 mux 连接重放**——watchdog 重启后可补答；但 dsh 进程重启会丢 pending（`not-pending`）。
- 正则里写 `~/` 必须转义成 `~\/`，否则正则提前闭合、后续 `|中文|` 变按位或 → ReferenceError 且只在该类问题上炸。
- `pkill -f` 的模式会匹配到自身命令行误杀 shell，用精确 PID。

## 5. 判定清单（每会话）

- [ ] 先跑门禁（heredoc check_environment.sh），而非闷头执行
- [ ] 三阶段顺序正确，run 阶段是 sbatch 而非本机 g16（result.json `steps[].stages.run.slurm` 有值）
- [ ] 汇报数值 ↔ `result.json`（properties 缺失时 ↔ 原始 job.log）逐位核对
- [ ] agent **声称的文件**真实存在（b1 教训：声称 `opt/result.json`，实际没有）
- [ ] E/F/G：结构化报错被正确转述，无编造、无假装成功
- [ ] H：目录无重复/冲突产物（用 mtime 分层核验：重跑只动 pre 产物）
- [ ] C-s2：从已有 state 续算/核验，而非从头重算

## 6. 已知坑与对策（基础设施层，与 skill 无关）

| 坑 | 对策 |
|---|---|
| dsh 实例静默崩溃（20 分钟内两次，无 OOM/日志），在飞回合无声死亡（会话 idle 但 turn 未闭合） | status.py 盯转录 mtime；崩溃后同 prompt **开新会话**重跑（同会话重发会混入崩溃前上下文）；集群残留作业 sacct 确认归属再清理 |
| 上游 deepseek-v4-flash 间歇 400 `model [deepseek-v4-flash] is offline` | reflaky.py 自动重发即恢复；区分于真错误（看 turn/end 的 error message） |
| 本机/集群 `~/workspace` 歧义 | 部分 agent 会只查本机就说"不存在"（f3/c1s2 教训）——判定时先问自己：它到底去哪边查了？必要时用 custom 应答纠正到集群 |
| 误判作业归属 scancel | scancel 前先 `sacct -j <id>` 核对 JobName/提交时间与本测试目录的对应关系 |

## 7. 收尾（必做）

1. **摘 overlay**：`sed -i "/>>> STRESS-TEST OVERLAY/,/<<< STRESS-TEST OVERLAY END/d" ~/workspace/demo/env.sh`，然后 `md5sum` 对比备份（不一致要能解释每一行差异），并 `python3 -c "import gaussian_workflow; print(gaussian_workflow.__file__)"` 确认解析回生产 site-packages。
2. 停 watchdog / babysitter（精确 PID）。
3. 归档：结果表 + prompts + sessions.json + interactions.jsonl + tools 进 `docs/evidence/<run-name>/`，写 README。
4. 交接表必须含**归因分类**：代码问题 / skill 文档引导问题 / agent 行为问题 / 基础设施偏差——后续修复各归各口。
