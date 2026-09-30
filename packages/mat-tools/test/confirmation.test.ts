import { mkdtemp, rm } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { MatClient } from 'mat-core'
import { apply } from '../src/index'

/**
 * 确认闸接线测试（D0 P2 / D2.1）：三例铁律——
 * ① 不带 digest → CONFIRM_REQUIRED + 投影 + digest，且【零集群副作用】（exec 被调即炸）；
 * ② 带错 digest → 仍拒绝；
 * ③ 带对 digest（从拒绝消息提取）→ 走完整提交流程返回 slurm job id；
 * ④ 降级开关 confirmation_gate='off' → 免 digest 直接提交（应急回滚路径）。
 */

const XYZ = '3\n\nO 0.000000 0.000000 0.117790\nH 0.000000 0.757160 -0.470790\nH 0.000000 -0.757160 -0.470790\n'

interface RegisteredTool {
  name: string
  execute: (args: Record<string, unknown>) => Promise<string>
}

function makeCtx() {
  const tools = new Map<string, RegisteredTool>()
  // jobs 桩对齐 status-wiring：start() 内同步调 run()（producer hooks 仅注册不推进——fake timers 下零副作用）
  const jobs = {
    start(input: { kind: string; label: string; run: () => unknown }) {
      input.run()
      return `fake-${input.kind}`
    },
  }
  const ctx = {
    on: () => () => {},
    systemPrompt: { section: (_s: unknown) => {} },
    tools: { register: (t: RegisteredTool) => { tools.set(t.name, t) } },
    get: (key: string) => (key === 'jobs' ? jobs : undefined),
    provide: (_n: string, _v: unknown) => () => {},
  } as unknown as Context
  return { ctx, tools }
}

function stubSubmitScript(jobId: string): void {
  vi.spyOn(MatClient.prototype, 'execCommand').mockImplementation(async (_c, command) => {
    if (command.includes('PREP_READY') || command.includes('mkdir -p')) return { code: 0, data: 'PREP_READY\n', message: '' }
    if (command.includes('-p pre')) return { code: 0, data: '{"status": "ok", "phase": "pre"}\n', message: '' }
    if (command.includes('-p run')) return { code: 0, data: '{"status": "ok", "phase": "run"}\n', message: '' }
    if (command.includes('sbatch slurm.sh')) return { code: 0, data: `Submitted batch job ${jobId}\n`, message: '' }
    throw new Error(`unexpected command: ${command.slice(0, 90)}`)
  })
}

describe('mat_gaussian 确认闸（digest）', () => {
  let testRoot: string

  beforeEach(async () => {
    testRoot = await mkdtemp('/tmp/mat-confirm-')
    vi.stubEnv('MAT_FILE_ROOT', testRoot)
    // 环境门禁与本用例正交（本文件测的是别的闸）——整闸关闭，免得每例先跑一遍门禁
    vi.stubEnv('MAT_ENV_GATE', 'off')
    vi.useFakeTimers()
  })
  afterEach(async () => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    await rm(testRoot, { recursive: true, force: true })
  })

  const BASE = { cluster_id: '11250', task: 'opt', structure: XYZ, workdir: '/home/u/confirm' }

  it('① 无 digest → CONFIRM_REQUIRED + 投影 + digest，零集群副作用', async () => {
    const { ctx, tools } = makeCtx()
    apply(ctx)
    // 任何远程调用都视为违规：确认必须在副作用之前
    const exec = vi.spyOn(MatClient.prototype, 'execCommand')
      .mockImplementation(async (_c, command) => { throw new Error(`gate failed — cluster side effect: ${command.slice(0, 60)}`) })
    const out = await tools.get('mat_gaussian')!.execute({ ...BASE }, {})
    expect(out).toContain('CONFIRM_REQUIRED')
    expect(out).toContain('B3LYP / 6-31G(d) / 0 / 1')
    expect(out).toContain('partition=kshcnormal')
    expect(out).toMatch(/digest\s+:\s+[0-9a-f]{64}/)
    expect(exec).not.toHaveBeenCalled()
  })

  it('② 错 digest → 仍拒绝（投影重发）', async () => {
    const { ctx, tools } = makeCtx()
    apply(ctx)
    vi.spyOn(MatClient.prototype, 'execCommand')
      .mockImplementation(async (_c, command) => { throw new Error(`gate failed: ${command.slice(0, 60)}`) })
    const out = await tools.get('mat_gaussian')!.execute({ ...BASE, confirmed_digest: 'deadbeef' }, {})
    expect(out).toContain('CONFIRM_REQUIRED')
  })

  it('③ 对 digest（从拒绝消息提取）→ 完整提交，返回 slurm job id', async () => {
    const { ctx, tools } = makeCtx()
    apply(ctx)
    vi.spyOn(MatClient.prototype, 'execCommand')
      .mockImplementation(async (_c, command) => { throw new Error('should not reach cluster') })
    const rejected = await tools.get('mat_gaussian')!.execute({ ...BASE }, {})
    const digest = /digest\s+:\s+([0-9a-f]{64})/.exec(rejected)?.[1]
    expect(digest).toBeDefined()

    vi.restoreAllMocks()
    stubSubmitScript('900')
    const out = await tools.get('mat_gaussian')!.execute({ ...BASE, confirmed_digest: digest }, {})
    expect(out).toContain('slurm job 900')
  })

  it('④ confirmation_gate=off → 免 digest 直接提交（应急回滚路径）', async () => {
    const { ctx, tools } = makeCtx()
    apply(ctx)
    stubSubmitScript('901')
    const out = await tools.get('mat_gaussian')!.execute({ ...BASE, options: { confirmation_gate: 'off' } }, {})
    expect(out).toContain('slurm job 901')
  })

  it('⑤ 参数变化 → 旧 digest 失效（换 partition 即换摘要）', async () => {
    const { ctx, tools } = makeCtx()
    apply(ctx)
    vi.spyOn(MatClient.prototype, 'execCommand')
      .mockImplementation(async () => { throw new Error('should not reach cluster') })
    const rejected = await tools.get('mat_gaussian')!.execute({ ...BASE }, {})
    const staleDigest = /digest\s+:\s+([0-9a-f]{64})/.exec(rejected)?.[1]
    const out = await tools.get('mat_gaussian')!.execute({ ...BASE, partition: 'OtherQueue', confirmed_digest: staleDigest })
    expect(out).toContain('CONFIRM_REQUIRED')
    expect(out).toContain('partition=OtherQueue')
  })
})
