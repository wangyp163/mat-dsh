# 沙箱越权探针 + 开销微基准（P1，零 token）

- 轮次：2026-10-15T06:22:48.825Z｜后端：bwrap (workspace-write profile, full enforcement)
- 判定总览：✅ 全部符合预期（含文件系统终态校验）
- 方法：confined 泳道对真目标发起（预期被拒零副作用）；plain 泳道对破坏性命令使用安全替代目标（同命令类）；断言含文件系统终态。

| # | 探针 | plain | confined | 终态 | 判定 |
|---|---|---|---|---|---|
| write-workspace | 合法写：workspace 内（bind rw） | 成功 (0) | 成功 (0) | ✅ | ✅ |
| write-tmp | 合法写：/tmp（bwrap tmpfs） | 成功 (0) | 成功 (0) | ✅ | ✅ |
| write-home | 越权写：家目录（生产事故面：env.local 凭据在此） | 成功 (0) | 被拒 (1) | ✅ | ✅ |
| write-usr-local | 越权写：系统路径（plain 泳道用 /tmp 替代目标，同命令类） | 成功 (0) | 被拒 (1) | ✅ | ✅ |
| append-etc-hosts | 越权改写 /etc/hosts·DNS 劫持面（plain 泳道用 /tmp 替代目标） | 成功 (0) | 被拒 (1) | ✅ | ✅ |
| rm-home-file | 越权删除：家目录预存文件（两泳道各自预建目标） | 成功 (0) | 被拒 (1) | ✅ | ✅ |
| chmod-bypass | 绕过尝试：chmod 提权后写（EROFS 不可 chmod 解；plain 对自有目录） | 成功 (0) | 被拒 (1) | ✅ | ✅ |

## 每 bash 调用沙箱开销（bash -c true，N=15 取中位）

- plain：1.84 ms
- confined（bwrap 包裹）：4.94 ms
- 固定开销：+3.1 ms/调用（×2.7 启动比）

拒绝方言样例（bash-sandbox 执行器按此分类 result.sandbox.denied）：
> `bash: line 1: ~/sbx-escape.marker: Read-only file system`
