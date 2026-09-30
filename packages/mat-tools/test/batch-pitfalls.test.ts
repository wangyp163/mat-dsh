import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MatClient, compileTaskPackage, createPipelineState } from 'mat-core'
import type { Goal, TaskPackage } from 'mat-core'

import { apply, resetMatDbForTests } from '../src/index'

/**
 * 批量 N 链的三个真实坑（2026-09-23 核查，全部实证）。
 *
 * 坑 1：digest 只投影参数摘要（method/basis/charge/mult/资源/slurm），结构坐标
 *   完全不参与——10 个不同反应用同一套泛函基组时 digest 逐位相同。
 *   pipelineId 若只取 digest 前 12 位，第二条链直接撞 "already exists"。
 * 坑 1b：pool_start 此前完全没有 workdir 去重（findLivePipelineOnWorkdir 全仓
 *   只有 pipeline_start 一个调用点）。两条链共用 workdir 会互相覆写 pre.json、
 *   共享 result.json——门检读到对方的收敛数据，产出静默错误结果。
 * 坑 2：watch-loop 的 max-wait 以 status='completed' 结算但不触发 onAllSettled，
 *   driver 旧代码把它兜成 UNKNOWN 进失败环——正常排队的作业被判失败。
 */

const WATER_XYZ = '3\n\nO 0.000000 0.000000 0.117790\nH 0.000000 0.757160 -0.470790\nH 0.000000 -0.757160 -0.470790\n'
const H2S_XYZ = '3\n\nS 0.000000 0.000000 0.200000\nH 0.000000 0.960000 -0.500000\nH 0.000000 -0.960000 -0.500000\n'

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

function pkgOf(xyz: string, label: string): TaskPackage {
  const goal: Goal = {
    schema_version: 'aimater.goal.v1',
    structure: { label, xyz, source: 'user-upload' },
    intent: { want: ['irc'] },
    resources: { partition: 'Agent0' },
  }
  const r = compileTaskPackage(goal)
  expect(r.status).toBe('ready')
  return r.pkg!
}

describe('坑 1（根因）：digest 不含结构，同参数不同分子撞号', () => {
  it('水与硫化氢的 ts+irc 包 digest 逐位相同（这是既有事实，不是回归）', () => {
    const a = pkgOf(WATER_XYZ, 'water')
    const b = pkgOf(H2S_XYZ, 'h2s')
    expect(a.task).toBe(b.task)
    // 结构不同、包内容相同——因为 preJson/runJson 不含坐标，结构是提交时另传的
    expect(a.digest).toBe(b.digest)
  })
})

describe('坑 1a 修复：pipelineId 含 workdir 指纹，同 digest 不同 workdir 可并存', () => {
  let root: string
  beforeEach(async () => {
    root = await mkdtemp('/tmp/mat-batch-id-')
    vi.stubEnv('MAT_FILE_ROOT', root)
    vi.stubEnv('MAT_ENV_GATE', 'off')
    resetMatDbForTests()
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    await rm(root, { recursive: true, force: true })
  })

  async function seed(pkg: TaskPackage): Promise<void> {
    const dir = join(root, 'task-packages')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, `${pkg.digest}.json`), JSON.stringify(pkg))
  }

  it('同一 digest、两个不同 workdir → 两条链都能启动且 id 不同', async () => {
    const pkg = pkgOf(WATER_XYZ, 'rxn')
    await seed(pkg)
    const { ctx, tools } = makeCtx()
    apply(ctx)
    vi.spyOn(MatClient.prototype, 'execCommand')
      .mockResolvedValue({ code: 0, data: '', message: '' } as never)

    const out1 = await tools.get('mat_pipeline_start')!.execute({
      pkg_digest: pkg.digest, cluster_id: '11250', workdir: '/home/u/rxn01',
    }, {} as never)
    // 此前这一步会抛 "already exists"——两个反应共用一个 id
    const out2 = await tools.get('mat_pipeline_start')!.execute({
      pkg_digest: pkg.digest, cluster_id: '11250', workdir: '/home/u/rxn02',
    }, {} as never)

    const id1 = /pipeline (\S+) started/.exec(out1)?.[1]
    const id2 = /pipeline (\S+) started/.exec(out2)?.[1]
    expect(id1).toBeDefined()
    expect(id2).toBeDefined()
    expect(id1).not.toBe(id2)
    // 两个 id 都带同一个 digest 前缀（可追溯回编译产物），后缀区分 workdir
    expect(id1!.startsWith(`pl-${pkg.digest.slice(0, 12)}-`)).toBe(true)
    expect(id2!.startsWith(`pl-${pkg.digest.slice(0, 12)}-`)).toBe(true)
  })

  it('同 digest 同 workdir 仍被拒（WORKDIR_BUSY 语义不受影响）', async () => {
    const pkg = pkgOf(WATER_XYZ, 'rxn')
    await seed(pkg)
    const { ctx, tools } = makeCtx()
    apply(ctx)
    vi.spyOn(MatClient.prototype, 'execCommand')
      .mockResolvedValue({ code: 0, data: '', message: '' } as never)
    await tools.get('mat_pipeline_start')!.execute({
      pkg_digest: pkg.digest, cluster_id: '11250', workdir: '/home/u/rxn01',
    }, {} as never)
    await expect(tools.get('mat_pipeline_start')!.execute({
      pkg_digest: pkg.digest, cluster_id: '11250', workdir: '/home/u/rxn01',
    }, {} as never)).rejects.toThrow(/already exists/)
  })
})

