/**
 * probe-vasp-matstream —— VASP/matstream 家目录部署的只读探针（probe-before-wiring）。
 *
 * 用法：
 *   set -a; source env.local; set +a; tsx scripts/probe-vasp-matstream.ts [cluster_id]
 *   tsx scripts/probe-vasp-matstream.ts [cluster_id] --smoke  # 提交 1 个 2 分钟作业验证环境链（集群副作用，显式选入）
 *
 * 2026-09-24 起运行时为家目录双件套（对齐 gaussian 模型；apptainer sif 已退役）：
 *   P1 workflow 件：$HOME/workspace/matstream（env.sh / bin/python / VERSION / import 版本）
 *   P2 VASP 件：$HOME/workspace/vasp-hy（vasp_std / env.sh 锚 / VERSION）
 *   P3 sbatch/srun/sinfo 分区在场（kshcnormal）
 *   P4 公共区部署源在场（基座 + VASP 源，供重建）
 *   --smoke：2 分钟作业内双 source + matstream pre（秒级）+ vasp_std/srun 在场——
 *   不烧真实计算；真实链路验证见 docs/evidence/vasp-port/（作业 122895612）。
 */

import { MatClient, outputText } from '../packages/mat-core/src/index.js'

const MATSTREAM = '$HOME/workspace/matstream'
const VASP_HY = '$HOME/workspace/vasp-hy'
const BASE_SRC = '/public/software/apps/sag-tool/qcsoft/gaussian-workflow/v1.0.0'
const VASP_SRC = '/public/software/apps/sag-tool/vasp/5.4.4-ioptcell_intelmpi2017_hdf5_libxc'

const clusterId = process.argv[2] && !process.argv[2].startsWith('-') ? process.argv[2] : '11250'
const smoke = process.argv.includes('--smoke')

if (!(process.env.MAT_MCP_KEY ?? '').startsWith('sk-')) {
  console.error('MAT_MCP_KEY missing/not sk- prefixed — source env.local first')
  process.exit(1)
}

const client = new MatClient({
  mcpKey: process.env.MAT_MCP_KEY ?? '',
  baseUrl: process.env.MAT_MCP_BASE_URL || undefined,
})

async function run(label: string, command: string, timeout = 60): Promise<string> {
  try {
    const r = await client.execCommand(clusterId, command, timeout)
    const text = outputText(r).trim()
    console.log(`[${label}] rc=${r.code}\n${text}\n`)
    return text
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.log(`[${label}] ERROR: ${message}\n`)
    return ''
  }
}

console.log(`=== probe-vasp-matstream @ cluster ${clusterId} (home doublet; smoke=${smoke}) ===\n`)

await run('P0-host', 'hostname && whoami && date -u +%Y-%m-%dT%H:%M:%SZ')

const p1 = await run('P1-workflow', [
  `[ -f ${MATSTREAM}/env.sh ] && echo ENV_OK || echo ENV_MISSING`,
  `[ -x ${MATSTREAM}/bin/python ] && echo PYTHON_OK || echo PYTHON_MISSING`,
  `cat ${MATSTREAM}/VERSION 2>/dev/null`,
  `${MATSTREAM}/bin/python -c 'import matstream, spglib, xmltodict, ase, numpy; print("imports:", matstream.__version__, spglib.__version__, ase.__version__, numpy.__version__)' 2>&1 | tail -1`,
].join('\n'))

await run('P2-vasp', [
  `[ -x ${VASP_HY}/app/bin/vasp_std ] && echo VASP_STD_OK || echo VASP_STD_MISSING`,
  `cat ${VASP_HY}/VERSION 2>/dev/null`,
  `grep -m1 '^SCRIPTDIR=' ${VASP_HY}/scripts/env.sh 2>/dev/null`,
].join('\n'))

await run('P3-slurm', 'command -v sbatch srun sacct; sinfo -o "%P %a %l" -h 2>/dev/null | head -3')

await run('P4-sources', `[ -d ${BASE_SRC} ] && echo BASE_SRC_OK; [ -d ${VASP_SRC} ] && echo VASP_SRC_OK; [ -x ${VASP_SRC}/app/bin/vasp_std ] && echo VASP_SRC_STD_OK`)

if (p1.includes('ENV_MISSING') || p1 === '') {
  console.log('workflow doublet missing — follow the deploy SOP in skills/vasp-calc/SKILL.md (base copy + wheel install), then re-probe.')
  process.exit(1)
}

if (!smoke) {
  console.log('read-only probes done. Re-run with --smoke to submit a 2-minute in-job environment check (cluster side effect).')
  process.exit(0)
}

const smokeDir = `$HOME/workspace/vasp-probe-${Date.now()}`
const submitOut = await run('smoke-sbatch', [
  `mkdir -p ${smokeDir} && cd ${smokeDir}`,
  `printf 'Si diamond\\n1.0\\n 5.43 0 0\\n 0 5.43 0\\n 0 0 5.43\\nSi\\n8\\ndirect\\n 0 0 0\\n .25 .25 .25\\n .5 .5 0\\n .75 .75 .25\\n .5 0 .5\\n .75 .25 .75\\n 0 .5 .5\\n .25 .75 .75\\n' > POSCAR`,
  `cat > slurm.sh << 'EOF'`,
  '#!/bin/bash',
  '#SBATCH -J vasp-probe',
  '#SBATCH -N 1',
  '#SBATCH --ntasks-per-node=1',
  '#SBATCH -p kshcnormal',
  '#SBATCH --time=00:02:00',
  '#SBATCH --output=probe.out',
  'source /etc/profile',
  'ulimit -l unlimited',
  `source ${VASP_HY}/scripts/env.sh`,
  `source ${MATSTREAM}/env.sh`,
  "export CALCULATOR_VASP_COMMAND='srun --mpi=pmi2 vasp_std'",
  'cd "$SLURM_SUBMIT_DIR"',
  'echo "node: $(hostname)"',
  'command -v vasp_std srun matstream',
  'matstream pre -c vasp -t relax -f POSCAR -p veryfast -m nospin >/dev/null 2>&1 && echo PRE_OK || echo PRE_FAIL',
  'echo SMOKE_DONE',
  'EOF',
  'sbatch slurm.sh',
].join('\n'), 60)

const jobId = submitOut.match(/Submitted batch job (\d+)/)?.[1]
if (jobId === undefined) {
  console.error('smoke sbatch failed — no job id parsed')
  process.exit(1)
}
console.log(`smoke job ${jobId} submitted (${smokeDir}); polling up to 8 min...`)

const deadline = Date.now() + 8 * 60_000
let settled = false
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 30_000))
  const q = await run('smoke-sacct', `sacct -j ${jobId} -P -n -o State,ExitCode,Elapsed | head -1`, 30)
  const state = q.trim()
  if (state !== '' && !state.includes('RUNNING') && !state.includes('PENDING') && !state.includes('COMPLETING')) {
    settled = true
    console.log(`terminal: ${state}`)
    break
  }
}

const out = await run('smoke-out', `tail -n 15 ${smokeDir}/probe.out 2>/dev/null || echo NO_OUTPUT`)
console.log(settled && out.includes('SMOKE_DONE') && out.includes('PRE_OK') ? 'SMOKE PASS' : 'SMOKE INCOMPLETE — inspect probe.out above')
