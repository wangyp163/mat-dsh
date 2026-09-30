import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MatClient, compileTaskPackage, isStepwiseTask } from 'mat-core'
import type { Goal, TaskPackage } from 'mat-core'

import { apply, resetMatDbForTests } from '../src/index'

/**
 * 通道闸（双向）：通道归属由编译器算，不由模型判断。
 *
 * 背景（2026-09-23 审查）：此前只有正向闸——pipeline 拒单波包并指路一站式；
 * 反向完全没有闸，`mat_gaussian(task='ts+irc')` 会一路跑到 sbatch 才失败，
 * 而 prepare/pre/run 三步都已产生远端副作用（文件落盘、各波 step 目录渲染），
 * 报错还是裸 sbatch 失败、不含「该用 pipeline」的指路。而这恰是更容易发生的
 * 方向（一站式门槛更低、prompt 里更显眼）。
 *
 * 两条断言贯穿本文件：
 *   ① 拒绝发生在任何集群调用之前（execCommand 被调即炸 + not.toHaveBeenCalled）；
 *   ② 错误码是 WRONG_CHANNEL 且消息指向正确通道。
 */

const WATER_XYZ = '3\n\nO 0.000000 0.000000 0.117790\nH 0.000000 0.757160 -0.470790\nH 0.000000 -0.757160 -0.470790\n'

interface RegisteredTool {
  name: string
  execute: (args: Record<string, unknown>, exec: { agent?: { id: string } }) => Promise<string>
}

function makeCtx() {
  const tools = new Map<string, RegisteredTool>()
  const jobs = {
    counter: 0,
    start(input: { kind: string; label: string; run: () => unknown }) {
      jobs.counter += 1
      input.run()
      return `job-${jobs.counter}`
    },
  }
  const ctx = {
    on: () => () => {},
    systemPrompt: { section: (_s: unknown) => {} },
    tools: { register: (t: RegisteredTool) => { tools.set(t.name, t) } },
    get: (key: string) => (key === 'jobs' ? jobs : undefined),
    provide: (_n: string, _v: unknown) => () => {},
  } as never
  return { ctx, tools }
}

function goalOf(want: string[], xyz: string): Goal {
  return {
    schema_version: 'aimater.goal.v1',
    structure: { label: 'chan-test', xyz, source: 'user-upload' },
    intent: { want },
    resources: { partition: 'Agent0' },
  }
}

function pkgOf(want: string[], xyz: string): TaskPackage {
  const r = compileTaskPackage(goalOf(want, xyz))
  expect(r.status).toBe('ready')
  return r.pkg!
}

describe('通道判据是编译器的结论（前提事实）', () => {
  it('单波 optimize→opt 编译为 one-stop；irc→tsxtb+ts+irc 编译为 stepwise', () => {
    expect(pkgOf(['optimize'], WATER_XYZ).execution.mode).toBe('one-stop')
    expect(pkgOf(['irc'], WATER_XYZ).execution.mode).toBe('stepwise')
  })

  it('isStepwiseTask 与 execution.mode 同源（两个闸判的是同一个判据）', () => {
    for (const [want, xyz] of [[['optimize'], WATER_XYZ], [['irc'], WATER_XYZ]] as const) {
      const pkg = pkgOf([...want], xyz)
      expect(isStepwiseTask(pkg.task)).toBe(pkg.execution.mode === 'stepwise')
    }
  })

  it('复合 DSL 字符串直接可判（不需要编译产物，故跳过 task_build 也拦得住）', () => {
    expect(isStepwiseTask('ts+irc')).toBe(true)
    expect(isStepwiseTask('tsxtb+ts+irc')).toBe(true)
    expect(isStepwiseTask('opt')).toBe(false)
    expect(isStepwiseTask('opt+freq')).toBe(false)
  })
})

