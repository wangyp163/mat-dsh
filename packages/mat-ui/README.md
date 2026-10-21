# mat-ui

HPC Web UI 增强层：品牌换肤、会话文件归档、作业状态板卡片。

## 兼容矩阵（发布窗口窄，阅读后再升级宿主）

| 依赖机制 | 钉死对象 | 失配表现 | 处置 |
|---|---|---|---|
| `dsh.harmony.patches`（turn-fold-compat / details-tab-reactivity 两个 Source Patch） | 宿主 dsh **web-app 源码**（本包验证基线 `0.1.0-rc.8`） | patch 应用失败/白屏 | `MAT_UI_OFF=1` 整行禁用本包，核心工具面不受影响 |
| `dsh.client.inject`（7 个 `@deepseek-ai/dsh-client-ui-*` 内部包） | dsh client 模块公共面（`^0.1.0-rc.8`） | client 模块加载报错 | 同上；升级本包依赖范围后恢复 |

升级宿主 dsh 后：先 `MAT_UI_OFF=1` 起服务验证核心链路，再对照 web-app
源码差异核对两个 patch 是否仍可应用，最后放开开关。

## 与核心能力的关系

本包是**可选层**：mat-tools / mat-skills / mat-core 不依赖它，任何
dsh 发行版（含无 web UI 的 headless profile）都可只装核心。状态板/归档的
数据面全部由 mat-tools 的 `ctx.provide('mat.status' / 'mat.files')`
承载，本包只做呈现。

## 构建

`lib/client.js` 由 `scripts/build-mat-ui.mjs` 生成（dsh-web.sh start 时自动
执行）；`src/` 是 Harmony 原生 ESM loader 直接加载的 TS 源。
