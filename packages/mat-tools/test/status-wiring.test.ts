import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { MatClient } from 'mat-core'
import type { StatusBoard } from 'mat-core'
import { apply } from '../src/index'

/**
 * producer → 状态板接线集成测试：fake ctx/jobs + MatClient.execCommand 原型桩，
 * 驱动 mat_job_watch / mat_gaussian 工具走完 upsert（monitoring）与 settle。
 */

const XYZ = '3\n\nO 0.000000 0.000000 0.117790\nH 0.000000 0.757160 -0.470790\nH 0.000000 -0.757160 -0.470790\n'

const POST_OK_OUTPUT = [
  '[post] parsing job.log',
  '{"status": "ok", "phase": "post", "properties": {"energy": -76.408954, "converged": true, "frequencies_cm-1": [1713.13, 3727.17, 3849.10], "imaginary_frequency_count": 0}, "files": ["g16_optimized.xyz", "job.log"], "plots": [{"kind": "ir_spectrum", "image": "/home/u/w/freq/ir_spectrum.png", "data": "/home/u/w/freq/ir_spectrum.csv"}, {"kind": "scf_convergence", "image": null, "data": "/home/u/w/freq/scf_convergence.csv"}]}',
  '[post] done',
].join('\n')

interface RegisteredTool {
  name: string
  execute: (args: Record<string, unknown>, exec: { agent?: { id: string } }) => Promise<string>
}

/** fake ctx：捕获 systemPrompt/tools/provide；jobs.start 立即调 run() 并登记 hooks。 */
function makeCtx() {
  const tools = new Map<string, RegisteredTool>()
  const provided = new Map<string, unknown>()
  const hooks = new Map<string, unknown>()
  const jobs = {
    counter: 0,
    hooks,
    // 对齐生产 jobs-local：start() 内同步调 spec.run()，id 在其返回后才赋值——
    // producer 若在 run() 里同步引用闭包外层的 id 会直接 TDZ（曾致线上 33 连崩）。
    start(input: { kind: string; label: string; run: () => unknown }) {
      jobs.counter += 1
      const count = jobs.counter
      const producer = input.run()
      const id = `${input.kind}-${count}`
      hooks.set(id, producer)
      return id
    },
  }
  const ctx = {
    on: () => () => {},
    systemPrompt: { section: (_s: unknown) => {} },
    tools: {
      register: (t: RegisteredTool) => { tools.set(t.name, t) },
    },
    get: (key: string) => (key === 'jobs' ? jobs : undefined),
    provide: (name: string, value: unknown) => {
      provided.set(name, value)
      return () => { provided.delete(name) }
    },
  } as unknown as Context
  return { ctx, tools, provided }
}

/** 按命令特征分发预置输出的 execCommand 原型桩。 */
function stubExec(script: Array<{ match: (cmd: string) => boolean; out: string }>): void {
  const pending = [...script]
  vi.spyOn(MatClient.prototype, 'execCommand').mockImplementation(async (_c, command) => {
    const index = pending.findIndex((s) => s.match(command))
    if (index >= 0) {
      const [step] = pending.splice(index, 1)
      return { code: 0, data: step.out, message: '' }
    }
    throw new Error(`unexpected command: ${command.slice(0, 90)}`)
  })
}