describe('坑 1b 修复：pool workdir 去重', () => {
  let root: string
  beforeEach(async () => {
    root = await mkdtemp('/tmp/mat-batch-pool-')
    vi.stubEnv('MAT_FILE_ROOT', root)
    vi.stubEnv('MAT_ENV_GATE', 'off')
    resetMatDbForTests()
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    await rm(root, { recursive: true, force: true })
  })

  async function seed(pkg: TaskPackage): Promise<void> {
    const dir = join(root, 'task-packages')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, `${pkg.digest}.json`), JSON.stringify(pkg))
  }

  it('批内两条链 workdir 重复 → WORKDIR_BUSY，点名是哪两条，零集群调用', async () => {
    const pkg = pkgOf(WATER_XYZ, 'rxn')
    await seed(pkg)
    const { ctx, tools } = makeCtx()
    apply(ctx)
    const exec = vi.spyOn(MatClient.prototype, 'execCommand').mockImplementation(async () => {
      throw new Error('must not reach the cluster')
    })
    await expect(tools.get('mat_pool_start')!.execute({
      cluster_id: '11250',
      chains: [
        { pkg_digest: pkg.digest, workdir: '/home/u/rxn01' },
        { pkg_digest: pkg.digest, workdir: '/home/u/rxn02' },
        { pkg_digest: pkg.digest, workdir: '/home/u/rxn01' },
      ],
    }, {} as never)).rejects.toThrow(/WORKDIR_BUSY: chains #1 and #3 share workdir \/home\/u\/rxn01/)
    expect(exec).not.toHaveBeenCalled()
  })

  it('尾斜杠归一后仍算重复（/w 与 /w/ 是同一个目录）', async () => {
    const pkg = pkgOf(WATER_XYZ, 'rxn')
    await seed(pkg)
    const { ctx, tools } = makeCtx()
    apply(ctx)
    await expect(tools.get('mat_pool_start')!.execute({
      cluster_id: '11250',
      chains: [
        { pkg_digest: pkg.digest, workdir: '/home/u/rxn01' },
        { pkg_digest: pkg.digest, workdir: '/home/u/rxn01/' },
      ],
    }, {} as never)).rejects.toThrow(/WORKDIR_BUSY/)
  })

  it('撞在场活链 → WORKDIR_BUSY 点名占用者', async () => {
    const pkg = pkgOf(WATER_XYZ, 'rxn')
    await seed(pkg)
    // 先落一条活链占住 /home/u/rxn01
    const live = createPipelineState({
      pipelineId: 'pl-live-0001', clusterId: '11250', workdir: '/home/u/rxn01', pkg,
    })
    const pdir = join(root, 'pipelines')
    await mkdir(pdir, { recursive: true })
    await writeFile(join(pdir, 'pl-live-0001.json'), JSON.stringify(live))

    const { ctx, tools } = makeCtx()
    apply(ctx)
    await expect(tools.get('mat_pool_start')!.execute({
      cluster_id: '11250',
      chains: [{ pkg_digest: pkg.digest, workdir: '/home/u/rxn01' }],
    }, {} as never)).rejects.toThrow(/WORKDIR_BUSY.*pl-live-0001/s)
  })

  it('10 条各自独立 workdir → 正常受理', async () => {
    const pkg = pkgOf(WATER_XYZ, 'rxn')
    await seed(pkg)
    const { ctx, tools } = makeCtx()
    apply(ctx)
    // 池驱动会在后台真起链；本用例只验收理阶段（workdir 去重），故让远端
    // 调用挂住而非解析——否则驱动会在用例结束、临时目录已删后继续跑，
    // 抛出与被测行为无关的 ENOENT 噪声。
    vi.spyOn(MatClient.prototype, 'execCommand')
      .mockImplementation(() => new Promise(() => {}) as never)
    const chains = Array.from({ length: 10 }, (_, i) => ({
      pkg_digest: pkg.digest,
      workdir: `/home/u/rxn${String(i + 1).padStart(2, '0')}`,
    }))
    const out = await tools.get('mat_pool_start')!.execute({
      cluster_id: '11250', chains, max_concurrent: 2,
    }, {} as never)
    expect(out).not.toContain('WORKDIR_BUSY')
    expect(out).toMatch(/10/)
  })
})

describe('坑 2 修复：watch 超时是暂停不是失败', () => {
  it('max-wait 文案契约未变（driver 凭它识别超时）', async () => {
    // driver 的 timedOut 判定依赖 watch-loop 的 settle detail 前缀。
    // 这是跨模块文案契约——改 watch-loop 的文案必须同步 pipeline-driver。
    const { createWatchLoop } = await import('mat-core')
    let fire: (() => void) | undefined
    const loop = createWatchLoop({
      clusterId: '11250',
      jobIds: ['999'],
      maxWaitMs: 0,
      execCommand: async () => ({ code: 0, data: '', message: '' }) as never,
      scheduleTimeout: (cb) => { fire = cb as () => void; return 1 as never },
      clearTimeout: () => {},
    })
    fire?.()
    const outcome = await loop.done
    expect(outcome.status).toBe('completed')
    expect(outcome.detail).toMatch(/^max-wait exceeded/)
  })
})
