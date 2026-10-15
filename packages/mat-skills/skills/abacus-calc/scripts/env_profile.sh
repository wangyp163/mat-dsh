#!/usr/bin/env bash
# 环境常量表：本 skill 的唯一整文件级环境差异点（另一处是 SKILL.md 的
# env-specific fenced 块）。check_environment.sh 读取本文件。
# 键集与 gaussian-calc 的 env_profile.sh 相同（abacus-env-gate.v1 亦然）。
# 注：值里的 $HOME 等变量在 source 时展开（双引号），Python 侧只解析 ENV_NAME 行。

ENV_NAME=demo
WORKFLOW_ROOT_DEFAULT="$HOME/workspace/demo-abacus"
WORKFLOW_VERSION="0.2.1"
PYTHON_BIN_SUBDIR="bin"
