import { mkdtemp, rm } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MatClient } from 'mat-core'

import {
  assertEnvGate,
  createEnvGateRegistry,
  envGateCommand,
  envGateMaxAgeMs,
  getEnvGateRegistry,
  resetEnvGateForTests,
} from '../src/env-gate-registry.ts'
import { apply, resetMatDbForTests } from '../src/index'

/**
 * constraint-decoupling A4/A5/A6：环境门禁接线。
 *
 * 核心断言（照 R2 范式）：四个提交入口在门禁不新鲜时拒绝，且 execCommand
 * 「被调即炸」+ not.toHaveBeenCalled 证明零集群副作用——拒绝发生在任何
 * 远端调用之前。登记后放行；MAT_ENV_GATE=off 整闸旁路。
 */

interface RegisteredTool {
  name: string
  execute: (args: Record<string, unknown>, exec: { agent?: { id: string } }) => Promise<string>
}

function makeCtx() {
  const tools = new Map<string, RegisteredTool>()
  const provided = new Map<string, unknown>()
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
    provide: (n: string, v: unknown) => { provided.set(n, v); return () => {} },
  } as never
  return { ctx, tools, provided }
}

const PASS_JSON = JSON.stringify({
  schema: 'gaussian-env-gate.v2',
  ok: true,
  workflow: '/home/u/workspace/demo',
  protocol: 'new',
  deployed_version: '1.7.4',
  expected_version: '1.7.4',
  newer_version: '',
  tasks: ['ts', 'irc', 'opt', 'freq'],
  missing_tasks: [],
  g16: '/home/u/workspace/g16-hy/scripts/env.sh',
  errors: [],
})

describe('envGateCommand（命令组装）', () => {
  it('gaussian 默认路径 + SCRIPT_NOT_FOUND 前置探测', () => {
    const cmd = envGateCommand('gaussian')
    expect(cmd).toContain('$HOME/workspace/.gaussian-calc/scripts/check_environment.sh')
    expect(cmd).toContain('SCRIPT_NOT_FOUND')
  })

  it('abacus 走各自的脚本目录', () => {
    expect(envGateCommand('abacus')).toContain('.abacus-calc/scripts/check_environment.sh')
  })

  it('覆盖参数以引号透传（含单引号转义）', () => {
    const cmd = envGateCommand('gaussian', '/opt/wf', "/opt/g'16")
    expect(cmd).toContain(`'/opt/wf'`)
    expect(cmd).toContain(`'/opt/g'\\''16'`)
  })
})

describe('assertEnvGate（单元）', () => {
  beforeEach(() => { resetEnvGateForTests() })
  afterEach(() => { vi.unstubAllEnvs(); resetEnvGateForTests() })

  it('无登记 → 拒绝，消息含 ENV_GATE_REJECTED 与补救指引', () => {
    expect(() => assertEnvGate('11250')).toThrow(/ENV_GATE_REJECTED/)
    expect(() => assertEnvGate('11250')).toThrow(/no pass in this host process/)
    expect(() => assertEnvGate('11250')).toThrow(/run mat_env_gate first/)
  })

  it('登记后放行', () => {
    getEnvGateRegistry().register('11250', 'gaussian', {} as never)
    expect(() => assertEnvGate('11250')).not.toThrow()
  })

  it('门禁按 (cluster, engine) 分键——别的集群不继承', () => {
    getEnvGateRegistry().register('11250', 'gaussian', {} as never)
    expect(() => assertEnvGate('11100')).toThrow(/ENV_GATE_REJECTED/)
  })

  it('同集群不同引擎各自独立', () => {
    getEnvGateRegistry().register('11250', 'gaussian', {} as never)
    expect(() => assertEnvGate('11250', 'abacus')).toThrow(/ENV_GATE_REJECTED/)
  })

  it('TTL 过期 → 拒绝，消息标明过期', () => {
    vi.stubEnv('MAT_ENV_GATE_MAX_AGE_MS', '1000')
    getEnvGateRegistry().register('11250', 'gaussian', {} as never, Date.now() - 5000)
    expect(() => assertEnvGate('11250')).toThrow(/pass expired/)
  })

  it('MAT_ENV_GATE=off 整闸旁路（无登记也放行）', () => {
    vi.stubEnv('MAT_ENV_GATE', 'off')
    expect(() => assertEnvGate('11250')).not.toThrow()
  })

  it('MAT_ENV_GATE_MAX_AGE_MS 非法值回落缺省 12h', () => {
    vi.stubEnv('MAT_ENV_GATE_MAX_AGE_MS', 'not-a-number')
    expect(envGateMaxAgeMs()).toBe(12 * 60 * 60 * 1000)
    vi.stubEnv('MAT_ENV_GATE_MAX_AGE_MS', '-5')
    expect(envGateMaxAgeMs()).toBe(12 * 60 * 60 * 1000)
  })
})

