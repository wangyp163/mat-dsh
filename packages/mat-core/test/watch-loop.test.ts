import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createWatchLoop } from '../src/watch-loop'
import type { ExecResult } from '../src/client'
import { parseScfSamples } from '../src/scf-trend'
import type { ScfTrendReport } from '../src/scf-trend'

/** 脚本化 execCommand：每次调用弹出一条；{throw:} 表示传输级异常，{rcFail:true} 表示远端 rc≠0（code 10020）。 */
function fakeExec(script: Array<{ out?: string; rcFail?: boolean; throw?: string }>) {
  let i = 0
  const commands: string[] = []
  return {
    commands,
    async execCommand(_clusterId: string, command: string): Promise<ExecResult> {
      commands.push(command)
      const step = script[Math.min(i++, script.length - 1)]
      if (step.throw !== undefined) throw new Error(step.throw)
      if (step.rcFail) {
        return { code: 10020, data: { stdout: '', stderr: 'boom', exitCode: 1 }, message: 'remote shell command failed' }
      }
      return { code: 0, data: step.out ?? '', message: 'success' }
    },
  }
}

/** 便捷：作业主行（sacct -P -n 单行，无子行）。 */
const row = (id: string, state: string, exit = '0:0', elapsed = '0') => `${id}|${state}|${exit}|${elapsed}\n`

function makeLoop(
  script: Array<{ out?: string; rcFail?: boolean; throw?: string }>,
  jobIds: string[],
  opts: { maxWaitMs?: number; maxPollMs?: number } = {},
) {
  const fake = fakeExec(script)
  const loop = createWatchLoop({
    clusterId: '11250',
    jobIds,
    maxWaitMs: opts.maxWaitMs ?? 86_400_000,
    ...(opts.maxPollMs !== undefined ? { maxPollMs: opts.maxPollMs } : {}),
    execCommand: fake.execCommand,
    scheduleTimeout: (cb, ms) => setTimeout(cb, ms),
    clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  })
  return { loop, fake }
}

