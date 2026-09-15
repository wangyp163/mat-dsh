#!/bin/bash
# =============================================================================
# abacus_slurm.sh — ABACUS HPC 提交脚本模板
# -----------------------------------------------------------------------------
# 分区（partition）不写死：提交前先 mat-job-manager queues 查询可用 partition，用户选定后 sed 注入 <PARTITION>。
# 占位符 <JOBNAME>（作业名）、<PARTITION>（SLURM 分区，勿写死），提交前用 sed 替换：
#   sed -e 's/<JOBNAME>/<name>/g' -e 's/<PARTITION>/<partition>/g' abacus_slurm.sh > <task>/slurm.sh
# ABACUS env.sh 是自包含完整环境（Python + abacus 二进制 + 赝势/基组），无需另 conda。
# env.sh 设的 OMP_NUM_THREADS 过大（32 MPI × N OMP > 56 核 → ABACUS 报错），覆盖为 1。
# 脚本随各任务子目录（relax/、scf/…）提交，cwd 即任务目录，abacus 从中读 INPUT/STRU/KPT。
# =============================================================================
#SBATCH -J abacus-<JOBNAME>
#SBATCH -N 1
#SBATCH --ntasks-per-node=32
#SBATCH -p <PARTITION>
#SBATCH --output=abacus-<JOBNAME>.out

source /public/software/apps/sag-tool/matsoft/abacus/v3.9.0.2/env.sh

ulimit -l unlimited
export I_MPI_FABRICS=shm:tcp
export OMP_NUM_THREADS=1

cd "$SLURM_SUBMIT_DIR"
mpirun -np 32 abacus > abacus.out 2>&1
