# M3 前端状态卡与学术精修层证据

日期：2026-08-28

## 自动验证

见 `2026-08-28-verification.txt`：

- `pnpm build:mat-ui` 成功；
- `pnpm typecheck` 成功；
- `pnpm vitest run`：20 个测试文件、165 个测试全绿。

## Web 实载探针

见 `2026-08-28-web-probe.txt`：

- `/` 返回 200，boot 图含 `mat-ui`；
- `/plugins/<mat-ui>/client.js` 返回 200，`window.__ModuleLoader__.load` 恰好一次；
- `/mat-status/jobs` 返回 200、`application/json`、`{"jobs":[]}`；
- `/tmp/mat-dsh-web.log` 无 error/failed/exception；
- 宿主仓 `deepseek-harness` 的 `git status --short` 为零行。

空 `jobs` 是此探针时刻无运行中或已结算 producer 的正确状态；producer→board 的 monitoring/settled/properties/files 数据流由 `packages/mat-tools/test/status-wiring.test.ts` 覆盖。

## 实现面

- `conversation.input.dock`：5 秒轮询的实时 HPC 计算监控卡；
- `conversation.chat.turnTail`：最近结算结果、物性和文件；
- `tool.call.toolview`：HPC 状态、提交、Gaussian、传输工具的表格化视图；
- `theme.overrideTokens`：light/dark 成对的常开学术精修层；
- 标题采用衬线字体，数值与作业标识采用等宽字体。
