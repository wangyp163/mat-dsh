# vasp-calc 作业脚本参考件（只读参考）。
#
# ⚠ 真源在 packages/mat-core/src/vasp.ts 的 renderVaspSlurmScript——本文件是
# 渲染结果的镜像快照，仅供人工审阅；分步 fallback 路径（mat_exec 手动驱动）
# 可以直接抄本模板改占位符。
#
# 占位符：<TASKS>=分号任务链（如 relax;scf;band）、<PRESET>、<MODE>、
# <PARTITION>、<TIME>、<NTASKS>（默认 1 节点 × 32 核）。
# 关键不可删项：source /etc/profile（module 体系依赖）；vasp_env 先于 workflow_env
# （vasp-hy env.sh 自带 mpi/* 卸载循环，处理作业环境预载 mpi/hpcx 与 intelmpi 的
# 冲突）；CALCULATOR_VASP_COMMAND（引擎的 VASP 启动覆盖点，np 跟 ntasks）；
# cd "$SLURM_SUBMIT_DIR" 在 matstream 前。

#!/bin/bash
#SBATCH -J ms-<TASKS>
#SBATCH -N 1
#SBATCH --ntasks-per-node=<NTASKS>
#SBATCH -p <PARTITION>
#SBATCH --time=<TIME>
#SBATCH --output=ms-job.out
source /etc/profile
ulimit -l unlimited
source $HOME/workspace/vasp-hy/scripts/env.sh
source $HOME/workspace/matstream/env.sh
export CALCULATOR_VASP_COMMAND='srun --mpi=pmi2 vasp_std'
cd "$SLURM_SUBMIT_DIR"
matstream run -c vasp -t '<TASKS>' -f POSCAR -p <PRESET> -m <MODE>
