import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createWatchLoop } from '../src/watch-loop'
import type { ExecResult } from '../src/client'

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
    expect(fake.commands[0]).toBe("sacct -j 100 -P -n -o JobID,State,ExitCode,ElapsedRaw")
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
})