describe('mat.status 板接线（watch/gaussian producer 喂料）', () => {
  let testRoot: string
  beforeEach(async () => {
    testRoot = await mkdtemp('/tmp/mat-status-wiring-')
    vi.stubEnv('MAT_FILE_ROOT', testRoot)
    // 环境门禁与本用例正交（本文件测的是别的闸）——整闸关闭，免得每例先跑一遍门禁
    vi.stubEnv('MAT_ENV_GATE', 'off')
    vi.useFakeTimers()
    apply(makeCtx().ctx) // 先注册一遍拿 provide 语义？——不：每用例自建 ctx，见下
  })
  afterEach(async () => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    await rm(testRoot, { recursive: true, force: true })
  })
  const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms)

  it('apply 提供 mat.status 板服务', () => {
    const { ctx, provided } = makeCtx()
    apply(ctx)
    const board = provided.get('mat.status') as StatusBoard | undefined
    expect(board).toBeDefined()
    expect(typeof board!.list).toBe('function')
  })

  it('目录键持久不丢：结算 25 个作业后板上仍全量保留（接线覆写 maxSettled，防目录键静默蒸发）', async () => {
    vi.useRealTimers()
    const { ctx, provided } = makeCtx()
    apply(ctx)
    const board = provided.get('mat.status') as StatusBoard
    for (let index = 1; index <= 25; index += 1) {
      const jobId = `11250:12100${String(index).padStart(3, '0')}`
      board.upsert(jobId, {
        kind: 'mat-slurm', label: String(index), clusterId: '11250', startedAt: index,
        localWorkspace: `${testRoot}/11250/12100${String(index).padStart(3, '0')}`,
      })
      board.settle(jobId, { outcomeStatus: 'completed' })
    }
    // 内存板与持久层都必须保住 25 条：onChange 写的是裁剪后快照，裁剪上限必须足够大。
    expect(board.list()).toHaveLength(25)
    const persisted = JSON.parse(await readFile(`${testRoot}/jobs.json`, 'utf8')).jobs
    expect(persisted).toHaveLength(25)
    const restarted = makeCtx()
    apply(restarted.ctx)
    expect((restarted.provided.get('mat.status') as StatusBoard).list()).toHaveLength(25)
  })

  it('重启 apply 后从本地快照恢复 tracked job', async () => {
    vi.useRealTimers()
    const first = makeCtx()
    apply(first.ctx)
    const board = first.provided.get('mat.status') as StatusBoard
    board.upsert('persisted-job', {
      kind: 'mat-slurm', label: 'persisted', clusterId: '11250',
      startedAt: 500, workdir: '/home/u/work',
      localWorkspace: `${testRoot}/11250/persisted-job`,
    })
    expect(JSON.parse(await readFile(`${testRoot}/jobs.json`, 'utf8')).jobs)
      .toHaveLength(1)

    const restarted = makeCtx()
    apply(restarted.ctx)
    expect((restarted.provided.get('mat.status') as StatusBoard).list())
      .toMatchObject([{ jobId: 'persisted-job', workdir: '/home/u/work', localWorkspace: `${testRoot}/11250/persisted-job` }])
  })

  it('重启旧快照没有 localWorkspace 时按稳定任务映射补齐工作目录', async () => {
    vi.useRealTimers()
    const legacy = makeCtx()
    apply(legacy.ctx)
    await import('node:fs/promises').then(({ writeFile }) => writeFile(`${testRoot}/jobs.json`, JSON.stringify({ jobs: [{
      jobId: 'legacy-job', kind: 'mat-slurm', label: 'legacy', clusterId: '11250',
      startedAt: 500, updatedAt: 500, phase: 'settled', workdir: '/home/u/work',
    }] })))

    const restarted = makeCtx()
    apply(restarted.ctx)
    expect((restarted.provided.get('mat.status') as StatusBoard).list())
      .toMatchObject([{ jobId: 'legacy-job', localWorkspace: `${testRoot}/11250/legacy-job` }])
  })

  it('mat_download：OpenAPI 无集群 token 时改走已授权 remote-shell 后备通道', async () => {
    vi.useRealTimers()
    const { ctx, tools } = makeCtx()
    apply(ctx)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      status: 200,
      text: () => Promise.resolve(JSON.stringify({
        code: '0',
        data: [{ clusterId: '11250', clusterName: '华东一区【昆山】', token: '' }],
      })),
    } as Response)
    const exec = vi.spyOn(MatClient.prototype, 'execCommand')
      .mockResolvedValueOnce({ code: 0, data: '3\n', message: '' })
      .mockResolvedValueOnce({ code: 0, data: `${gzipSync(Buffer.from('xyz')).toString('base64')}\n`, message: '' })
    const dir = await import('node:fs/promises').then(({ mkdtemp }) => mkdtemp('/tmp/mat-tool-download-'))
    const localPath = `${dir}/result.xyz`
    try {
      const result = await tools.get('mat_download')!.execute({
        cluster_id: '11250', remote_path: '/remote/result.xyz', local_path: localPath,
      }, {})
      expect(result).toContain('downloaded via remote-shell fallback')
      expect(exec).toHaveBeenCalled()
    } finally {
      await import('node:fs/promises').then(({ rm }) => rm(dir, { recursive: true, force: true }))
    }
  })

  it('mat_download：未配置 AK/SK 时也可仅凭已授权 MAT_MCP_KEY 后备下载', async () => {
    vi.useRealTimers()
    vi.stubEnv('MAT_ACCESS_KEY', '')
    vi.stubEnv('MAT_SECRET_KEY', '')
    vi.stubEnv('MAT_USER', '')
    const { ctx, tools } = makeCtx()
    apply(ctx)
    vi.spyOn(MatClient.prototype, 'execCommand')
      .mockResolvedValueOnce({ code: 0, data: '3\n', message: '' })
      .mockResolvedValueOnce({ code: 0, data: `${gzipSync(Buffer.from('xyz')).toString('base64')}\n`, message: '' })
    const dir = await import('node:fs/promises').then(({ mkdtemp }) => mkdtemp('/tmp/mat-tool-download-'))
    try {
      const result = await tools.get('mat_download')!.execute({
        cluster_id: '11276', remote_path: '/remote/result.xyz', local_path: `${dir}/result.xyz`,
      }, {})
      expect(result).toContain('downloaded via remote-shell fallback')
    } finally {
      await import('node:fs/promises').then(({ rm }) => rm(dir, { recursive: true, force: true }))
    }
  })

  it('mat_job_watch：一卡一 Slurm 作业（键 cluster:jobId、label=纯作业号、workspace 按真实号）', async () => {
    const { ctx, tools, provided } = makeCtx()
    apply(ctx)
    const board = provided.get('mat.status') as StatusBoard
    stubExec([
      { match: (c) => c.includes('sacct -j'), out: '100|RUNNING|0:0|15\n101|PENDING|0:0|0\n' },
    ])
    const watch = tools.get('mat_job_watch')!
    await watch.execute(
      { cluster_id: '11250', job_ids: ['100', '101'] },
      { agent: { id: 'sess-a' } },
    )
    await advance(0)
    expect(board.list()).toHaveLength(2)
    expect(board.list()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        jobId: '11250:100', kind: 'mat-watch', label: '100', clusterId: '11250',
        ownerSession: 'sess-a', localWorkspace: `${testRoot}/11250/100`,
        phase: 'running', // R2：首 tick 见 RUNNING（原 monitoring）
        slurm: [{ id: '100', state: 'RUNNING', exitCode: 0, elapsedSeconds: 15 }],
      }),
      expect.objectContaining({
        jobId: '11250:101', label: '101', phase: 'queued', // R2：全 PENDING → queued
        slurm: [{ id: '101', state: 'PENDING', exitCode: 0, elapsedSeconds: 0 }],
      }),
    ]))
  })

  it('mat_job_watch：label 前缀对齐一站式形态（gaussian <task> @<cluster> #<jobid>；缺省仍纯作业号）', async () => {
    const { ctx, tools, provided } = makeCtx()
    apply(ctx)
    const board = provided.get('mat.status') as StatusBoard
    stubExec([
      { match: (c) => c.includes('sacct -j'), out: '200|RUNNING|0:0|15\n' },
    ])
    const watch = tools.get('mat_job_watch')!
    await watch.execute(
      { cluster_id: '11250', job_ids: ['200'], label: 'gaussian irc @11250' },
      { agent: { id: 'sess-a' } },
    )
    await advance(0)
    expect(board.list()).toEqual(expect.arrayContaining([
      // D24（r10 观察、r11 复现）：分步 watch 的裸 jobid 与一站式
      // "gaussian <task> @<cluster> #<jobid>" 混排增加对账心智负担——带 label
      // 时子卡与一站式同形态。
      expect.objectContaining({
        jobId: '11250:200', kind: 'mat-watch', label: 'gaussian irc @11250 #200',
      }),
    ]))
  })

  it('mat_job_watch：sacct WorkDir 列入板（watch 作业的文件面板可浏览/打开文件）', async () => {
    const { ctx, tools, provided } = makeCtx()
    apply(ctx)
    const board = provided.get('mat.status') as StatusBoard
    stubExec([
      // 生产命令 5 列；WorkDir 来自 sacct（2026-09-04 11250 实证，见 PROVENANCE）
      { match: (c) => c.includes('sacct -j'), out: '100|RUNNING|0:0|15|/public/home/hpc-user-a/workspace/h3-qst3-0904r3/qst3\n100.batch|RUNNING|0:0|15|\n' },
    ])
    const watch = tools.get('mat_job_watch')!
    await watch.execute({ cluster_id: '11250', job_ids: ['100'] }, { agent: { id: 'sess-a' } })
    await advance(0)
    expect(board.list()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        jobId: '11250:100', kind: 'mat-watch', label: '100',
        workdir: '/public/home/hpc-user-a/workspace/h3-qst3-0904r3/qst3',
      }),
    ]))
  })

  it('mat_job_watch：WorkDir 为空时板条目不写 workdir（缺省语义不变）', async () => {
    const { ctx, tools, provided } = makeCtx()
    apply(ctx)
    const board = provided.get('mat.status') as StatusBoard
    stubExec([
      { match: (c) => c.includes('sacct -j'), out: '100|RUNNING|0:0|15|\n' },
    ])
    const watch = tools.get('mat_job_watch')!
    await watch.execute({ cluster_id: '11250', job_ids: ['100'] }, { agent: { id: 'sess-a' } })
    await advance(0)
    expect(board.list()[0]?.workdir).toBeUndefined()
  })

  it('mat_job_watch：逐卡结算（outcomeStatus/detail 按各作业自身终态）', async () => {
    const { ctx, tools, provided } = makeCtx()
    apply(ctx)
    const board = provided.get('mat.status') as StatusBoard
    stubExec([
      { match: (c) => c.includes('sacct -j'), out: '100|COMPLETED|0:0|26\n101|FAILED|1:0|30\n' },
    ])
    const watch = tools.get('mat_job_watch')!
    await watch.execute({ cluster_id: '11250', job_ids: ['100', '101'] }, { agent: { id: 'sess-a' } })
    await advance(0)
    const byKey = new Map(board.list().map(entry => [entry.jobId, entry]))
    expect(byKey.get('11250:100')).toMatchObject({ phase: 'settled', outcomeStatus: 'completed' })
    expect(byKey.get('11250:100')!.detail).toContain('COMPLETED')
    expect(byKey.get('11250:101')).toMatchObject({ phase: 'settled', outcomeStatus: 'failed' })
    expect(byKey.get('11250:101')!.settledAt).toEqual(expect.any(Number))
  })

  it('重复 watch 同一 Slurm 作业：同键幂等合并，不新增卡片（跨会话重监控也不翻倍）', async () => {
    const { ctx, tools, provided } = makeCtx()
    apply(ctx)
    stubExec([
      { match: (c) => c.includes('sacct -j'), out: '100|RUNNING|0:0|15\n' },
    ])
    const watch = tools.get('mat_job_watch')!
    await watch.execute({ cluster_id: '11250', job_ids: ['100'] }, { agent: { id: 'sess-a' } })
    await advance(0)
    await watch.execute({ cluster_id: '11250', job_ids: ['100'] }, { agent: { id: 'sess-b' } })
    await advance(0)
    const entries = (provided.get('mat.status') as StatusBoard).list()
      .filter(entry => entry.clusterId === '11250')
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ jobId: '11250:100', ownerSession: 'sess-b', phase: 'running' }) // R2：RUNNING → running
  })

  it('mat_gaussian：自定义 run_json partition 投影到状态板', async () => {
    const { ctx, tools, provided } = makeCtx()
    apply(ctx)
    const board = provided.get('mat.status') as StatusBoard
    stubExec([
      { match: (c) => c.includes('PREP_READY') || c.includes('mkdir -p'), out: 'PREP_READY\n' },
      { match: (c) => c.includes('-p pre'), out: '{"status": "ok", "phase": "pre"}\n' },
      { match: (c) => c.includes('-p run'), out: '{"status": "ok", "phase": "run"}\n' },
      { match: (c) => c.includes('sbatch slurm.sh'), out: 'Submitted batch job 701\n' },
      { match: (c) => c.includes('sacct -j 701'), out: '701|RUNNING|0:0|15\n' },
    ])
    await tools.get('mat_gaussian')!.execute({
      cluster_id: '11250', task: 'opt', structure: XYZ, workdir: '/home/u/custom', partition: 'IgnoredArgument',
      options: { run_json: { slurm: { partition: 'CustomQueue' } }, confirmation_gate: 'off' },
    }, {})
    await advance(0)
    expect(board.list()[0].partition).toBe('CustomQueue')
  })

  it('mat_gaussian：monitoring 含 task/workdir；结算含 properties/files', async () => {
    const { ctx, tools, provided } = makeCtx()
    apply(ctx)
    const board = provided.get('mat.status') as StatusBoard
    stubExec([
      { match: (c) => c.includes('PREP_READY') || c.includes('mkdir -p'), out: 'PREP_READY\n' },
      { match: (c) => c.includes('-p pre'), out: '{"status": "ok", "phase": "pre"}\n' },
      { match: (c) => c.includes('-p run'), out: '{"status": "ok", "phase": "run"}\n' },
      { match: (c) => c.includes('sbatch slurm.sh'), out: 'Submitted batch job 700\n' },
      { match: (c) => c.includes('sacct -j 700'), out: '700|RUNNING|0:0|15\n' },
      { match: (c) => c.includes('sacct -j 700'), out: '700|COMPLETED|0:0|30\n' },
      { match: (c) => c.includes('-p post'), out: POST_OK_OUTPUT },
    ])
    const gaussian = tools.get('mat_gaussian')!
    const submit = await gaussian.execute(
      { cluster_id: '11250', task: 'opt+freq', structure: XYZ, workdir: '/home/u/w', options: { confirmation_gate: 'off' } },
      { agent: { id: 'sess-a' } },
    )
    expect(submit).toContain('slurm job 700')
    await advance(0)
    const [monitoring] = board.list()
    expect(monitoring).toMatchObject({
      jobId: '11250:700',
      kind: 'mat-slurm',
      label: 'gaussian opt+freq @11250 #700',
      clusterId: '11250',
      ownerSession: 'sess-a',
      localWorkspace: `${testRoot}/11250/700`,
      phase: 'running', // R2：首 tick 见 RUNNING（原 monitoring）
      task: 'opt+freq',
      workdir: '/home/u/w',
      partition: 'kshcnormal',
      slurm: [{ id: '700', state: 'RUNNING', exitCode: 0, elapsedSeconds: 15 }],
    })
    await advance(10_000)
    const [settled] = board.list()
    expect(settled.phase).toBe('settled')
    expect(settled.outcomeStatus).toBe('completed')
    expect(settled.converged).toBe(true)
    expect(settled.properties).toMatchObject({ energy: -76.408954, converged: true, imaginary_frequency_count: 0 })
    expect(settled.files).toEqual(['g16_optimized.xyz', 'job.log'])
    expect(settled.plots).toEqual([
      { kind: 'ir_spectrum', image: '/home/u/w/freq/ir_spectrum.png', data: '/home/u/w/freq/ir_spectrum.csv' },
      { kind: 'scf_convergence', image: null, data: '/home/u/w/freq/scf_convergence.csv' },
    ])
  })

  it('R2 跃迁通知：长排队（PENDING≥60s）后观察到 RUNNING → owner.followup 一次性"已开始运行"', async () => {
    const { ctx, tools } = makeCtx()
    apply(ctx)
    const followup = vi.fn()
    const T0 = Date.now()
    let sacctCalls = 0
    vi.spyOn(MatClient.prototype, 'execCommand').mockImplementation(async (_c, command) => {
      if (command.includes('sacct')) {
        sacctCalls += 1
        const t = Date.now() - T0
        // 时钟驱动状态机（轮询节律无关）：前 60s 排队，60-130s 运行，之后完成。
        // 跃迁通知是 best-effort：RUNNING 窗口必须宽于轮询间隔才会被拍到（窗口被
        // 跳过时直接 PENDING→COMPLETED，不通知不算缺陷——语义见 SKILL M30）。
        const out = t < 60_000 ? '710|PENDING|0:0|0\n' : t < 130_000 ? '710|RUNNING|0:0|60\n' : '710|COMPLETED|0:0|120\n'
        return { code: 0, data: out, message: '' }
      }
      if (command.includes('PREP_READY') || command.includes('mkdir -p')) return { code: 0, data: 'PREP_READY\n', message: '' }
      if (command.includes('-p pre') || command.includes('-p run')) return { code: 0, data: '{"status": "ok"}\n', message: '' }
      if (command.includes('sbatch slurm.sh')) return { code: 0, data: 'Submitted batch job 710\n', message: '' }
      if (command.includes('-p post')) return { code: 0, data: POST_OK_OUTPUT, message: '' }
      throw new Error(`unexpected command: ${command.slice(0, 90)}`)
    })
    await tools.get('mat_gaussian')!.execute(
      { cluster_id: '11250', task: 'opt', structure: XYZ, workdir: '/home/u/q1', options: { confirmation_gate: 'off' } },
      { agent: { id: 'sess-q', followup } as never },
    )
    await advance(70_000)   // 跨过 60s 排队 + 首个 RUNNING 观察拍
    expect(followup).toHaveBeenCalledTimes(1)
    const text = JSON.stringify(followup.mock.calls[0])
    expect(text).toContain('started running')
    expect(text).toMatch(/\d+s in queue/)
    await advance(70_000)   // COMPLETED 结算
    expect(followup).toHaveBeenCalledTimes(1) // 只推一次
    expect(sacctCalls).toBeGreaterThan(3)
  })

  it('R2 跃迁通知：短排队（<60s）不打扰；RUNNING 窗口被跳过时静默（best-effort）', async () => {
    const { ctx, tools } = makeCtx()
    apply(ctx)
    const followup = vi.fn()
    const T0 = Date.now()
    vi.spyOn(MatClient.prototype, 'execCommand').mockImplementation(async (_c, command) => {
      if (command.includes('sacct')) {
        const t = Date.now() - T0
        // PENDING 仅 20s：RUNNING 观察拍落在 ~30s，排队计时 <60 阈值 → 不通知
        const out = t < 20_000 ? '711|PENDING|0:0|0\n' : t < 90_000 ? '711|RUNNING|0:0|20\n' : '711|COMPLETED|0:0|60\n'
        return { code: 0, data: out, message: '' }
      }
      if (command.includes('PREP_READY') || command.includes('mkdir -p')) return { code: 0, data: 'PREP_READY\n', message: '' }
      if (command.includes('-p pre') || command.includes('-p run')) return { code: 0, data: '{"status": "ok"}\n', message: '' }
      if (command.includes('sbatch slurm.sh')) return { code: 0, data: 'Submitted batch job 711\n', message: '' }
      if (command.includes('-p post')) return { code: 0, data: POST_OK_OUTPUT, message: '' }
      throw new Error(`unexpected command: ${command.slice(0, 90)}`)
    })
    await tools.get('mat_gaussian')!.execute(
      { cluster_id: '11250', task: 'opt', structure: XYZ, workdir: '/home/u/q2', options: { confirmation_gate: 'off' } },
      { agent: { id: 'sess-q2', followup } as never },
    )
    await advance(120_000)
    expect(followup).not.toHaveBeenCalled()
  })

  it('mat_gaussian：producer 轮询默认封顶 30s（DEFAULT_PRODUCER_POLL_SECONDS 接线）', async () => {
    const { ctx, tools } = makeCtx()
    apply(ctx)
    let sacctCalls = 0
    vi.spyOn(MatClient.prototype, 'execCommand').mockImplementation(async (_c, command) => {
      if (command.includes('sacct -j 703')) {
        sacctCalls += 1
        return { code: 0, data: '703|RUNNING|0:0|15\n', message: '' }
      }
      if (command.includes('PREP_READY') || command.includes('mkdir -p')) return { code: 0, data: 'PREP_READY\n', message: '' }
      if (command.includes('-p pre')) return { code: 0, data: '{"status": "ok", "phase": "pre"}\n', message: '' }
      if (command.includes('-p run')) return { code: 0, data: '{"status": "ok", "phase": "run"}\n', message: '' }
      if (command.includes('sbatch slurm.sh')) return { code: 0, data: 'Submitted batch job 703\n', message: '' }
      throw new Error(`unexpected command: ${command.slice(0, 90)}`)
    })
    await tools.get('mat_gaussian')!.execute(
      { cluster_id: '11250', task: 'opt', structure: XYZ, workdir: '/home/u/pollcap', options: { confirmation_gate: 'off' } },
      {},
    )
    // 时间线（cap 30s）：t=0 首 + 首 60s 内 10s×6 跳（10..60），elapsed≥60s 后 60s 自适应档被 30s 封顶
    // → 0,10,20,30,40,50,60,90,120 共 9 跳；无封顶时 60s 档生效只有 8 跳——
    // 回退调用处的 `?? DEFAULT_PRODUCER_POLL_SECONDS` 此断言即红。
    await advance(120_000)
    expect(sacctCalls).toBe(9)
  })
})