const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms)

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('createWatchLoop', () => {
  it('首跳立即执行，命令为单条批量 sacct', async () => {
    const { loop, fake } = makeLoop([{ out: row('100', 'RUNNING') }], ['100'])
    await advance(0)
    expect(fake.commands).toHaveLength(1)
    expect(fake.commands[0]).toBe('sacct -j 100 -P -n -o JobID,State,ExitCode,ElapsedRaw,WorkDir,Timelimit')
    expect(loop.readOutput()).toContain('100 RUNNING')
  })

  it('单作业 RUNNING→COMPLETED → done 结算 completed，detail 含计数', async () => {
    const { loop } = makeLoop([
      { out: row('100', 'RUNNING') },
      { out: row('100', 'COMPLETED', '0:0', '26') },
    ], ['100'])
    await advance(0)
    loop.readOutput() // 排空首读
    await advance(10_000)
    const outcome = await loop.done
    expect(outcome.status).toBe('completed')
    expect(outcome.detail).toBe('1/1 settled (1 COMPLETED)')
  })

  it('批量作业：一先一后，全部终态才结算；成功失败分列', async () => {
    const { loop } = makeLoop([
      { out: row('100', 'RUNNING') + row('101', 'RUNNING') },
      { out: row('100', 'COMPLETED', '0:0', '26') + row('101', 'RUNNING') },
      { out: row('100', 'COMPLETED', '0:0', '26') + row('101', 'FAILED', '1:0', '30') },
    ], ['100', '101'])
    await advance(0)
    loop.readOutput()
    await advance(10_000)
    let settled = false
    void loop.done.then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false) // 101 未终态，不结算
    await advance(10_000)
    const outcome = await loop.done
    expect(outcome.status).toBe('completed')
    expect(outcome.detail).toBe('2/2 settled (1 COMPLETED, 1 FAILED)')
  })

  it('readOutput 增量：无变化返回空串；结算后首读返回完整终态表', async () => {
    const { loop } = makeLoop([
      { out: row('100', 'PENDING') },
      { out: row('100', 'RUNNING', '0:0', '15') },
      { out: row('100', 'RUNNING', '0:0', '15') }, // 无变化轮
      { out: row('100', 'COMPLETED', '0:0', '26') },
    ], ['100'])
    await advance(0)
    expect(loop.readOutput()).toContain('100 PENDING')
    await advance(10_000)
    expect(loop.readOutput()).toContain('100 RUNNING')
    await advance(10_000)
    expect(loop.readOutput()).toBe('') // 状态无变化
    await advance(10_000)
    await loop.done
    const finalTable = loop.readOutput()
    expect(finalTable).toContain('1/1 settled (1 COMPLETED)')
    expect(finalTable).toContain('100 COMPLETED exit=0 elapsed=26s')
  })

  it('远端 rc≠0（code 10020）→ 宽限：不结算、不计连续失败', async () => {
    const { loop } = makeLoop([
      { rcFail: true },
      { rcFail: true },
      { out: row('100', 'COMPLETED') },
    ], ['100'])
    await advance(0)
    await advance(10_000)
    await advance(10_000)
    const outcome = await loop.done
    expect(outcome.status).toBe('completed')
    expect(outcome.detail).toBe('1/1 settled (1 COMPLETED)')
  })

  it('传输异常连续 5 次 → done 结算 failed', async () => {
    const { loop } = makeLoop([{ throw: 'network down' }], ['100'])
    await advance(0)
    for (let i = 1; i < 4; i += 1) await advance(10_000) // t=30，累计 4 次异常
    let settled = false
    void loop.done.then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false) // 4 次未到阈值
    await advance(10_000) // t=40，第 5 次
    const outcome = await loop.done
    expect(outcome.status).toBe('failed')
    expect(outcome.detail).toContain('network down')
  })

  it('传输异常后恢复 → 连续计数清零，继续监控', async () => {
    const { loop } = makeLoop([
      { throw: 'x1' }, { throw: 'x2' }, { out: row('100', 'RUNNING') },
      { throw: 'y1' }, { throw: 'y2' }, { throw: 'y3' }, { throw: 'y4' }, { out: row('100', 'COMPLETED') },
    ], ['100'])
    await advance(0)      // x1（1）
    await advance(10_000) // x2（2）
    await advance(10_000) // RUNNING → 计数清零
    await advance(10_000) // y1（1）
    await advance(10_000) // y2（2）
    await advance(10_000) // y3（3）
    await advance(10_000) // t=60：y4（4）→ 下跳 60s 档
    let failed = false
    void loop.done.then((o) => { if (o.status === 'failed') failed = true })
    await Promise.resolve()
    expect(failed).toBe(false) // 第二轮只连挂 4 次，未达 5
    await advance(60_000) // t=120：COMPLETED → 结算
    const outcome = await loop.done
    expect(outcome.status).toBe('completed')
  })

  it('maxWait 超时 → 结算 completed，detail 列出仍在途作业', async () => {
    const { loop } = makeLoop([{ out: row('100', 'RUNNING') + row('101', 'PENDING') }], ['100', '101'], { maxWaitMs: 25_000 })
    await advance(0)
    loop.readOutput()
    await advance(10_000)
    await advance(10_000)
    await advance(10_000) // elapsed=30s ≥ 25s
    const outcome = await loop.done
    expect(outcome.status).toBe('completed')
    expect(outcome.detail).toContain('max-wait exceeded')
    expect(outcome.detail).toContain('100')
    expect(outcome.detail).toContain('101')
  })

  it('cancel → 结算 killed，定时器不再触发', async () => {
    const { loop, fake } = makeLoop([{ out: row('100', 'RUNNING') }], ['100'])
    await advance(0)
    loop.readOutput()
    loop.cancel('user requested')
    const outcome = await loop.done
    expect(outcome.status).toBe('killed')
    const calls = fake.commands.length
    await advance(60_000)
    expect(fake.commands.length).toBe(calls) // 无新 tick
  })

  it('自适应间隔：<60s 每 10s 一跳，elapsed≥60s 后改 60s 一跳', async () => {
    const { fake } = makeLoop([{ out: row('100', 'RUNNING') }], ['100'])
    await advance(0) // t=0
    for (let t = 10_000; t <= 60_000; t += 10_000) await advance(10_000) // t=10..60
    expect(fake.commands.length).toBe(7) // 0,10,20,30,40,50,60
    await advance(59_000) // t=119s：60s 档未到
    expect(fake.commands.length).toBe(7)
    await advance(1_000) // t=120s
    expect(fake.commands.length).toBe(8)
  })

  it('maxPollMs 封顶：elapsed 超过 1800s 后，300s 自适应档被压到 60s', async () => {
    const { fake } = makeLoop([{ out: row('100', 'RUNNING') }], ['100'], { maxPollMs: 60_000 })
    await advance(1_800_000) // 快进过全部自适应档（脚本末条 RUNNING 重复消费）
    const before = fake.commands.length
    await advance(60_000) // 无封顶时此窗口在 300s 档内，不会有 tick
    expect(fake.commands.length).toBe(before + 1) // 60s 内必有且仅有一跳
  })

  it('新提交作业 sacct 尚无行 → 保持 UNKNOWN，不结算', async () => {
    const { loop } = makeLoop([{ out: '' }, { out: row('100', 'RUNNING') }], ['100'])
    await advance(0)
    expect(loop.readOutput()).toContain('100 UNKNOWN')
    await advance(10_000)
    let settled = false
    void loop.done.then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)
  })

  it('A1 事件感知回档:长期 PENDING 后 PENDING→RUNNING 转移把档位拨回 10s', async () => {
    // 旧逻辑按总时长单调升档:转移后仍处 60s 档,下一跳 t=180。事件感知把
    // 档位键换成「距最近变化」,转移后 10s 内必有一跳(t=130)。
    const { fake } = makeLoop([
      { out: row('100', 'PENDING') }, // t=0 首观测(计为变化)
      { out: row('100', 'PENDING') }, // t=10..50:无变化,10s 档
      { out: row('100', 'PENDING') },
      { out: row('100', 'PENDING') },
      { out: row('100', 'PENDING') },
      { out: row('100', 'PENDING') },
      { out: row('100', 'PENDING') }, // t=60:距变化 60s → 升 60s 档 → 下一跳 t=120
      { out: row('100', 'RUNNING') }, // t=120:转移 → 回拨 10s 档
      { out: row('100', 'RUNNING') }, // t=130:10s 内的下一跳(旧逻辑要等 t=180)
    ], ['100'])
    await advance(0)
    for (let t = 10_000; t <= 60_000; t += 10_000) await advance(10_000) // t=10..60,共 7 跳
    expect(fake.commands.length).toBe(7)
    await advance(60_000) // t=120:第 8 跳,观测到转移
    expect(fake.commands.length).toBe(8)
    await advance(10_000) // t=130:回档生效
    expect(fake.commands.length).toBe(9)
  })

  it('A2 maxWait 对齐:最后一跳 clamp 到剩余时限,到期即结算(不越界多睡一档)', async () => {
    // 旧逻辑 t=120 跳后按 60s 档排下一跳 → t=180 才结算,越界 50s。
    // clamp 后按剩余 10s 排 → t=130 恰好到期。
    const { loop, fake } = makeLoop([{ out: row('100', 'PENDING') }], ['100'], { maxWaitMs: 130_000 })
    await advance(0) // t=0 首观测
    for (let i = 0; i < 5; i += 1) await advance(10_000) // t=10..50
    await advance(10_000) // t=60:距变化 60s → 60s 档
    await advance(60_000) // t=120:elapsed<130 → 轮询第 8 跳;remaining=10s → clamp
    expect(fake.commands.length).toBe(8) // t=0,10,20,30,40,50,60,120
    let settled = false
    void loop.done.then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false) // t=120 未到期
    await advance(9_000) // t=129:clamp 后 10s 跳未到
    expect(settled).toBe(false)
    await advance(1_000) // t=130:恰好到期
    const outcome = await loop.done
    expect(outcome.status).toBe('completed')
    expect(outcome.detail).toContain('max-wait exceeded')
  })
})

