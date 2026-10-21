#!/bin/bash
# mater-agents-smoke env_profile — 141 mater_agents 树常量（skill 内已内联，此文件供脚本复用）
# Literal assignments only（对齐 gaussian-calc env_profile 惯例）。

ENV_NAME="141-mater-agents"
CLUSTER_ID="200108"                                   # mat remote-shell MCP 集群号（cluster_node141）
CLUSTER_USER="helei01948"
MA_ROOT="/public/software/apps/mater_agents"
WORKDIR="$HOME/workspace/mater_agents_smoke"
SMOKE_SRC="/public/software/apps/sag-tool/_smoketest"  # 只读输入源
GATE_SCRIPT="$MA_ROOT/tests/run_all.sh"               # --quick 用户态门禁（~90s）
RENDER="$MA_ROOT/bin/ma-render"
LIST="$MA_ROOT/bin/ma-list"
USE="$MA_ROOT/bin/ma-use"
MCP_TIMEOUT_MAX=180                                    # remote_shell_execute 硬上限（实测）

# 软件条目（ma-list 可再查全量）
VASP_ENTRY="$MA_ROOT/software/vasp/5.4.4/cpu-intelmpi2017-optcell"
ABACUS_ENTRY="$MA_ROOT/software/abacus/3.9.0.2/cpu-openmpi"
QE_ENTRY="$MA_ROOT/software/quantum-espresso/7.0/cpu-intel2021"
CP2K_ENTRY="$MA_ROOT/software/cp2k/2024.2/cpu-intelmpi2021"   # 或 2026.1/cpu-oneapi2024
ORCA_ENTRY="$MA_ROOT/software/orca/6.1.0/cpu-openmpi415"
GAUSSIAN_ENTRY="$MA_ROOT/software/gaussian/16/cpu-serial"
LAMMPS_ENTRY="$MA_ROOT/software/lammps/5Nov16/cpu-intelmpi2017"
