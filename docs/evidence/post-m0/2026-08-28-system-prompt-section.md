# 系统提示引导段：HPC 计算套件第一时间可见（2026-08-28）

## 背景

用户在 web 使用中反馈：dsh 无法第一时间定位到 HPC 计算套件。web profile 的 deployment persona 只有一句
"You are a coding agent powered by the {{model}} model. Your working directory is {{cwd}}."（`--dump-config` 实测），
零 HPC 语境；工具仅靠 schema 自描述，领域级措辞（"看看作业队列"）不必然映射到 `mat_exec`。

## 改动

`packages/mat-tools/src/index.ts`：插件注册 `dsh-system-prompt` 工具引导段（宿主约定槽位 order 100–199），
`inject` 增加 `systemPrompt`，类型经 `import type {} from '@deepseek-ai/dsh-system-prompt'`（link: 依赖同 cordis/dsh-tools 模式）。
内容要点：HPC 集群经 mat_exec 直达、集群/Slurm/远程计算请求必须调它而非声称无法访问远程、
cluster_id 来源（示例 11250 华东一区【昆山】）、返回语义、长时计算走 sbatch/squeue/sacct 不同步等待。

## 验证（headless 行为级，领域措辞不含工具名/命令）

任务：`帮我看看 11250 集群现在的 Slurm 作业队列和节点状态，总结一下`

会话落盘（/tmp/mat-dsh-m0-home/sessions/.../session-7eec8f94-05b8-486f-84ed-696cefc8c601）真实 tool/call：

```json
{"type":"tool/call","seq":96,...,"name":"mat_exec","arguments":"{\"cluster_id\": \"11250\", \"command\": \"squeue --all -o \\\"%.10i %.8u %.12j %.8T %.10M %.6D %.10R %Q\\\" 2>/dev/null | head -60\", \"timeout_seconds\": 30}"}
{"type":"tool/call","seq":98,...,"name":"mat_exec","arguments":"{\"cluster_id\": \"11250\", \"command\": \"sinfo -o \\\"%10P %10a %6D %8T %10c %8m %20G %20E\\\" 2>/dev/null\", \"timeout_seconds\": 30}"}
```

模型输出基于真实结果总结了 600 节点、CPU/DCU 分区占用与 7 个 drained 节点原因。exit=0。

对照：改动前不带工具名的简单任务（`在 11250 集群上执行 hostname && whoami`）headless 下模型也能靠 schema 找到工具
（首连失败后自行拆分重试成功）——引导段的价值在领域级请求的即时映射与工作流预期（Slurm 提交而非同步跑）。

## 门禁

- `pnpm test`：30/30 绿（6 文件）
- `pnpm typecheck`：exit=0（含 scripts）
- web 重启自检：HTTP 200，无插件加载错误
- 宿主 `git -C deepseek-harness status --short`：空
