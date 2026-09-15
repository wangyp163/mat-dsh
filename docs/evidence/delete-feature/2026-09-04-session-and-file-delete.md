# 会话删除 + 文件面板本地删除（2026-09-04）

功能：左侧会话行菜单「删除会话」（归档项之后，红色危险项）→ 确认弹框（勾选「同时删除会话文件（转录日志）」默认勾选）；
右侧文件面板「删除」按钮 → 面板内确认条 → 仅删本地副本（远端不动）。

## 实现面

**宿主仓（deepseek-harness，未提交携带，bundle 已重建部署）**
- `SessionPersistence.delete`（基类默认拒绝）+ `PersistenceCoordinator.delete`（per-id 串行、retirement 排水等待、preparations/states 失效、`deleteStored` 钩子）+ JSONL 后端 `deleteStored`（findLog → rm 会话目录，幂等）。
- `WorkspaceRegistry.deleteSession(id, keepLog)`：record 级 detach + headers 索引清理 + 归档集沉降（keepLog=加入集合；否则移除；集合成员视为已知 id）。
- RPC `workspace.deleteSession {sessionId, deleteFiles}` 全链路（api/schema/rpc-map/handler/client.ts）；错误码新增 `session-active`。
- api-proxy 处理器：subagent 栅栏 → 活跃 turn 拒绝 → handle.dispose（gateway 级 handle 保留：agent-lookup onHandle + ensureSession/fork 三处）→ 记账先行、文件后删 → 幂等/自愈语义。
- 客户端运行时：SessionsPort.refresh 门面放宽；WorkspaceManager/Runtime.deleteSession（ok 后双基线刷新，冷会话无帧路径收敛）。
- ui-workspace：会话行菜单删除项（danger）+ 浏览器级确认弹框（勾选默认勾选）+ zh/en 文案 + Rows/Modal 测试假件同步。

**mat-dsh（未提交工作树）**
- `MatFileServiceImpl.deleteLocalFiles`：身份严格绑定（= listWorkspace 同源）、越界拒绝、目录递归删、missing 报告、pins 卫生。
- `/mat-files/delete` 路由（POST，路径围栏 ≤100）。
- FileManagerPanel 删除按钮（outline+trash 图标）+ 面板内确认条（本地副本警示）+ treeCache 任务级失效 + removePaths 清选中/pin/展开。

## 验证实据（live，127.0.0.1:3080）

| 场景 | 结果 |
|---|---|
| 冷会话 + 删文件（vd1） | ok；`sessions/--tmp-…--/<id>/` 目录清除；session.list 不再返回；重复删 → session-not-found（vd2） |
| 活跃会话 + 保留文件（vd3） | ok；attachedSessions 1→0（handle.dispose 生效）；`session.jsonl.zstd` 保留；id 进归档集（76 含）|
| 活跃会话 + 删文件（g4，修复后终验） | ok；目录清除；列表移除；agent 0 |
| 归档集残留条目补删（vd6） | ok；集合 76→75；id 移出 |
| 未知 id（smoke/vd2） | session-not-found 业务错误 |
| 文件路由（999901 fixture） | `{"deleted":["a.txt","subdir"],"missing":["remote-only.log"]}`；keep.txt 保留；pins 清理 |

## 验证中抓到并修复的缺陷（红→绿）

1. keep-log 删除后的二次删除在 registry 存在性检查失败（headers 已清 + 文件删后重列表落空）→ 归档集成员视为已知。
2. api-proxy 冷检查同源问题 → 同样接受归档集成员（自愈残留）。
3. dispose 后 coordinator retirement 排水竞态 → `delete` 先 `waitForRetirement` 再判 owner。
4. 文件删除先于记账的顺序缺陷（文件已删 + registry 抛错 = not-found 谎报）→ 记账先行、文件后删（失败重试自愈）。

## 门禁

- 宿主仓：`tsc -b tsconfig.host.json` ✅；`tsc -b tsconfig.client.json` ✅；`build:lib:host`/`build:lib:client`/ui-workspace bundle ✅；
  vitest scoped：ui-workspace / workspace / session-persistence(+jsonl,+sqlite 单跑) / apiproxy / client-runtime / api-remotes = **1410 passed**（sqlite 重试节奏 1 例满载抖动，单跑 82/82 绿）。
- mat-dsh：`pnpm test` **363/363** ✅；`pnpm typecheck` ✅；mat-ui bundle 重建 ✅（含 confirm 条与 delete 路由字符串）。
- 部署：dsh-web.sh restart 后 RPC 实测如上；fixture 全部清理（jobs.json 21→20、999901 目录与临时会话目录已删）。

## 已知限制

- 本环境无浏览器后端（agent.browsers.list() = []），DOM 级交互未截图验收；以 bundle 字符串 + 42 项 workspace-browser 组件测试 + RPC/磁盘实据佐证。
- 删除「保留文件」语义 = 归档集隐藏 + 记账摘除（unarchive 面尚不存在，文件可手工找回）。
- 多标签页：冷会话删除无推送帧，其它标签页在下次刷新/重连前保留旧行（点击会得到 session-not-found）。
