import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MatClient, createPortfolio, portfolioToJson, updateTask } from 'mat-core'

import { assertPhaseGate } from '../src/phase-gate.ts'
import { apply } from '../src/index'

/**
 * R2 相位闸：manifest 存在 pending 任务（Phase B 未收口）时，
 * 集群提交在任何远端调用之前被拒——PHASE_GATE_REJECTED、零集群副作用。
 */

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

async function writeManifest(root: string, prepared: boolean): Promise<string> {
  const p = createPortfolio({
    portfolioId: 'phase-gate-test',
    tasks: [
      { taskId: 'T1', system: 'CH3Cl+F-', kind: 'valid' },
      { taskId: 'T2', system: 'CH3F+Cl-', kind: 'valid' },
    ],
  })
  if (prepared) {
    updateTask(p, 'T1', { phase: 'prepared' })
    updateTask(p, 'T2', { phase: 'prepared' })
  }
  const file = `${root}/manifest.json`
  await writeFile(file, portfolioToJson(p))
  return file
}

describe('assertPhaseGate（单元）', () => {
  let root: string
  beforeEach(async () => {
    root = await mkdtemp('/tmp/mat-phase-gate-')
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('无 task_ref 不受闸', () => {
    expect(() => assertPhaseGate(undefined)).not.toThrow()
  })

  it('存在 pending 任务即拒，报数量与自涉任务', async () => {
    const file = await writeManifest(root, false)
    expect(() => assertPhaseGate({ portfolio_file: file, task_id: 'T1' }))
      .toThrow(/PHASE_GATE_REJECTED: manifest still in preparation \(2 pending, including T1 itself\)/)
  })

  it('全 prepared 放行（Phase B/C 边界）', async () => {
    const file = await writeManifest(root, true)
    expect(() => assertPhaseGate({ portfolio_file: file, task_id: 'T1' })).not.toThrow()
  })

  it('清单不可读时旁路（预算闸同参数兜底），仅在明确读到 pending 时拒绝', () => {
    expect(() => assertPhaseGate({ portfolio_file: `${root}/missing.json`, task_id: 'T1' })).not.toThrow()
  })
})

describe('mat_sbatch 相位闸接线（集成）', () => {
  let root: string
  beforeEach(async () => {
    root = await mkdtemp('/tmp/mat-phase-gate-sbatch-')
    vi.stubEnv('MAT_FILE_ROOT', root)
    // 环境门禁与本用例正交（本文件测的是别的闸）——整闸关闭，免得每例先跑一遍门禁
    vi.stubEnv('MAT_ENV_GATE', 'off')
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    await rm(root, { recursive: true, force: true })
  })

  it('pending 未清零：集群调用零发生，抛 PHASE_GATE_REJECTED', async () => {
    const { ctx, tools } = makeCtx()
    apply(ctx)
    const sbatch = tools.get('mat_sbatch')!
    const file = await writeManifest(root, false)
    const exec = vi.spyOn(MatClient.prototype, 'execCommand').mockImplementation(async () => {
      throw new Error('must not reach the cluster in Phase B')
    })
    await expect(sbatch.execute({
      cluster_id: '11250',
      workdir: '/home/u/w/tsxtb+ts+irc/01-tsxtb',
      filename: 'slurm.sh',
      task_ref: { portfolio_file: file, task_id: 'T1' },
    }, {} as never)).rejects.toThrow(/PHASE_GATE_REJECTED/)
    expect(exec).not.toHaveBeenCalled()
  })

  it('pending 清零（全 prepared）：正常提交', async () => {
    const { ctx, tools } = makeCtx()
    apply(ctx)
    const sbatch = tools.get('mat_sbatch')!
    const file = await writeManifest(root, true)
    const exec = vi.spyOn(MatClient.prototype, 'execCommand')
      .mockResolvedValue({ code: 0, data: 'Submitted batch job 1210042', message: '' } as never)
    const out = await sbatch.execute({
      cluster_id: '11250',
      workdir: '/home/u/w/tsxtb+ts+irc/01-tsxtb',
      filename: 'slurm.sh',
      task_ref: { portfolio_file: file, task_id: 'T1' },
    }, {} as never)
    expect(exec).toHaveBeenCalledTimes(1)
    expect(out).toContain('1210042')
  })
})
