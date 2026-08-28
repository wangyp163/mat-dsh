# 模型目录修复：双模型可区分 + 1M 上下文 + 默认推理 high（2026-08-28）

## 现象

web 模型选择器里两个模型都显示 "HPC LLM"，无法区分 deepseek-v4-pro / deepseek-v4-flash；
上下文窗口曾为 128k；默认推理等级需固定 high。

## 根因

overlay 的 `llm-deepseek.config.models` 覆写把插件默认目录（本就是
`deepseek-v4-flash` "DeepSeek-V4-Flash" + `deepseek-v4-pro` "DeepSeek-V4-Pro"，
`DEFAULT_CONTEXT_WINDOW = 1_000_000`，推理默认 high，见
`deepseek-harness/packages/llm/llm-deepseek/src/index.ts:52-53` 与 `adapter.ts:99`）
替换成了单条 env 驱动的 "HPC LLM"。`llm-pi-ai` 侧同理，且其插件默认仅 262144
（`config.ts:57`），1M 必须显式声明。

## 改动（profiles/mat.yml）

- `llm-pi-ai.providers.mat`：显式双模型目录（DeepSeek-V4-Pro / DeepSeek-V4-Flash，
  各 `contextWindow: 1000000`）+ 路由级 `reasoning: high`（生效点
  `adapter.ts:295 options.reasoningEffort ?? profile.reasoning`）；删除旧 maxTokens: 8192
- `llm-deepseek`：**删除 models 覆写**（回落到插件双模型默认目录，本就 1M）+
  显式 `reasoningEffort: high`；注释说明不要再覆写 models

## 验证

- `--dump-config`（web profile）：llm-pi-ai 行 reasoning: high + 双模型 @1000000；
  llm-deepseek 行无 models + reasoningEffort: high
- web 已用新 overlay 重启（3080 HTTP 200）
- headless 运行时冒烟（`只回复两个字：收到`，exit=0），request/header 实测：
  `{"provider":"deepseek-official","model":"deepseek-v4-pro","reasoningEffort":"high","maxTokens":256000}`
