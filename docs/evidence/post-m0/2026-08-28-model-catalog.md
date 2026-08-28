# 模型目录修复：双模型可区分 + 1M 上下文 + 默认推理 high（2026-08-28）

## 现象

web 模型选择器里两个模型都显示 "HPC LLM"，无法区分 deepseek-v4-pro / deepseek-v4-flash；
上下文窗口曾为 128k；默认推理等级需固定 high。二轮反馈：HPC LLM 的模型
**没有推理等级可选**。

## 根因

1. overlay 的 `llm-deepseek.config.models` 覆写把插件默认目录（本就是
   `deepseek-v4-flash` "DeepSeek-V4-Flash" + `deepseek-v4-pro" "DeepSeek-V4-Pro"，
   `DEFAULT_CONTEXT_WINDOW = 1_000_000`，推理默认 high，见
   `deepseek-harness/packages/llm/llm-deepseek/src/index.ts:52-53` 与 `adapter.ts:99`）
   替换成了单条 env 驱动的 "HPC LLM"。`llm-pi-ai` 侧同理，且其插件默认仅 262144
   （`config.ts:57`），1M 必须显式声明。
2. pi-ai 的 `reasoningInfo()`（adapter.ts:159）**只有模型声明了 reasoningEfforts 才产出
   reasoning 元数据**；mat 是 hand-declared 路由（不在 pi-ai 内置目录），缺省 =
   无等级可继承 → `resolveModelInfo` 无 `reasoning` 字段 → /model 弹窗无推理等级。
   路由级 `reasoning: high` 只在被支持等级内取默认（`describableReasoningLevel`），
   等级集为空时同样不显示。

## 改动（profiles/mat.yml）

- `llm-pi-ai.providers.mat`：显式双模型目录（DeepSeek-V4-Pro / DeepSeek-V4-Flash，
  各 `contextWindow: 1000000`）+ 每模型 `reasoningEfforts: {off:, low, high, max}`
  （等级集对齐 llm-deepseek 插件枚举；off 空值=不发送）+ 路由级 `reasoning: high`；
  删除旧 maxTokens: 8192
- `llm-deepseek`：**删除 models 覆写**（回落到插件双模型默认目录，本就 1M）+
  显式 `reasoningEffort: high`；注释说明不要再覆写 models

## 验证

- `--dump-config`（web profile）：llm-pi-ai 行 reasoning: high + 双模型 @1000000 +
  各带 reasoningEfforts；llm-deepseek 行无 models + reasoningEffort: high
- 最小探针（tsx 起 LlmRuntime + llm-pi-ai 同形 config）直查 `resolveModelInfo('mat', ...)`：
  `context.contextWindow = 1000000`、`reasoning.efforts = [Off, Low, High, Max]`、
  `reasoning.defaultEffort = "high"`（修复前无 reasoning 字段）
- headless 运行时冒烟×2（`只回复两个字：收到`，均 exit=0）：
  - deepseek-official 路由：`{"provider":"deepseek-official","model":"deepseek-v4-pro","reasoningEffort":"high","maxTokens":256000}`
  - mat 路由（临时把 settings agent-default-model 指到 mat，验后恢复）：
    `{"provider":"mat","model":"deepseek-v4-pro","reasoningEffort":"high"}`——
    未显式选等级，profile 级 `reasoning: high` 生效，网关接受（会话含 reasoning 事件）
- web 已用新 overlay 重启（3080 HTTP 200，无加载错误）
