# mat-dsh

HPC 科学计算 harness（基于 DeepSeek Harness 0.1.0-rc.8，树外组合，不改宿主源码）。

- 设计：`../docs/superpowers/specs/2026-08-27-mat-dsh-design.md`
- M0 spike 计划：`../docs/superpowers/plans/2026-08-27-mat-dsh-m0-spike.md`

## 启动（M0）

```bash
cp env.example env.local   # 填入真实凭证
set -a; source env.local; set +a
pnpm install
pnpm --dir ../deepseek-harness dsh web --no-open --patch "$PWD/profiles/mat.yml"
```
