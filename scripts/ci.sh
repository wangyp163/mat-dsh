#!/usr/bin/env bash
# CI 单一定义（本地 / pre-push hook / 任何 CI 系统都调这一个）。
#
# 为什么单独成脚本而不是把步骤散在 CI 配置里：本仓 remote 是 Gitee，
# .github/workflows/ci.yml 不会被自动执行。把步骤收敛到此处，可执行路径
# 只有一条，避免「CI 配置写了但从没跑过」的假安全感。
#
# 用法：bash scripts/ci.sh
set -euo pipefail

cd "$(dirname "$0")/.."

echo "== typecheck: mat-core =="
npx tsc --noEmit -p packages/mat-core

echo "== typecheck: mat-tools =="
npx tsc --noEmit -p packages/mat-tools

echo "== test: full suite =="
npx vitest run

echo "== ci: OK =="
