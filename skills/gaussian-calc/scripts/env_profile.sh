#!/usr/bin/env bash
# 环境常量表：本 skill 的唯一整文件级环境差异点（另一处是 SKILL.md 的
# env-specific fenced 块）。check_environment.sh、tests/test_check_environment.sh、
# check_skill_contract.py 均读取本文件。键集两环境必须相同；改键需双侧同步。
# 注：值里的 $HOME 等变量在 source 时展开（双引号），Python 侧只解析 ENV_NAME 行。

ENV_NAME=demo
WORKFLOW_ROOT_DEFAULT="$HOME/workspace/demo"
WORKFLOW_VERSION="1.7.2"
PYTHON_BIN_SUBDIR="bin"