describe('onAllSettled 钩子（producer 注入点）', () => {
  function makeLoopWithHook(
    script: Array<{ out?: string; rcFail?: boolean; throw?: string }>,
    hook: NonNullable<Parameters<typeof createWatchLoop>[0]['onAllSettled']>,
    opts: { maxWaitMs?: number } = {},
  ) {
    const fake = fakeExec(script)
    const loop = createWatchLoop({
      clusterId: '11250',
      jobIds: ['100'],
      maxWaitMs: opts.maxWaitMs ?? 86_400_000,
      execCommand: fake.execCommand,
      scheduleTimeout: (cb, ms) => setTimeout(cb, ms),
      clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      onAllSettled: hook,
    })
    return { loop, fake }
  }

  it('全部终态触发一次：detailSuffix 进 detail，extraLines 进终态首读', async () => {
    let calls = 0
    const seen: string[] = []
    const { loop } = makeLoopWithHook(
      [{ out: row('100', 'COMPLETED', '0:0', '26') }],
      async (states) => {
        calls += 1
        for (const [id, info] of states) seen.push(`${id}:${info.state}`)
        return { detailSuffix: '; opt E=-76.4 imag=0', extraLines: ['slurm_state: COMPLETED', 'properties: {"energy":-76.4}'] }
      },
    )
    await advance(0)
    const outcome = await loop.done
    expect(calls).toBe(1)
    expect(seen).toEqual(['100:COMPLETED'])
    expect(outcome.status).toBe('completed')
    expect(outcome.detail).toBe('1/1 settled (1 COMPLETED); opt E=-76.4 imag=0')
    const finalRead = loop.readOutput()
    expect(finalRead).toContain('slurm_state: COMPLETED')
    expect(finalRead).toContain('properties: {"energy":-76.4}')
    expect(finalRead).toContain('100 COMPLETED exit=0 elapsed=26s')
  })

  it('钩子抛错 → 吞入 extraLines 不炸结算，状态仍 completed', async () => {
    const { loop } = makeLoopWithHook(
      [{ out: row('100', 'COMPLETED') }],
      async () => { throw new Error('post boom') },
    )
    await advance(0)
    const outcome = await loop.done
    expect(outcome.status).toBe('completed')
    expect(outcome.detail).toBe('1/1 settled (1 COMPLETED)')
    expect(loop.readOutput()).toContain('on-all-settled hook failed: post boom')
  })

  it('max-wait / cancel / 连续传输异常路径不触发钩子', async () => {
    const forbidden = async () => { throw new Error('hook must not run on this path') }

    const l1 = makeLoopWithHook([{ out: row('100', 'RUNNING') }], forbidden, { maxWaitMs: 5_000 })
    await advance(0)
    await advance(10_000)
    expect((await l1.loop.done).detail).toContain('max-wait')

    const l2 = makeLoopWithHook([{ out: row('100', 'RUNNING') }], forbidden)
    await advance(0)
    l2.loop.cancel('stop')
    expect((await l2.loop.done).status).toBe('killed')

    const l3 = makeLoopWithHook([{ throw: 'net' }], forbidden)
    await advance(0)
    for (let i = 0; i < 4; i += 1) await advance(10_000)
    expect((await l3.loop.done).status).toBe('failed')
  })

  it('钩子执行期间被 cancel 先行结算 → 增补结果丢弃，不重复结算', async () => {
    let releaseHook: (() => void) | undefined
    const { loop } = makeLoopWithHook(
      [{ out: row('100', 'COMPLETED') }],
      () => new Promise((resolve) => { releaseHook = () => resolve({ extraLines: ['late augment'] }) }),
    )
    await advance(0)
    await Promise.resolve() // 进入钩子挂起
    loop.cancel('user beat the hook')
    expect((await loop.done).status).toBe('killed')
    releaseHook?.()
    await Promise.resolve()
    expect(loop.readOutput()).not.toContain('late augment')
  })
})

