import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MatClient } from 'mat-core'
import type { TaskPackage } from 'mat-core'

import { apply, resetMatDbForTests } from '../src/index'

/**
 * R4 工具面接线：
 * ① mat_task_build ready 后按 digest 落盘编译产物（幂等）；
 * ② mat_sbatch wave_gate——前波虚频=0 时 GATE_FAILED 且 sbatch 零发出；
 * ③ 前波过门时正常提交；④ digest 未知/首波放行。
 */

const TS_IRC_XYZ = '6\n\nC 0.0 0.0 0.0\nH 1.079 0.0 0.0\nH -0.539 0.934 0.0\nH -0.539 -0.934 0.0\nF 2.2 0.0 0.0\nCl 3.8 0.0 0.0\n'

interface RegisteredTool {
  name: string
  execute: (args: Record<string, unknown>, exec: { agent?: { id: string } }) => Promise<string>
}

function makeCtx() {
  const tools = new Map<string, RegisteredTool>()
  const ctx = {
    on: () => () => {},
    systemPrompt: { section: (_s: unknown) => {} },
    tools: { register: (t: RegisteredTool) => { tools.set(t.name, t) } },
    get: (_key: string) => undefined,
    provide: (_n: string, _v: unknown) => () => {},
  } as never
  return { ctx, tools }
}

function tsIrcGoal(): Record<string, unknown> {
  return {
    schema_version: 'aimater.goal.v1',
    structure: { label: 'sn2-ts-run1', xyz: TS_IRC_XYZ, source: 'user-upload' },
    intent: { want: ['ts', 'irc'] },
    charge: -1,
    resources: { partition: 'Agent0' },
  }
}

function fakePkg(digest: string): TaskPackage {
  return {
    schema_version: 'aimater.taskpackage.v1',
    engine: 'gaussian',
    status: 'ready',
    task: 'tsxtb+ts+irc',
    waves: [
      { id: 1, task: 'tsxtb', dependsOn: [], gate: null, preJson: {}, runJson: {}, postJson: {}, reusable: false },
      { id: 2, task: 'ts', dependsOn: [1], gate: { converged: true, imaginary_frequency_count: 1 }, preJson: {}, runJson: {}, postJson: {}, reusable: false },
      { id: 3, task: 'irc', dependsOn: [2], gate: null, preJson: {}, runJson: {}, postJson: {}, reusable: false },
    ],
    questions: [],
    assumptions: [],
    estimatedCoreHours: 18,
    digest,
    execution: { mode: 'stepwise', instructions: [] },
  }
}

describe('mat_task_build 编译产物落盘（R4①）', () => {
  let testRoot: string
  beforeEach(async () => {
    testRoot = await mkdtemp('/tmp/mat-wave-gate-build-')
    vi.stubEnv('MAT_FILE_ROOT', testRoot)
    // 环境门禁与本用例正交（本文件测的是别的闸）——整闸关闭，免得每例先跑一遍门禁
    vi.stubEnv('MAT_ENV_GATE', 'off')
    resetMatDbForTests()
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    resetMatDbForTests()
    await rm(testRoot, { recursive: true, force: true })
  })

  it('ready 后 task-packages/<digest>.json 存在且可回读', async () => {
    vi.spyOn(MatClient.prototype, 'execCommand').mockImplementation(async () => {
      throw new Error('mat_task_build must not touch the cluster')
    })
    const { ctx, tools } = makeCtx()
    apply(ctx)
    const out = await tools.get('mat_task_build')!.execute({ goal_json: tsIrcGoal() }, {} as never)
    expect(out).toContain('TASK_PACKAGE_READY')
    const m = out.match(/digest\s*[:=]\s*([0-9a-f]{64})/)
    expect(m).not.toBeNull()
    const path = join(testRoot, 'task-packages', `${m![1]}.json`)
    expect(existsSync(path)).toBe(true)
    const persisted = JSON.parse(await readFile(path, 'utf8')) as TaskPackage
    expect(persisted.task).toBe('tsxtb+ts+irc')
    expect(persisted.waves.map((w) => w.task)).toEqual(['tsxtb', 'ts', 'irc'])
    // R7b/R8b：ts 波门带最小真实频率下限，irc 波门带方向检查
    expect(persisted.waves[1]!.gate).toEqual({ converged: true, imaginary_frequency_count: 1, min_real_frequency_cm1: 10 })
    expect(persisted.waves[2]!.gate).toEqual({ converged: true, irc_direction_check: true })
  })
})

