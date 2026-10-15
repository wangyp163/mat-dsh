#!/bin/bash
# Gaussian 16 Slurm template for calcflow gaussian-workflow.
# Replace all angle-bracket placeholders before submission.
# The script is intended to run from the task work directory.
# Gaussian parallelism is controlled by %nprocshared in the input file.
#SBATCH -J <JOBNAME>
#SBATCH -N 1
#SBATCH --ntasks-per-node=<NCORES>
#SBATCH -p <PARTITION>
#SBATCH --output=<JOBNAME>.slurm.out
#SBATCH --error=<JOBNAME>.slurm.err

set -euo pipefail

source "$HOME/workspace/g16-hy/scripts/env.sh"

INPUT_FILE="<INPUT_FILE>"
OUTPUT_FILE="<OUTPUT_FILE>"

command -v g16 >/dev/null 2>&1 || {
  echo "g16 is not available; source the user Gaussian env.sh" >&2
  exit 1
}

# calcflow's GaussianCalculator uses this same direct execution model.
g16 < "$INPUT_FILE" > "$OUTPUT_FILE"

grep -q "Normal termination of Gaussian" "$OUTPUT_FILE" || {
  echo "Gaussian did not terminate normally: $OUTPUT_FILE" >&2
  exit 1
}