describe('onTick 钩子（状态板喂料点）', () => {
  it('每个成功轮询回合后触发，携带当前 states；结算回合也触发且含终态', async () => {
    const ticks: Array<Array<[string, string]>> = []
    const fake = fakeExec([
      { out: row('100', 'RUNNING', '0:0', '15') },
      { out: row('100', 'COMPLETED', '0:0', '26') },
    ])
    const loop = createWatchLoop({
      clusterId: '11250',
      jobIds: ['100'],
      maxWaitMs: 86_400_000,
      onTick: (states) => { ticks.push([...states.entries()].map(([id, info]) => [id, info.state])) },
      execCommand: fake.execCommand,
      scheduleTimeout: (cb, ms) => setTimeout(cb, ms),
      clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    })
    await advance(0)
    expect(ticks).toEqual([[['100', 'RUNNING']]])
    await advance(10_000)
    await loop.done
    expect(ticks).toEqual([[['100', 'RUNNING']], [['100', 'COMPLETED']]])
  })

  it('传输异常轮不触发；恢复后继续触发', async () => {
    const ticks: number[] = []
    const fake = fakeExec([{ throw: 'network down' }, { out: row('100', 'RUNNING') }])
    const loop = createWatchLoop({
      clusterId: '11250',
      jobIds: ['100'],
      maxWaitMs: 86_400_000,
      onTick: () => { ticks.push(1) },
      execCommand: fake.execCommand,
      scheduleTimeout: (cb, ms) => setTimeout(cb, ms),
      clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    })
    await advance(0)
    expect(ticks).toHaveLength(0)
    await advance(10_000)
    expect(ticks).toHaveLength(1)
    loop.cancel('done observing')
  })

  it('onTick 抛错被吞：监控与结算不受影响', async () => {
    let calls = 0
    const fake = fakeExec([{ out: row('100', 'COMPLETED') }])
    const loop = createWatchLoop({
      clusterId: '11250',
      jobIds: ['100'],
      maxWaitMs: 86_400_000,
      onTick: () => {
        calls += 1
        throw new Error('board exploded')
      },
      execCommand: fake.execCommand,
      scheduleTimeout: (cb, ms) => setTimeout(cb, ms),
      clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    })
    await advance(0)
    expect((await loop.done).status).toBe('completed')
    expect(calls).toBe(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// SCF 收敛采样(高级作业监控):采样窗门控 / 两窗确认 / 同类去抖 / 趋势行
// ─────────────────────────────────────────────────────────────────────────────

describe('scfSampling(收敛曲线监控)', () => {
  /** 命令路由型 exec:sacct 与采样 for-loop 分开应答。 */
  function routingExec(handlers: {
    sacct: () => string
    sample?: (workdirs: string[]) => string
  }) {
    const commands: string[] = []
    return {
      commands,
      async execCommand(_clusterId: string, command: string): Promise<ExecResult> {
        commands.push(command)
        if (command.startsWith('sacct')) return { code: 0, data: handlers.sacct(), message: '' }
        if (command.startsWith('for d in')) {
          if (handlers.sample === undefined) throw new Error('unexpected sampling command')
          const dirs = [...command.matchAll(/'([^']+)'/g)].map((m) => m[1]!)
          return { code: 0, data: handlers.sample(dirs), message: '' }
        }
        throw new Error(`unexpected command: ${command.slice(0, 80)}`)
      },
    }
  }

  /** 带 workdir/timelimit 的 sacct 行。 */
  const rowFull = (id: string, state: string, elapsed: string, workdir: string, timelimit: string) =>
    `${id}|${state}|0:0|${elapsed}|${workdir}|${timelimit}\n`

  const OSC_DONES = [-76.300, -76.299, -76.301, -76.299, -76.301, -76.299, -76.301, -76.299]
    .map((e, i) => ` SCF Done:  E(RB3LYP) =  ${e}  A.U. after  ${i + 2} cycles`).join('\n')

  function makeScfLoop(
    handlers: { sacct: () => string; sample?: (workdirs: string[]) => string },
    opts: { intervalMs?: number; maxWaitMs?: number; onTrend?: (reports: ScfTrendReport[]) => void } = {},
  ) {
    const fake = routingExec(handlers)
    const reports: ScfTrendReport[][] = []
    const loop = createWatchLoop({
      clusterId: '11250',
      jobIds: ['100'],
      maxWaitMs: opts.maxWaitMs ?? 86_400_000,
      scfSampling: {
        ...(opts.intervalMs !== undefined ? { intervalMs: opts.intervalMs } : {}),
        buildCommand: (workdirs) => `for d in ${workdirs.map((w) => `'${w}'`).join(' ')}; do echo "=== $d"; tail -n 200 x; done`,
        parse: (output) => parseScfSamples(output),
        ...(opts.onTrend !== undefined
          ? { onTrend: (rs) => { reports.push(rs); opts.onTrend?.(rs) } }
          : { onTrend: (rs) => { reports.push(rs) } }),
      },
      execCommand: fake.execCommand,
      scheduleTimeout: (cb, ms) => setTimeout(cb, ms),
      clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    })
    return { loop, fake, reports }
  }

  it('两窗确认:首个采样窗的振荡不下报,第二窗确认才 onTrend + 趋势行;同类去抖', async () => {
    const { loop, fake, reports } = makeScfLoop(
      { sacct: () => rowFull('100', 'RUNNING', '30', '/w/A', '04:00:00'), sample: () => `=== /w/A\n${OSC_DONES}` },
      { intervalMs: 10_000 },
    )
    await advance(0)
    loop.readOutput() // 排空首读
    await advance(10_000) // 采样窗 1:分类 oscillating,但无前科 → 不确认
    expect(reports).toHaveLength(0)
    await advance(10_000) // 采样窗 2:连续同类 → 确认 → 上报
    expect(reports).toHaveLength(1)
    expect(reports[0]![0]!.trend.kind).toBe('oscillating')
    expect(reports[0]![0]!.jobId).toBe('100')
    expect(loop.readOutput()).toContain('scf_trend: job 100 oscillating')
    await advance(10_000) // 采样窗 3:同类去抖,不再上报
    expect(reports).toHaveLength(1)
    loop.cancel('done')
    // 采样命令与状态轮询分离,且只对 RUNNING 作业的 workdir 采样
    expect(fake.commands.some((c) => c.startsWith('for d in'))).toBe(true)
  })

  it('恢复复位去抖:转 converging 后再次振荡可再报', async () => {
    let sampleIdx = 0
    const convDones = [-76.300, -76.3010, -76.3012, -76.30121, -76.301211, -76.3012111, -76.30121111]
      .map((e, i) => ` SCF Done:  E(RB3LYP) =  ${e}  A.U. after  ${i + 2} cycles`).join('\n')
    const { reports } = makeScfLoop({
      sacct: () => rowFull('100', 'RUNNING', '30', '/w/A', '04:00:00'),
      // 窗序:osc osc(确认上报#1) → conv(去抖复位) → osc osc(重新确认上报#2)
      sample: () => {
        sampleIdx += 1
        return sampleIdx === 3 ? `=== /w/A\n${convDones}` : `=== /w/A\n${OSC_DONES}`
      },
    }, { intervalMs: 10_000 })
    await advance(0)
    await advance(10_000)
    await advance(10_000) // 窗 1+2:振荡确认上报 #1
    expect(reports).toHaveLength(1)
    await advance(10_000) // 窗 3:converging → 去抖复位
    await advance(10_000) // 窗 4:振荡重现,首窗不确认
    await advance(10_000) // 窗 5:重新确认 → 上报 #2
    expect(reports).toHaveLength(2)
  })

  it('停滞:逼近 TimeLimit(≤20% 余量)才上报;余量充足不报', async () => {
    // 同号等步长平台(|ΔE| 恒 5e-4:不阻尼、不发散)——停滞的标准形态
    const stalledEnergies = Array.from({ length: 8 }, (_, i) => -76.3 + i * 5e-4)
    const stalledDones = stalledEnergies.map((e, i) => ` SCF Done:  E(RB3LYP) =  ${e}  A.U. after  ${i + 2} cycles`).join('\n')
    const a = makeScfLoop(
      { sacct: () => rowFull('100', 'RUNNING', '13000', '/w/A', '04:00:00'), sample: () => `=== /w/A\n${stalledDones}` },
      { intervalMs: 10_000 },
    )
    await advance(0)
    await advance(10_000)
    await advance(10_000)
    expect(a.reports).toHaveLength(1) // elapsed 13000 ≥ 0.8×14400
    expect(a.reports[0]![0]!.trend.kind).toBe('stalled')
    a.loop.cancel('done')

    const b = makeScfLoop(
      { sacct: () => rowFull('100', 'RUNNING', '3000', '/w/A', '04:00:00'), sample: () => `=== /w/A\n${stalledDones}` },
      { intervalMs: 10_000 },
    )
    await advance(0)
    await advance(10_000)
    await advance(10_000)
    await advance(10_000)
    expect(b.reports).toHaveLength(0) // 确认了 stalled 但余量 80%,不惊动
    b.loop.cancel('done')
  })

  it('采样窗门控:intervalMs 60s 时 10s 档的 tick 只在到窗才采样', async () => {
    const { fake } = makeScfLoop(
      { sacct: () => rowFull('100', 'RUNNING', '30', '/w/A', '04:00:00'), sample: () => '=== /w/A\n(no scf lines)' },
      { intervalMs: 60_000 },
    )
    await advance(0)
    for (let i = 0; i < 5; i += 1) await advance(10_000) // t=10..50:未到窗
    expect(fake.commands.filter((c) => c.startsWith('for d in'))).toHaveLength(0)
    await advance(10_000) // t=60:到窗采样
    expect(fake.commands.filter((c) => c.startsWith('for d in'))).toHaveLength(1)
  })

  it('r4 回归:采样 rc≠0(10020)宽限——stdout 里的样本照常解析告警', async () => {
    // 真机定位:glob 兜底路径无匹配使 for 循环退出码非零,但已命中的 tail 输出
    // 完好;旧代码 if (r.code !== 0) return 把 100 条能量样本整个丢弃 → 零告警
    const fake = {
      commands: [] as string[],
      async execCommand(_c: string, command: string): Promise<ExecResult> {
        if (command.startsWith('sacct')) return { code: 0, data: rowFull('100', 'RUNNING', '30', '/w/A', '04:00:00'), message: '' }
        if (command.startsWith('for d in')) {
          return { code: 10020, data: { stdout: `=== /w/A\n${OSC_DONES}`, stderr: 'tail: no match', exitCode: 1 }, message: 'remote shell command failed' }
        }
        throw new Error(`unexpected: ${command.slice(0, 60)}`)
      },
    }
    const loop = createWatchLoop({
      clusterId: '11250', jobIds: ['100'], maxWaitMs: 86_400_000,
      scfSampling: {
        intervalMs: 10_000,
        buildCommand: (ws) => `for d in ${ws.map((w) => `'${w}'`).join(' ')}; do echo "=== $d"; tail x; done`,
        parse: (o) => parseScfSamples(o),
        onTrend: () => {},
      },
      execCommand: fake.execCommand,
      scheduleTimeout: (cb, ms) => setTimeout(cb, ms),
      clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    })
    await advance(0)
    loop.readOutput()
    await advance(10_000)
    await advance(10_000) // 两窗确认
    const out = loop.readOutput()
    expect(out).toContain('scf_trend: job 100 oscillating')
    loop.cancel('done')
  })

  it('采样失败(exec 抛错)不连坐:状态轮询与结算照常', async () => {
    const fake = routingExec({ sacct: () => rowFull('100', 'RUNNING', '30', '/w/A', '04:00:00') }) // sample 未注册 → 抛错
    const loop = createWatchLoop({
      clusterId: '11250',
      jobIds: ['100'],
      maxWaitMs: 25_000,
      scfSampling: {
        intervalMs: 10_000,
        buildCommand: (workdirs) => `for d in ${workdirs.map((w) => `'${w}'`).join(' ')}; do echo "=== $d"; tail -n 200 x; done`,
        parse: (o) => parseScfSamples(o),
      },
      execCommand: fake.execCommand,
      scheduleTimeout: (cb, ms) => setTimeout(cb, ms),
      clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    })
    await advance(0)
    await advance(10_000) // 采样窗 1:exec 抛错被吞
    await advance(10_000)
    await advance(10_000)
    const outcome = await loop.done
    expect(outcome.status).toBe('completed') // max-wait 正常结算
    expect(outcome.detail).toContain('max-wait exceeded')
  })
})

describe('jitterRatio(批量去同步)', () => {
  it('抖动比 0.4:延迟落在 [d×0.6, d×1.4];缺省不抖动', async () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0) // 恒取下界
    const fake = fakeExec([{ out: row('100', 'RUNNING') }])
    const loop = createWatchLoop({
      clusterId: '11250',
      jobIds: ['100'],
      maxWaitMs: 86_400_000,
      jitterRatio: 0.4,
      execCommand: fake.execCommand,
      scheduleTimeout: (cb, ms) => setTimeout(cb, ms),
      clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    })
    await advance(0) // 首跳 delay 0,不抖
    await advance(5_999) // 10s×0.6=6s:未到
    expect(fake.commands.length).toBe(1)
    await advance(1_000) // t=6s:抖动下界恰好到
    expect(fake.commands.length).toBe(2)
    loop.cancel('done')
    randomSpy.mockRestore()

    const randomSpy2 = vi.spyOn(Math, 'random').mockReturnValue(1) // 恒取上界
    const fake2 = fakeExec([{ out: row('100', 'RUNNING') }])
    const loop2 = createWatchLoop({
      clusterId: '11250',
      jobIds: ['100'],
      maxWaitMs: 86_400_000,
      jitterRatio: 0.4,
      execCommand: fake2.execCommand,
      scheduleTimeout: (cb, ms) => setTimeout(cb, ms),
      clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    })
    await advance(0)
    await advance(13_999) // 10s×1.4=14s:未到
    expect(fake2.commands.length).toBe(1)
    await advance(1_000) // t=14s:抖动上界到
    expect(fake2.commands.length).toBe(2)
    loop2.cancel('done')
    randomSpy2.mockRestore()
  })
})
