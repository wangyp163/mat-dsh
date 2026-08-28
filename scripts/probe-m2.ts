/**
 * M2 实弹探针（零模型 token）：MatClient 直连 11250，录制四薄工具原始输出
 * 与 gaussian 全阶段（prepare→pre→run→sbatch→watch→自动 post）真实输出。
 *
 * 产物：stdout 分节原始输出 —— 回填 test/contract/fixtures/（PROVENANCE.md 记录）
 * 与 docs/evidence/m2/。用法：
 *   set -a; source env.local; set +a
 *   MAT_TRANSPORT=fetch pnpm exec tsx scripts/probe-m2.ts
 */

import { MatClient, outputText } from '../packages/mat-core/src/index.js'
import {
  SINFO_COMMAND,
  parseSinfoOutput,
  parseSbatchSubmission,
  queryJobStatus,
  scancelCommand,
} from '../packages/mat-core/src/index.js'
import {
  DEFAULT_G16_ENV,
  DEFAULT_WORKFLOW_ENV,
  createGaussianProducerHooks,
  postPhaseCommand,
  prePhaseCommand,
  prepareInputsCommand,
  runPhaseCommand,
} from '../packages/mat-core/src/index.js'

const CLUSTER = process.env.MAT_CLUSTER ?? '11250'
const WORKDIR = process.env.MAT_PROBE_WORKDIR ?? '$HOME/workspace/h2o-m2-probe'
const XYZ = '3\n\nO 0.000000 0.000000 0.117790\nH 0.000000 0.757160 -0.470790\nH 0.000000 -0.757160 -0.470790\n'

const section = (name: string) => console.log(`\n===== ${name} =====`)

async function main() {
  const client = new MatClient({
    mcpKey: process.env.MAT_MCP_KEY ?? '',
    baseUrl: process.env.MAT_MCP_BASE_URL || undefined,
    ...(process.env.MAT_TRANSPORT === 'fetch' ? { transportKind: 'fetch' as const } : {}),
  })
  const exec = (command: string, timeoutSeconds = 30) => client.execCommand(CLUSTER, command, timeoutSeconds)
  const show = async (name: string, command: string, timeoutSeconds = 30) => {
    section(name)
    const r = await exec(command, timeoutSeconds)
    console.log(`$ ${command}`)
    console.log(JSON.stringify(r))
    return outputText(r)
  }

  // ① 四薄工具原始格式
  const sinfoOut = await show('sinfo 5col（fixture 回填用）', SINFO_COMMAND)
  console.log('parseSinfoOutput:', JSON.stringify(parseSinfoOutput(sinfoOut)))

  const sbatchOut = await show('sbatch sleep 30（薄工具语义）',
    `cd /tmp && sbatch -p Agent0 --wrap='sleep 30' -J m2-probe`)
  const sleepJobId = parseSbatchSubmission(sbatchOut)
  await show('job_status（squeue 路径/空→sacct 兜底）', `squeue -j ${sleepJobId} -h -o '%T' 2>/dev/null | head -1`)
  const state1 = await queryJobStatus((c: string, cmd: string, t?: number) => client.execCommand(c, cmd, t), CLUSTER, sleepJobId)
  section('queryJobStatus 归一')
  console.log(`job ${sleepJobId} -> ${JSON.stringify(state1)}`)
  await show('scancel', scancelCommand(sleepJobId))
  const state2 = await queryJobStatus((c: string, cmd: string, t?: number) => client.execCommand(c, cmd, t), CLUSTER, sleepJobId)
  section('queryJobStatus（scancel 后）')
  console.log(`job ${sleepJobId} -> ${JSON.stringify(state2)}`)

  // ② gaussian 全阶段（一站式 mat_gaussian 的内核链路），原始输出全录
  const preJson = {
    schema_version: 'gaussian_workflow.pre.v1',
    resources: { ncores: 32, memory: '64GB' },
    generator: { dialect: 'ase' },
    ase: {
      calculator_kwargs: {
        method: 'B3LYP', basis: '6-31G(d)', charge: 0, mult: 1,
        opt: ['Tight', 'CalcFC'], freq: 'HPModes',
      },
    },
    output: { input_file: 'job.gjf' },
  }
  const runJson = { slurm: { partition: 'Agent0', nodes: 1, ntasks_per_node: 32, time: '00:30:00', mem: '64GB' } }

  section('gaussian prepare（单命令打包）')
  const prep = await exec(prepareInputsCommand(WORKDIR, XYZ, preJson, runJson), 60)
  console.log(`code=${prep.code}`)
  console.log(outputText(prep))

  section('gaussian pre')
  const pre = await exec(prePhaseCommand(WORKDIR, 'opt+freq', DEFAULT_WORKFLOW_ENV), 60)
  console.log(`code=${pre.code}`)
  console.log(outputText(pre))

  section('gaussian run')
  const run = await exec(runPhaseCommand(WORKDIR, 'opt+freq', DEFAULT_WORKFLOW_ENV, DEFAULT_G16_ENV), 60)
  console.log(`code=${run.code}`)
  console.log(outputText(run))

  section('gaussian sbatch（slurm.sh 于 workdir/task/）')
  const sb = await exec(`cd "${WORKDIR}/opt+freq" && sbatch slurm.sh`, 30)
  console.log(JSON.stringify(sb))
  const slurmJobId = parseSbatchSubmission(outputText(sb))
  console.log(`slurm job id = ${slurmJobId}`)

  // ③ producer：watch 至终态 → 自动 post（与 mat_gaussian 后台作业同内核）
  section('producer（watch → 终态自动 post）')
  const hooks = createGaussianProducerHooks({
    execCommand: (c: string, cmd: string, t?: number) => client.execCommand(c, cmd, t),
    clusterId: CLUSTER,
    task: 'opt+freq',
    workdir: WORKDIR,
    slurmJobId,
    maxWaitSeconds: 900,
  })
  const t0 = Date.now()
  const outcome = await hooks.done
  console.log(`outcome: ${JSON.stringify(outcome)} (elapsed ${Math.round((Date.now() - t0) / 1000)}s)`)
  console.log('--- job_output 终态首读 ---')
  console.log(hooks.readOutput())

  // ④ post 原始 stdout 独立重放一次（fixture 录制；幂等只读）
  section('post 原始输出（fixture 回填用）')
  const post = await exec(postPhaseCommand(WORKDIR, 'opt+freq', DEFAULT_WORKFLOW_ENV), 60)
  console.log(`code=${post.code}`)
  console.log(outputText(post))

  console.log('\nPROBE_DONE')
}

void main().catch((err) => {
  console.error('PROBE_FAILED:', err instanceof Error ? err.stack : String(err))
  process.exitCode = 1
})
