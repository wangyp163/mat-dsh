# vasp-calc 知识索引（kb）

> 结构化 wiki：签名可 grep、条目带 frontmatter、按需 Read。对齐 gaussian-calc 的
> INDEX 协议；条目尚在种子期（通用 VASP 排障知识，未经本仓集群实证——首次命中后
> 回写实证来源）。

## 检索协议（写进肌肉记忆）

1. **producer 结构化诊断**（job_output 的 `engine_error:` / `log_tail:` 行）：先拿
   签名片段，`grep -ril "<签名片段>" references/` 命中条目文件，Read 之；
2. **裸 log / 用户贴报错**：`mat_exec grep -m3 -nE "<可疑行>" <Task.*>/OUTCAR` 拿
   签名，再 `grep -ril` 本目录；
3. 都未命中：读本 INDEX 路由表按主题找；仍无——按知识沉淀协议新建条目。

## 条目 schema

```markdown
---
id: <kebab-case>            # 唯一
signature: "<regex>"        # 可直接对 log grep 的签名（errors/ 必填）
task: [relax, scf, ...]     # 相关 task
versions: ["0.1.3"]         # 适用引擎版本
source: "seed / session xxx / 压测 rN"   # 出处可审计
---
## 症状 / 根因 / 处方 / 禁止事项
```

## 路由表

| 目录 | 内容 | 条目 |
|---|---|---|
| `errors/` | 精确签名 → 根因/处方 | `vasp-electronic-unconverged`（电子步不收敛：ALGO 换档梯级）；`vasp-zbrent-fatal`（离子步线搜索崩：IBRION 换族）；`vasp-out-of-memory`（核时/内存爆：KPOINTS 稠密或体系过大） |
| `methods/` | 方法学指引 | （待沉淀：收敛策略、K 点选择、2D 材料真空层规范） |
| （根） | 任务/引擎参考 | `task-reference.md`（任务注册表、preset、交接语义、CLI、JSON 契约） |

## 知识沉淀协议（排障结束的动作）

排障闭环后提炼一条 `errors/` 或 `methods/` 条目（签名/根因/处方/版本锚/来源），
经 review 合入 canonical（vasp-matstream-agent 的 skill 树与本仓三方同步的锚点是
引擎源码仓）。种子条目命中后**必须回写实证来源**，把 `source: seed` 替换为真实
session/作业号。
