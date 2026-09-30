#!/usr/bin/env bash
# 环境常量表：本 skill 的唯一整文件级环境差异点。check_environment.sh 与
# SKILL.md 的 env-specific fenced 块均读取本文件；改键需双侧同步。
#
# 2026-09-24 起运行时为家目录自部署双件套（对齐 gaussian 的 demo+g16-hy 模型，
# 此前短暂使用公共区 apptainer sif——已退役）：
#   $HOME/workspace/matstream   conda-pack py3.11 + matstream wheel（VERSION 自锚）
#   $HOME/workspace/vasp-hy     公共区 5.4.4-iOptCell 拷贝（SCRIPTDIR 重写）

ENV_NAME=home
WORKFLOW_ROOT_DEFAULT="$HOME/workspace/matstream"
WORKFLOW_VERSION="0.1.3"
VASP_HOME_DEFAULT="$HOME/workspace/vasp-hy"
VASP_VERSION_ANCHOR="5.4.4-ioptcell-intelmpi2017-hdf5-libxc"