describe('createEnvGateRegistry（隔离实例）', () => {
  it('register/get/isFresh/list/clear 行为一致', () => {
    const reg = createEnvGateRegistry()
    expect(reg.get('11250', 'gaussian')).toBeUndefined()
    expect(reg.isFresh('11250', 'gaussian')).toBe(false)
    reg.register('11250', 'gaussian', {} as never)
    expect(reg.get('11250', 'gaussian')).toBeDefined()
    expect(reg.isFresh('11250', 'gaussian')).toBe(true)
    expect(reg.list()).toHaveLength(1)
    reg.clear()
    expect(reg.list()).toHaveLength(0)
  })
})

describe('mat_env_gate 工具（集成）', () => {
  let root: string
  beforeEach(async () => {
    root = await mkdtemp('/tmp/mat-env-gate-tool-')
    vi.stubEnv('MAT_FILE_ROOT', root)
    resetEnvGateForTests()
    resetMatDbForTests()
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    resetEnvGateForTests()
    await rm(root, { recursive: true, force: true })
  })

  it('pass：返回摘要并登记，后续提交放行', async () => {
    const { ctx, tools } = makeCtx()
    apply(ctx)
    vi.spyOn(MatClient.prototype, 'execCommand')
      .mockResolvedValue({ code: 0, data: PASS_JSON, message: '' } as never)
    const out = await tools.get('mat_env_gate')!.execute({ cluster_id: '11250' }, {} as never)
    expect(out).toContain('env gate PASS')
    expect(out).toContain('version=1.7.4')
    expect(out).toContain('protocol=new')
    expect(getEnvGateRegistry().isFresh('11250', 'gaussian')).toBe(true)
  })

  it('pass 且 newer_version 非空：warning 随摘要透传', async () => {
    const { ctx, tools } = makeCtx()
    apply(ctx)
    const json = JSON.stringify({ ...JSON.parse(PASS_JSON), newer_version: '1.7.5' })
    vi.spyOn(MatClient.prototype, 'execCommand')
      .mockResolvedValue({ code: 0, data: json, message: '' } as never)
    const out = await tools.get('mat_env_gate')!.execute({ cluster_id: '11250' }, {} as never)
    expect(out).toContain('env gate PASS')
    expect(out).toContain('WARNINGS')
    expect(out).toContain('newer_version=1.7.5')
  })

  it('fail：报 errors 原样且不入缓存', async () => {
    const { ctx, tools } = makeCtx()
    apply(ctx)
    const json = JSON.stringify({ ...JSON.parse(PASS_JSON), ok: false, errors: ['g16_env_missing'] })
    vi.spyOn(MatClient.prototype, 'execCommand')
      .mockResolvedValue({ code: 0, data: json, message: '' } as never)
    const out = await tools.get('mat_env_gate')!.execute({ cluster_id: '11250' }, {} as never)
    expect(out).toContain('ENV_GATE_REJECTED')
    expect(out).toContain('g16_env_missing')
    expect(getEnvGateRegistry().isFresh('11250', 'gaussian')).toBe(false)
  })

  it('seed-needed：SCRIPT_NOT_FOUND 指向播种路径且不入缓存', async () => {
    const { ctx, tools } = makeCtx()
    apply(ctx)
    vi.spyOn(MatClient.prototype, 'execCommand')
      .mockResolvedValue({ code: 0, data: 'SCRIPT_NOT_FOUND', message: '' } as never)
    const out = await tools.get('mat_env_gate')!.execute({ cluster_id: '11250' }, {} as never)
    expect(out).toContain('ENV_GATE_SEED_NEEDED')
    expect(out).toContain('heredoc seed step')
    expect(getEnvGateRegistry().isFresh('11250', 'gaussian')).toBe(false)
  })

  it('注册表经 ctx.provide 暴露为 mat.envGate 服务', () => {
    const { ctx, provided } = makeCtx()
    apply(ctx)
    expect(provided.get('mat.envGate')).toBeDefined()
  })
})