describe('mat_sbatch wave_gate 接线（R4②③④）', () => {
  let testRoot: string
  beforeEach(async () => {
    testRoot = await mkdtemp('/tmp/mat-wave-gate-sbatch-')
    vi.stubEnv('MAT_FILE_ROOT', testRoot)
    // 环境门禁与本用例正交（本文件测的是别的闸）——整闸关闭，免得每例先跑一遍门禁
    vi.stubEnv('MAT_ENV_GATE', 'off')
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    await rm(testRoot, { recursive: true, force: true })
  })

  const DIGEST = 'a'.repeat(64)

  async function seedPkg(digest = DIGEST): Promise<void> {
    const dir = join(testRoot, 'task-packages')
    const { mkdir } = await import('node:fs/promises')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, `${digest}.json`), JSON.stringify(fakePkg(digest)))
  }

  it('前波虚频=0：GATE_FAILED，sbatch 命令零发出（仅 cat 只读）', async () => {
    await seedPkg()
    const { ctx, tools } = makeCtx()
    apply(ctx)
    const commands: string[] = []
    vi.spyOn(MatClient.prototype, 'execCommand').mockImplementation(async (_c, command) => {
      commands.push(command)
      if (command.includes('cat ')) {
        return {
          code: 0,
          data: JSON.stringify({
            properties: { 'tsxtb.energy': -76.4, 'ts.converged': true, 'ts.imaginary_frequency_count': 0 },
          }),
          message: '',
        }
      }
      throw new Error(`must not submit in this test: ${command.slice(0, 60)}`)
    })
    await expect(tools.get('mat_sbatch')!.execute({
      cluster_id: '11250',
      workdir: '/home/u/w/tsxtb+ts+irc/03-irc',
      filename: 'slurm.sh',
      wave_gate: { pkg_digest: DIGEST, wave_id: 3 },
    }, {} as never)).rejects.toThrow(/GATE_FAILED: wave 2 \(ts\) imaginary_frequency_count=0/)
    expect(commands.every((c) => c.startsWith('cat '))).toBe(true)
  })

  it('前波过门：cat 后正常 sbatch', async () => {
    await seedPkg()
    const { ctx, tools } = makeCtx()
    apply(ctx)
    const commands: string[] = []
    vi.spyOn(MatClient.prototype, 'execCommand').mockImplementation(async (_c, command) => {
      commands.push(command)
      if (command.includes('cat ')) {
        return {
          code: 0,
          data: JSON.stringify({
            properties: { 'tsxtb.energy': -76.4, 'ts.converged': true, 'ts.imaginary_frequency_count': 1 },
          }),
          message: '',
        }
      }
      return { code: 0, data: 'Submitted batch job 1210077', message: '' }
    })
    const out = await tools.get('mat_sbatch')!.execute({
      cluster_id: '11250',
      workdir: '/home/u/w/tsxtb+ts+irc/03-irc',
      filename: 'slurm.sh',
      wave_gate: { pkg_digest: DIGEST, wave_id: 3 },
    }, {} as never)
    expect(out).toContain('1210077')
    expect(commands.some((c) => c.includes('sbatch'))).toBe(true)
  })

  it('首波（wave_id=1）无前置门：不读 result 直接提交', async () => {
    await seedPkg()
    const { ctx, tools } = makeCtx()
    apply(ctx)
    const commands: string[] = []
    vi.spyOn(MatClient.prototype, 'execCommand').mockImplementation(async (_c, command) => {
      commands.push(command)
      return { code: 0, data: 'Submitted batch job 5', message: '' }
    })
    const out = await tools.get('mat_sbatch')!.execute({
      cluster_id: '11250',
      workdir: '/home/u/w/tsxtb+ts+irc/01-tsxtb',
      filename: 'slurm.sh',
      wave_gate: { pkg_digest: DIGEST, wave_id: 1 },
    }, {} as never)
    expect(out).toContain('submitted batch job 5')
    expect(commands.every((c) => !c.includes('cat '))).toBe(true)
  })

  it('digest 未知：GATE_FAILED 并提示重建', async () => {
    const { ctx, tools } = makeCtx()
    apply(ctx)
    vi.spyOn(MatClient.prototype, 'execCommand').mockImplementation(async () => {
      throw new Error('must not touch cluster')
    })
    await expect(tools.get('mat_sbatch')!.execute({
      cluster_id: '11250',
      workdir: '/home/u/w/tsxtb+ts+irc/02-ts',
      filename: 'slurm.sh',
      wave_gate: { pkg_digest: 'b'.repeat(64), wave_id: 2 },
    }, {} as never)).rejects.toThrow(/GATE_FAILED: cannot load task package/)
  })
})