describe('反向闸：mat_gaussian 拒绝 stepwise 链', () => {
  let root: string
  beforeEach(async () => {
    root = await mkdtemp('/tmp/mat-channel-gaussian-')
    vi.stubEnv('MAT_FILE_ROOT', root)
    vi.stubEnv('MAT_ENV_GATE', 'off')
    resetMatDbForTests()
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    await rm(root, { recursive: true, force: true })
  })

  function armExplodingExec() {
    return vi.spyOn(MatClient.prototype, 'execCommand').mockImplementation(async () => {
      throw new Error('must not reach the cluster on a wrong-channel call')
    })
  }

  it('ts+irc 走一站式：WRONG_CHANNEL，且 prepare/pre/run 零发出', async () => {
    const { ctx, tools } = makeCtx()
    apply(ctx)
    const exec = armExplodingExec()
    await expect(tools.get('mat_gaussian')!.execute({
      cluster_id: '11250',
      task: 'ts+irc',
      structure: WATER_XYZ,
      workdir: '/home/u/w/chain',
    }, {} as never)).rejects.toThrow(/WRONG_CHANNEL/)
    // 关键：远端一个字节都没写（此前会跑完 prepare+pre+run 才在 sbatch 失败）
    expect(exec).not.toHaveBeenCalled()
  })

  it('拒绝消息指路 pipeline（模型拿到码即知去哪）', async () => {
    const { ctx, tools } = makeCtx()
    apply(ctx)
    armExplodingExec()
    await expect(tools.get('mat_gaussian')!.execute({
      cluster_id: '11250',
      task: 'tsxtb+ts+irc',
      structure: WATER_XYZ,
      workdir: '/home/u/w/chain',
    }, {} as never)).rejects.toThrow(/mat_pipeline_start/)
  })

  it('通道闸先于确认闸——错通道不该先要用户签字', async () => {
    const { ctx, tools } = makeCtx()
    apply(ctx)
    armExplodingExec()
    // 不带 confirmed_digest 时正常会得到 CONFIRM_REQUIRED；错通道应先被拦
    await expect(tools.get('mat_gaussian')!.execute({
      cluster_id: '11250',
      task: 'ts+irc',
      structure: WATER_XYZ,
      workdir: '/home/u/w/chain',
    }, {} as never)).rejects.toThrow(/WRONG_CHANNEL/)
  })

  it('单波 opt 不受通道闸影响（正常走到确认闸）', async () => {
    const { ctx, tools } = makeCtx()
    apply(ctx)
    const exec = armExplodingExec()
    const out = await tools.get('mat_gaussian')!.execute({
      cluster_id: '11250',
      task: 'opt',
      structure: WATER_XYZ,
      workdir: '/home/u/w/h2o',
    }, {} as never)
    // 确认闸返回 CONFIRM_REQUIRED（零集群副作用），而不是通道拒绝
    expect(out).toContain('CONFIRM_REQUIRED')
    expect(out).not.toContain('WRONG_CHANNEL')
    expect(exec).not.toHaveBeenCalled()
  })

  it('opt+freq 是单波 one-stop，不被误拦', async () => {
    const { ctx, tools } = makeCtx()
    apply(ctx)
    armExplodingExec()
    const out = await tools.get('mat_gaussian')!.execute({
      cluster_id: '11250',
      task: 'opt+freq',
      structure: WATER_XYZ,
      workdir: '/home/u/w/h2o',
    }, {} as never)
    expect(out).not.toContain('WRONG_CHANNEL')
  })
})

