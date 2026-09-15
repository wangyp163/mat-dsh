#!/bin/bash
# =============================================================================
# abacus_pyatb_slurm.sh — ABACUS pyatb 后处理提交脚本模板
# -----------------------------------------------------------------------------
# 给 11 个 pyatb post 任务用（jdos/shg/shift/bc/bcd/ahc/anc/wl/chern/surface_states/hseband）：
# 这些任务的 post 内部经 pyatb 做拓扑/光学性质计算，计算量大，不在登录节点跑，提交到计算节点。
# pyatb 是 OpenBLAS 的 OpenMP 线程并行（OMP_NUM_THREADS 生效），故用 cpus-per-task 而非 ntasks。
# post 命令 `abacus-workflow -p post` 内部会自动 cd 到 ./<task>/pyatb 并以 OMP_NUM_THREADS=32 跑 pyatb。
# 前置：同一 WORKDIR 下对应任务的 abacus SCF 作业（第一个 slurm 作业）已跑完，产出 OUT.ABACUS 电荷/矩阵。
# 占位符 <JOBNAME>、<PARTITION>、<INPUT>、<TASK>，提交前用 sed 替换：
#   sed -e 's/<JOBNAME>/<name>/g' -e 's/<PARTITION>/<partition>/g' \
#       -e 's/<INPUT>/<input_file>/g' -e 's/<TASK>/<task>/g' \
#       abacus_pyatb_slurm.sh > <task>/slurm.sh
# =============================================================================
#SBATCH -J abacus-pyatb-<JOBNAME>
#SBATCH -N 1
#SBATCH --ntasks=1
#SBATCH --cpus-per-task=32
#SBATCH -p <PARTITION>
#SBATCH --output=abacus-pyatb-<JOBNAME>.out

source /public/software/apps/sag-tool/matsoft/abacus/v3.9.0.2/env.sh
export OMP_NUM_THREADS=32
ulimit -l unlimited
cd "$SLURM_SUBMIT_DIR"
abacus-workflow -i <INPUT> -t <TASK> -p post
