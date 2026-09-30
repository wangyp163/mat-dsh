import { mkdtemp, rm } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MatClient } from 'mat-core'

import { appendAttemptsLineCommand, attemptsLedgerLine, parseAttemptsLedgerRef } from '../src/attempts-ledger.ts'
import { apply } from '../src/index'

/**
 * R3 台账自动记账：mat_sbatch 传 attempts_ledger 后，
 * 提交成功的同接缝自动追加 submitted 行；追加失败旁路不连坐提交。
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

const REF = { file: '/home/u/w/attempts.jsonl', task: 'tsxtb+ts+irc', step: '02-ts', attempt: 1 }

describe('attempts-ledger（单元）', () => {
  it('无参数不受闸；字段缺失/类型错误即拒', () => {
    expect(parseAttemptsLedgerRef(undefined)).toBeUndefined()
    expect(() => parseAttemptsLedgerRef('x')).toThrow(/attempts_ledger must be an object/)
    expect(() => parseAttemptsLedgerRef({ file: '/a', task: 't' })).toThrow(/non-empty step/)
    expect(() => parseAttemptsLedgerRef({ ...REF, attempt: 0 })).toThrow(/positive integer/)
    expect(parseAttemptsLedgerRef({ file: '/a', task: 't', step: 's' })?.attempt).toBe(1)
  })

  it('行形状与既有 skill 契约逐字一致', () => {
    expect(attemptsLedgerLine(REF, '1210042'))
      .toBe('{"event":"submitted","task":"tsxtb+ts+irc","step":"02-ts","attempt":1,"jobid":"1210042"}')
  })

  it('printf 追加命令单引号安全', () => {
    const cmd = appendAttemptsLineCommand({ ...REF, task: "o'bsidian" }, '42')
    expect(cmd).toContain("printf '%s\\n' '")
    expect(cmd).toContain(' >> /home/u/w/attempts.jsonl')
    expect(cmd).toContain(`'\\''`)
  })
})

describe('mat_sbatch attempts_ledger 接线（集成）', () => {
  let root: string
  beforeEach(async () => {
    root = await mkdtemp('/tmp/mat-attempts-')
    vi.stubEnv('MAT_FILE_ROOT', root)
    // 环境门禁与本用例正交（本文件测的是别的闸）——整闸关闭，免得每例先跑一遍门禁
    vi.stubEnv('MAT_ENV_GATE', 'off')
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    await rm(root, { recursive: true, force: true })
  })

  function stubExecSequence(steps: Array<{ out: string; fail?: boolean }>): string[] {
    const commands: string[] = []
    const pending = [...steps]
    vi.spyOn(MatClient.prototype, 'execCommand').mockImplementation(async (_c, command) => {
      commands.push(command)
      const step = pending.shift()
      if (step === undefined) throw new Error(`unexpected extra command: ${command.slice(0, 90)}`)
      if (step.fail === true) throw new Error('remote append channel down')
      return { code: 0, data: step.out, message: '' }
    })
    return commands
  }

  it('提交成功后自动追加 submitted 行（第二条命令形状）', async () => {
    const { ctx, tools } = makeCtx()
    apply(ctx)
    const sbatch = tools.get('mat_sbatch')!
    const commands = stubExecSequence([{ out: 'Submitted batch job 1210042' }, { out: '' }])
    const out = await sbatch.execute({
      cluster_id: '11250',
      workdir: '/home/u/w/tsxtb+ts+irc/02-ts',
      filename: 'slurm.sh',
      attempts_ledger: { file: '/home/u/w/attempts.jsonl', task: 'tsxtb+ts+irc', step: '02-ts' },
    }, {} as never)
    expect(out).toContain('1210042')
    expect(commands).toHaveLength(2)
    expect(commands[1]).toContain('>> /home/u/w/attempts.jsonl')
    expect(commands[1]).toContain('"event":"submitted"')
    expect(commands[1]).toContain('"jobid":"1210042"')
  })

  it('追加失败旁路：提交仍成功返回', async () => {
    const { ctx, tools } = makeCtx()
    apply(ctx)
    const sbatch = tools.get('mat_sbatch')!
    const commands = stubExecSequence([{ out: 'Submitted batch job 99' }, { fail: true }])
    const out = await sbatch.execute({
      cluster_id: '11250',
      workdir: '/home/u/w/tsxtb+ts+irc/02-ts',
      filename: 'slurm.sh',
      attempts_ledger: { file: '/home/u/w/attempts.jsonl', task: 'tsxtb+ts+irc', step: '02-ts' },
    }, {} as never)
    expect(out).toContain('submitted batch job 99')
    expect(commands).toHaveLength(2)
  })

  it('不传 attempts_ledger：行为与旧版一致（仅一条 sbatch 命令）', async () => {
    const { ctx, tools } = makeCtx()
    apply(ctx)
    const sbatch = tools.get('mat_sbatch')!
    const commands = stubExecSequence([{ out: 'Submitted batch job 7' }])
    const out = await sbatch.execute({
      cluster_id: '11250',
      workdir: '/home/u/w/x',
      filename: 'slurm.sh',
    }, {} as never)
    expect(out).toContain('submitted batch job 7')
    expect(commands).toHaveLength(1)
  })
})
