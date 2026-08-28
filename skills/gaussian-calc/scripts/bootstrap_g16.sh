#!/bin/bash
# =============================================================================
# bootstrap_g16.sh — Gaussian 16 运行环境自检 + 按需拷贝到用户家目录
# -----------------------------------------------------------------------------
# 执行模型：g16 封装在 /public 软件包里，不在宿主机 PATH。本脚本把整个
# g16-hy 包拷到 $HOME/workspace/g16-hy，使后续
#   `source $HOME/workspace/g16-hy/scripts/env.sh` 即可让 g16 进 PATH。
#
# 公共包布局（141 / cancon 实测，两台机器 public 路径一致）：
#   qcsoft/g16-hy/scripts/env.sh      ← 原文 SCRIPTDIR=$HOME/g16-hy（无 workspace 层）
#   qcsoft/g16-hy/g16/g16             （G16ROOT = SCRIPTDIR/g16）
# 注：public env.sh 的 SCRIPTDIR 写什么值都不影响功能 —— 拷贝后脚本会强制把副本
#     env.sh 的 SCRIPTDIR 对齐到实际拷贝目标（见下方「env.sh 路径对齐」），自洽且抗回退。
# calcflow 直接运行 g16，不依赖 g16_run.sh。
#
# 用法（经 mat-command-executor 在集群执行，每集群每用户一次）：
#   bash <GAUSSIAN_CALC>/scripts/bootstrap_g16.sh
#
# 环境变量（可用集群 profile 注入）：
#   G16_SRC    拷贝源（公共只读路径）   默认 /public/software/apps/sag-tool/qcsoft/g16-hy
#   G16_HOME   用户家目录拷贝目标       默认 $HOME/workspace/g16-hy
# 幂等：已就绪则跳过拷贝，开销极小。
# =============================================================================
set -euo pipefail

G16_SRC="${G16_SRC:-/public/software/apps/sag-tool/qcsoft/g16-hy}"
G16_HOME="${G16_HOME:-$HOME/workspace/g16-hy}"

ENV_SH="$G16_HOME/scripts/env.sh"
G16_BIN="$G16_HOME/g16/g16"

log()  { echo "[g16-bootstrap] $*"; }
fail() { echo "[g16-bootstrap] 错误: $*" >&2; exit 1; }

# 功能性自检：source env.sh 后 g16 真的可用（比"文件存在"可靠）
self_check() {
  [ -f "$ENV_SH" ] || return 1
  [ -x "$G16_BIN" ] || return 1
  # 子 shell 内 source，不污染当前环境
  ( . "$ENV_SH" >/dev/null 2>&1 && command -v g16 >/dev/null 2>&1 ) || return 1
  return 0
}

# -----------------------------------------------------------------------------
# 1. 先看是否已就绪
# -----------------------------------------------------------------------------
if self_check; then
  log "g16-hy 已就绪于 $G16_HOME，自检通过，跳过拷贝。"
  log "  → source $ENV_SH 即可加载 g16。"
  exit 0
fi

# -----------------------------------------------------------------------------
# 2. 缺失 → 从公共路径拷贝（约 6.5G，一次性）
# -----------------------------------------------------------------------------
[ -d "$G16_SRC" ] || fail "拷贝源不存在: $G16_SRC（检查 G16_SRC 环境变量或脚本默认值）"

log "自检未通过，开始从 $G16_SRC 拷贝到 $G16_HOME（约 6.5G，请耐心等待）..."
# 幂等：先清掉残缺的旧目标，避免半拷贝
rm -rf "$G16_HOME"
mkdir -p "$(dirname "$G16_HOME")"
command cp -a "$G16_SRC" "$G16_HOME"
mkdir -p "$G16_HOME/g16/scratch"

# ── 权限合规收紧（Gaussian 硬性要求，必须做）──────────────────────────────
# Gaussian 启动会自检安装目录：任何文件对 others 可读即报
#   "Files in the Gaussian directory are world accessible. This must be fixed." 并退出。
# 公共包为让任意用户可读（作复制源）常是 world-readable（o+rX），cp -a 会把这套
# 755/644 权限原样继承到副本 → 副本里跑 g16 必触发 world accessible。
# 解法：副本整体清空 others 权限位（目录→750，文件→640/750），满足 "≤750 / not
# world accessible"。同时 chown 归属当前用户（cp -a 可能保留源的 uid，跨用户读取
# 后需归属本用户才能自由改权限/运行）。
chown -R "$(id -u):$(id -g)" "$G16_HOME" 2>/dev/null || true
chmod -R o-rwx "$G16_HOME"
log "拷贝完成，副本 others 权限已收紧（满足 Gaussian ≤750 自检）。"

# ── env.sh 路径对齐（关键：解耦对 public env.sh 版本/路径的依赖）──────────────────
# public scripts/env.sh 历史首行是 SCRIPTDIR=$HOME/g16-hy（无 workspace 层），与拷贝
# 目标 $HOME/workspace/g16-hy 不一致；即便管理员把 public 改成 $HOME/workspace/g16-hy，
# 与本用户展开后的实际 $HOME 也未必字面相等。拷贝后一律把副本 env.sh 的 SCRIPTDIR
# 强制写成展开后的 G16_HOME，保证 source 后 G16ROOT 精确指向本副本的 g16/。
# 无论 public env.sh 写成什么、或日后被外部回退，都不影响本副本可用。
sed -i "s|^SCRIPTDIR=.*|SCRIPTDIR=$G16_HOME|" "$ENV_SH"
# nounset 加固：public env.sh 的 LD_LIBRARY_PATH 行不带 :- 默认值，在 set -u 的
# 调用方（环境门禁、slurm.sh 均为 set -euo pipefail）里 sourcing 会 unbound 中断，
# 导致 g16 进不了 PATH。副本一律改写为 nounset-safe 形式。
sed -i "s|^export LD_LIBRARY_PATH=.*|export LD_LIBRARY_PATH=\${G16ROOT}:\${LD_LIBRARY_PATH:-}|" "$ENV_SH"
log "已对齐 env.sh：SCRIPTDIR → $G16_HOME，LD_LIBRARY_PATH 已 nounset 加固"

# -----------------------------------------------------------------------------
# 3. 复检
# -----------------------------------------------------------------------------
if self_check; then
  log "完成。g16 已就绪于 $G16_HOME，自检通过。"
  log "  → source $ENV_SH 加载环境后，直接使用 g16 < input > output。"
  exit 0
else
  fail "拷贝后 g16 仍不可用。请检查 $G16_HOME/g16/g16 是否存在且可执行。"
fi
