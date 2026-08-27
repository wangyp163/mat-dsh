# M0 Spike 判定（日期：2026-08-27）

| 出口判据 | 结果 | 证据 |
|---|---|---|
| 端到端：一句话让模型调 mat_exec 真集群执行成功（headless 自动化） | PASS | docs/evidence/m0/task11-e2e-transcript.md |
| 传输冒烟（11250 hostname） | PASS | docs/evidence/m0/task10-smoke-exec.txt |
| 宿主 git 干净 | PASS | `git -C ../deepseek-harness status --short` 输出为空 |
| 全部单测绿 | PASS | `pnpm test` 输出（贴末尾摘要） |

## 判定：GO（进入 M1）

## 遗留与发现（进 M1 计划输入）
- curl `-D /dev/stderr` 在 Linux 管道 stderr 下不可写（rc=23）→ 改 `-D -`（头写 stdout），transport 提取 session id 改读 stdout；Python 原版未暴露是因为其 stderr 为 tty
- 树外插件依赖用 `link:` 绝对路径指向宿主 workspace 的 cordis/dsh-tools（npm 上 dsh-tools 仅 stale 0.0.1-rc.1），与宿主共享同一实例，零双实例风险
- Task 9 曾发生实施者误在宿主仓库提交（526e8e3），已验证纯新增后 `git reset --hard 141eb6fef8` 恢复，文件在 $REPO 正确重提；后续任务强制 pwd 纪律
- **端到端实测补充**：
  - LLM 模型：deepseek-v4-pro（LLM_MODEL_ID）
  - 工具调用一次成功，无需重试
  - 端到端耗时约 30-60 秒（含 LLM 往返 + mat_exec 工具执行）
  - 返回值完全匹配 Task 10 冒烟值：hostname=`sandbox-11333188068`，user=`hpc-user-a`
  - headless profile 与 mat.yml overlay 无冲突，配置组合正常
- Web 启动自检通过：监听 127.0.0.1:3080，HTTP 200 响应，无插件加载错误
- 无 sk- 凭证泄露（grep -c 'sk-' → 0 在所有证据输出中）
- DSH_HOME=/tmp/mat-dsh-m0-home 隔离有效，宿主仓库未受影响
