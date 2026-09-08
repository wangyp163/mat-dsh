# gaussian-calc 知识索引（kb）

> 结构化 wiki：签名可 grep、条目带 frontmatter、按需 Read。**errors/ 与 methods/ 在三血脉字节一致**（check_env_drift 守护）；contracts/ 与 runbooks/ 允许环境差异。

## 检索协议（写进肌肉记忆）

1. **workflow 结构化错误**（result.json 的 `error` 通道）：消息内带 `kb:<id>` 条目引用——直接 `Read references/**/<id>.md`，无需 grep。
2. **裸 log / 用户贴报错**：先 grep log 拿签名片段（`grep -m3 -nE "<可疑行>" <log>`），再 `grep -ril "<签名片段>" references/` 命中条目文件，Read 之。
3. 都未命中：读本 INDEX 路由表按主题找；仍无——按「知识沉淀协议」（见下）新建条目。

## 条目 schema

```markdown
---
id: <kebab-case>            # 唯一；workflow 错误消息以 kb:<id> 引用，勿改名
signature: "<regex>"        # 可直接对 log grep 的签名（errors/ 必填）
task: [ts, opt, ...]        # 相关 task
versions: [">=1.5.1"]       # 适用 workflow 版本
source: "session xxx / 压测 rN / sobereva/164"   # 出处可审计
---
## 症状 / 根因 / 处方 / 禁止事项
```

## 路由表

| 目录 | 内容 | 条目 |
|---|---|---|
| `errors/` | 精确签名 → 根因/处方 | `ts-step-limit`（优化步数超限/l9999 收尾猝死 → `methods/ts-convergence`）；`irc-l123-divergence`（IRC corrector 发散三级梯进：StepSize 减半→CalcAll→Steep → `methods/irc-methods`） |
| `methods/` | 方法学指引 | `ts-convergence`（几何优化不收敛诊断与解法，sobereva/164 + tsxtb 特化）；`irc-methods`（IRC 计算方法学与参数语义，sobereva/400 + 端点精修）；`ts-selection`（ts/qst2/qst3 选择，正文见 SKILL.md 特殊 task 节，待迁入） |
| `contracts/` | workflow 契约细则 | （随 SKILL.md 拆分轮充实；现驻 SKILL.md 正文与 `docs/gaussian-json-input.md`） |
| `runbooks/` | 部署/压测 SOP 指针 | （指针至 SOP 库 `~/dev/sops/`，不在 skill 内复制正文） |

## 知识沉淀协议（排障结束的动作）

排障闭环后提炼一条 `errors/` 或 `methods/` 条目（签名/根因/处方/版本锚/来源 session），经 review 合入 canonical——对齐 M 记事纪律，但知识不再堆进 SKILL.md adaptation 长行。**Phase-2（向量 RAG）触发条件**：条目 >300，或压测出现「agent 未命中条目」的 recall 失败，或语料扩到 Gaussian 手册/sobereva 博客/会话归档量级——届时以独立 `mat-kb` 包做 BM25+向量混合检索，条目 frontmatter 直接复用为 metadata filter，本 wiki 平移不改写。
