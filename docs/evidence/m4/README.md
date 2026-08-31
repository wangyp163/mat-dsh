# M4 Thinking / Tool Call 输出显示管理

日期：2026-08-31

## 交付

会话标题栏新增“输出”管理按钮：

- 推理：隐藏 / 摘要 / 展开；
- 工具调用：隐藏 / 摘要 / 展开；
- 快捷动作：整洁模式 / 全部展开；
- 默认两类均为摘要；
- localStorage 持久化，存储不可用时安全降级；
- MutationObserver 使流式新增内容自动遵循当前模式；
- Escape 和点击外部可关闭 popover；
- 操作限定在按钮所属 ConversationRoot，不串扰其它会话。

实现不修改宿主，也不依赖 CSS Modules 哈希；仅使用宿主稳定契约：`data-phase`、`data-variant="think"`、`data-chat-call-id`、`data-disclosure-row` 与 `aria-expanded`。

## 验证

见 `2026-08-31-verification.txt`：构建和 typecheck 成功，22 个测试文件、172 个测试全绿。

Web restart 后实载探针：

```text
/ 200 14779 text/html; charset=utf-8
/plugins/<mat-ui>/client.js 200 21041 text/javascript; charset=utf-8
/mat-status/jobs 200 11 application/json; charset=utf-8
mat-output-visibility true
data-mat-thinking true
data-chat-call-id true
var module = { exports: {} } true
```

`/tmp/mat-dsh-web.log` 无 error/failed/exception；宿主 `deepseek-harness` 的 `git status --short` 为零行。
