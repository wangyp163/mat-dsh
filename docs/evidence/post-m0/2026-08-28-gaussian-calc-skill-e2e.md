# gaussian-calc skill 加载失败排障与 e2e 通过（2026-08-28）

## 现象

用户 web 会话请求 Gaussian 计算准备，`skill{"gaussian-calc"}` 返回
`Error: skill "gaussian-calc" is unknown or no longer available`（isError=true），模型退化为 glob +
集群软件搜索（module avail / which g16 / find /opt），未走 skill 流程。

## 排障链（三层证据）

1. **会话轨迹**（`session-be0df683`，/tmp/mat-dsh-m0-home/sessions/...）：确认 skill 调用失败在先、
   软件搜索在后；系统提示含 mat 引导段但**无任何 skill catalog**。
2. **时间线**：web 进程 09:31:03 启动，`profiles/mat.yml` 的 skill-filesystem 行 09:51:24 才写入，
   失败会话 09:54:23 创建于旧进程——但重启后 fresh 进程 headless 复现同样失败，排除"仅陈旧进程"。
3. **最小探针**（/tmp/probe-skills.ts，tsx 起最小 cordis 组合直查 `ctx.skills.list()`）：
   - customSkillDirs 指向最小合法 frontmatter 的 tmp 目录 → **能发现**（机制正常）；
   - 指向真实 skills 目录 → 空；真实 SKILL.md 拷进 tmp → 仍空 → **内容问题**；
   - 逐字段二分：unquoted description（含 `CLI: sp`，冒号+空格）→ 拒；加引号 → 过。

## 根因

**YAML frontmatter 裸标量含 `: `**：description 里的 `gaussian-workflow CLI: sp, opt, ...` 使
plain scalar 非法，`parseFrontmatter` 抛错 → 整个 SKILL.md 被 warn+skip
（宿主 `skill-filesystem/src/index.ts:803`，`invalid YAML frontmatter` 路径），
skill 目录静默为空。warn 在 app 日志不可见（最小组合也无输出），加大了定位成本。

次要发现：**web profile 宿主面 `skill-filesystem` 行是 disabled**（`packages/bundle/web-app/cordis.patch.yml`
"presets own local discovery"），customSkillDirs overlay 行在 web 下只合并进被禁用的行，不生效；
preset 层实例只扫默认根。headless 下宿主行启用，overlay 行生效。

## 修复

1. `skills/gaussian-calc/SKILL.md`：description 整体单引号包裹（附注释说明原因）。
2. 顺手修正长期 minor：21 处 `mat_exec --cluster-id ... --command ... --timeout N` CLI 旗标写法
   → `mat_exec({"cluster_id": ..., "command": ..., "timeout_seconds": N})`（工具实为 JSON 参数），
   并在工具说明处写明调用形态。
3. **web profile 通路**：`ln -s` 把仓库 skills 目录挂到 `$DSH_HOME/skills`（user-dsh 根，rank 400，
   preset 层 skill-filesystem 会扫）。headless 继续用 overlay customSkillDirs 行；两路探针均验证
   `gaussian-calc(custom)` / `gaussian-calc(user-dsh)` 可发现（含 ctx.fs 在场路径）。

## e2e 验证（headless，真实 LLM + 真实 11250 集群）

任务：`在 11250 集群上准备一个水分子的高斯 opt 计算：按 gaussian-calc skill 的流程做环境门禁并采集可用分区，列出需要我确认的选项。先不要提交作业。`
exit=0。会话 `session-a4d1deb4` 真实轨迹：

```text
skill{"gaussian-calc"}                          -> ok（<skill_content> 全文返回）
read skills/gaussian-calc/scripts/check_environment.sh（读本地 bundle）
mat_exec cat > /tmp/check_environment.sh      -> 上传门禁脚本
mat_exec bash /tmp/check_environment.sh       -> {"schema":"gaussian-env-gate.v2","ok":true,...}（11250 实测 11/11 tasks）
mat_exec sinfo -o '%P %a %l %D %t %N'         -> 5 分区采集
```

最终答复：门禁表（workflow_env=/public/home/hpc-user-a/workspace/demo、g16-hy、11/11 tasks）+
分区表（kshctest/kshdtest/kshdAI/kshdsctest/Agent0）+ 待确认选项（分区/方法基组/opt 选项/资源/Slurm），
明确"不提交作业"。全程无 module avail / which g16 / find 软件搜索。

对照：修复前同任务（session-be0df683 / session-cb071b66）首步 skill 即 error，随后软件搜索绕路。

## 门禁

- 宿主 `git -C deepseek-harness status --short`：空（skills 放 mat-dsh 仓库，宿主零写入）
- 探针四组发现性验证见上；e2e exit=0
- `pnpm test`（mat-dsh）：30/30 绿（本次未改 mat-core/mat-tools 逻辑，引导段 Gaussian 句为纯文案）