describe('正向闸：pipeline / pool 拒绝 one-stop 包', () => {
  let root: string
  beforeEach(async () => {
    root = await mkdtemp('/tmp/mat-channel-pipeline-')
    vi.stubEnv('MAT_FILE_ROOT', root)
    vi.stubEnv('MAT_ENV_GATE', 'off')
    resetMatDbForTests()
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    await rm(root, { recursive: true, force: true })
  })

  async function seed(pkg: TaskPackage): Promise<string> {
    const dir = join(root, 'task-packages')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, `${pkg.digest}.json`), JSON.stringify(pkg))
    return pkg.digest
  }

  it('pipeline_start 收单波包：WRONG_CHANNEL 指路 mat_gaussian，零集群调用', async () => {
    const digest = await seed(pkgOf(['optimize'], WATER_XYZ))
    const { ctx, tools } = makeCtx()
    apply(ctx)
    const exec = vi.spyOn(MatClient.prototype, 'execCommand').mockImplementation(async () => {
      throw new Error('must not reach the cluster')
    })
    await expect(tools.get('mat_pipeline_start')!.execute({
      pkg_digest: digest,
      cluster_id: '11250',
      workdir: '/home/u/w/h2o',
    }, {} as never)).rejects.toThrow(/WRONG_CHANNEL.*mat_gaussian/s)
    expect(exec).not.toHaveBeenCalled()
  })

  it('pool_start 单波链同样拒绝（池的每条链都由单链 pipeline 驱动）', async () => {
    const digest = await seed(pkgOf(['optimize'], WATER_XYZ))
    const { ctx, tools } = makeCtx()
    apply(ctx)
    const exec = vi.spyOn(MatClient.prototype, 'execCommand').mockImplementation(async () => {
      throw new Error('must not reach the cluster')
    })
    await expect(tools.get('mat_pool_start')!.execute({
      cluster_id: '11250',
      chains: [{ pkg_digest: digest, workdir: '/home/u/w/h2o' }],
    }, {} as never)).rejects.toThrow(/WRONG_CHANNEL/)
    expect(exec).not.toHaveBeenCalled()
  })

  it('mode 与波数不一致的产物一律拒绝（不择一为准）', async () => {
    // 两个指标是同一事实的两种表示（compileTaskPackage 同时写出），不一致即产物
    // 损坏——手搓 fixture、旧版编译产物都会长这样。此时 fail-closed 而不是挑一边
    // 信：一条只有一波却声称 stepwise 的链进了 driver，会以「单波跑完即完成」
    // 静默通过，看起来成功而实际根本没执行这条链。
    const real = pkgOf(['irc'], WATER_XYZ)
    const oneWaveButStepwise: TaskPackage = {
      ...real,
      waves: [real.waves[0]!],
      digest: 'd'.repeat(64),
    }
    const digest = await seed(oneWaveButStepwise)
    const { ctx, tools } = makeCtx()
    apply(ctx)
    await expect(tools.get('mat_pipeline_start')!.execute({
      pkg_digest: digest,
      cluster_id: '11250',
      workdir: '/home/u/w/chain',
    }, {} as never)).rejects.toThrow(/WRONG_CHANNEL[\s\S]*disagree[\s\S]*recompile/)
  })

  it('反向不一致（多波但 mode=one-stop）同样拒绝', async () => {
    const real = pkgOf(['irc'], WATER_XYZ)
    const tampered: TaskPackage = {
      ...real,
      execution: { ...real.execution, mode: 'one-stop' },
      digest: 'e'.repeat(64),
    }
    const digest = await seed(tampered)
    const { ctx, tools } = makeCtx()
    apply(ctx)
    await expect(tools.get('mat_pipeline_start')!.execute({
      pkg_digest: digest,
      cluster_id: '11250',
      workdir: '/home/u/w/chain',
    }, {} as never)).rejects.toThrow(/WRONG_CHANNEL[\s\S]*disagree/)
  })

  it('stepwise 包正常通过通道闸（继续走后续校验）', async () => {
    const digest = await seed(pkgOf(['irc'], WATER_XYZ))
    const { ctx, tools } = makeCtx()
    apply(ctx)
    vi.spyOn(MatClient.prototype, 'execCommand')
      .mockResolvedValue({ code: 0, data: '', message: '' } as never)
    const out = await tools.get('mat_pipeline_start')!.execute({
      pkg_digest: digest,
      cluster_id: '11250',
      workdir: '/home/u/w/chain',
    }, {} as never)
    expect(out).not.toContain('WRONG_CHANNEL')
    expect(out).toContain('started')
  })
})