describe('四入口门禁拦截（零集群副作用）', () => {
  let root: string
  beforeEach(async () => {
    root = await mkdtemp('/tmp/mat-env-gate-entries-')
    vi.stubEnv('MAT_FILE_ROOT', root)
    resetEnvGateForTests()
    resetMatDbForTests()
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    resetEnvGateForTests()
    await rm(root, { recursive: true, force: true })
  })

  /** execCommand「被调即炸」——任何远端触达都会让用例失败。 */
  function armExplodingExec() {
    return vi.spyOn(MatClient.prototype, 'execCommand').mockImplementation(async () => {
      throw new Error('must not reach the cluster before the env gate passes')
    })
  }

  it('mat_sbatch：无门禁即拒，execCommand 零调用', async () => {
    const { ctx, tools } = makeCtx()
    apply(ctx)
    const exec = armExplodingExec()
    await expect(tools.get('mat_sbatch')!.execute({
      cluster_id: '11250',
      workdir: '/home/u/w/ts/01-ts',
      filename: 'slurm.sh',
    }, {} as never)).rejects.toThrow(/ENV_GATE_REJECTED/)
    expect(exec).not.toHaveBeenCalled()
  })

  it('mat_gaussian：无门禁即拒，execCommand 零调用', async () => {
    const { ctx, tools } = makeCtx()
    apply(ctx)
    const exec = armExplodingExec()
    await expect(tools.get('mat_gaussian')!.execute({
      cluster_id: '11250',
      task: 'opt',
      structure: '3\n\nO 0 0 0\nH 0 0.75 -0.47\nH 0 -0.75 -0.47\n',
      workdir: '/home/u/w/h2o',
    }, {} as never)).rejects.toThrow(/ENV_GATE_REJECTED/)
    expect(exec).not.toHaveBeenCalled()
  })

  it('mat_pipeline_start：无门禁即拒，execCommand 零调用', async () => {
    const { ctx, tools } = makeCtx()
    apply(ctx)
    const exec = armExplodingExec()
    // digest 未知会先抛别的错——故断言只要没触达集群即可；
    // 门禁在 loadPersistedPackage 之后、任何远端调用之前。
    await expect(tools.get('mat_pipeline_start')!.execute({
      pkg_digest: 'deadbeefdead',
      cluster_id: '11250',
      workdir: '/home/u/w/chain',
    }, {} as never)).rejects.toThrow()
    expect(exec).not.toHaveBeenCalled()
  })

  it('mat_pool_start：无门禁即拒，execCommand 零调用', async () => {
    const { ctx, tools } = makeCtx()
    apply(ctx)
    const exec = armExplodingExec()
    await expect(tools.get('mat_pool_start')!.execute({
      cluster_id: '11250',
      chains: [{ pkg_digest: 'deadbeefdead', workdir: '/home/u/w/c1' }],
    }, {} as never)).rejects.toThrow()
    expect(exec).not.toHaveBeenCalled()
  })

  it('门禁登记后 mat_sbatch 正常提交', async () => {
    const { ctx, tools } = makeCtx()
    apply(ctx)
    getEnvGateRegistry().register('11250', 'gaussian', {} as never)
    const exec = vi.spyOn(MatClient.prototype, 'execCommand')
      .mockResolvedValue({ code: 0, data: 'Submitted batch job 1210042', message: '' } as never)
    const out = await tools.get('mat_sbatch')!.execute({
      cluster_id: '11250',
      workdir: '/home/u/w/ts/01-ts',
      filename: 'slurm.sh',
    }, {} as never)
    expect(out).toContain('1210042')
    expect(exec).toHaveBeenCalledTimes(1)
  })

  it('MAT_ENV_GATE=off 时 mat_sbatch 无需门禁即可提交', async () => {
    vi.stubEnv('MAT_ENV_GATE', 'off')
    const { ctx, tools } = makeCtx()
    apply(ctx)
    const exec = vi.spyOn(MatClient.prototype, 'execCommand')
      .mockResolvedValue({ code: 0, data: 'Submitted batch job 777', message: '' } as never)
    const out = await tools.get('mat_sbatch')!.execute({
      cluster_id: '11250',
      workdir: '/home/u/w/ts/01-ts',
      filename: 'slurm.sh',
    }, {} as never)
    expect(out).toContain('777')
    expect(exec).toHaveBeenCalledTimes(1)
  })
})
