import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecResult } from '../src/client'
import {
  DEFAULT_G16_ENV,
  DEFAULT_WORKFLOW_ENV,
  createGaussianProducerHooks,
  createLegacyGaussianWorkflowAdapter,
  defaultPreJson,
  defaultRunJson,
  logTailCommand,
  parsePostOutput,
  postPhaseCommand,
  prepareInputsCommand,
  prePhaseCommand,
  runGaussianSync,
  runPhaseCommand,
  submitSbatchCommand,
} from '../src/gaussian'

// 语义对齐 plugin.py gaussian_calc（§659-758）：默认 pre_json/run_json、
// 输入落盘校验（[ -s file ] || echo MISSING）、pre/run 阶段命令形态、
// "status": "ok" 判定、sbatch 于 workdir/task/slurm.sh。

const XYZ = '3\n\nO 0.000000 0.000000 0.117790\nH 0.000000 0.757160 -0.470790\nH 0.000000 -0.757160 -0.470790\n'

describe('HPC Gaussian adapter', () => {
  it('exposes the legacy command path behind the remote workflow adapter boundary', async () => {
    const calls: string[] = []
    const adapter = createLegacyGaussianWorkflowAdapter({
      execute: async (request) => {
        calls.push(request.workflow.id)
        return { executionId: request.workdir, workdir: request.workdir }
      },
    })
    await expect(adapter.run({
      workflow: adapter.workflow,
      clusterId: '11250',
      workdir: '/home/u/job',
      inputs: { task: 'opt', structure: XYZ, 'pre.json': {}, 'run.json': {}, 'post.json': {} },
    })).resolves.toMatchObject({ executionId: '/home/u/job' })
    expect(calls).toEqual(['gaussian-opt-freq'])
  })
})

describe('默认配置', () => {
  it('defaultPreJson：schema/resources/ase 方法组完整', () => {
    expect(defaultPreJson()).toEqual({
      schema_version: 'gaussian_workflow.pre.v1',
      resources: { ncores: 32, memory: '64GB' },
      generator: { dialect: 'ase' },
      ase: {
        calculator_kwargs: {
          method: 'B3LYP', basis: '6-31G(d)', charge: 0, mult: 1,
        },
      },
      output: { input_file: 'job.gjf' },
    })
  })

  it('defaultPreJson：不含任何 task 路由键（task 即路由身份，压测 P4 根因）', () => {
    const kwargs = (defaultPreJson().ase as { calculator_kwargs: Record<string, unknown> }).calculator_kwargs
    // 7 键清单的单一权威在 Python 侧（mat-aitool 仓）gaussian-workflow/gaussian_workflow/calculator.py 的
    // _COMPUTATION_ROUTE_KEYS；两侧若不同步，以 Python 侧为准更新本清单。
    for (const key of ['opt', 'freq', 'td', 'irc', 'polar', 'force', 'scan']) {
      expect(kwargs).not.toHaveProperty(key)
    }
  })

  it('defaultRunJson：仅 slurm 块，分区缺省 Agent0', () => {
    expect(defaultRunJson()).toEqual({
      slurm: { partition: 'Agent0', nodes: 1, ntasks_per_node: 32, time: '00:30:00', mem: '64GB' },
    })
    expect(defaultRunJson('CPU64').slurm).toMatchObject({ partition: 'CPU64' })
  })

  it('DEFAULT_PRODUCER_POLL_SECONDS = 30：一站式 producer 终态反映延迟封顶', async () => {
    const { DEFAULT_PRODUCER_POLL_SECONDS } = await import('../src/gaussian')
    expect(DEFAULT_PRODUCER_POLL_SECONDS).toBe(30)
  })
})

describe('命令构造', () => {
  it('prepareInputsCommand：单次调用打包 mkdir/heredoc/三 json/落盘校验（&& 链 + 尾部 heredoc 体）', () => {
    const cmd = prepareInputsCommand('/home/u/w', XYZ, { a: 1 }, { b: 2 })
    expect(cmd).toContain('mkdir -p "/home/u/w"')
    expect(cmd).toContain(`cat > "/home/u/w/molecule.xyz" << 'XEOF'`)
    expect(cmd).toContain(`echo '{"a":1}' > "/home/u/w/pre.json"`)
    expect(cmd).toContain(`echo '{"b":2}' > "/home/u/w/run.json"`)
    expect(cmd).toContain(`echo '{}' > "/home/u/w/post.json"`)
    expect(cmd).toContain('[ -s "/home/u/w/$f" ] || echo "MISSING:$f"')
    expect(cmd).toContain('echo PREP_READY')
    expect(cmd.endsWith(`${XYZ}XEOF`)).toBe(true)
    // heredoc 体前不能有 && 断链（结构未尾带换行时自动补，防 XEOF 粘连）
    expect(cmd).not.toContain(`XEOF &&\n`)
  })

  it('prePhaseCommand：cd + source + gaussian-workflow -p pre', () => {
    expect(prePhaseCommand('/home/u/w', 'opt+freq', DEFAULT_WORKFLOW_ENV))
      .toBe(`cd "/home/u/w" && source ${DEFAULT_WORKFLOW_ENV} && ` +
        'gaussian-workflow -t opt+freq -p pre -i molecule.xyz -w "/home/u/w" --json pre.json')
  })

  it('runPhaseCommand：GAUSSIAN_ENV_SCRIPT 在 source 前导出', () => {
    expect(runPhaseCommand('/home/u/w', 'opt', DEFAULT_WORKFLOW_ENV, DEFAULT_G16_ENV))
      .toBe(`cd "/home/u/w" && export GAUSSIAN_ENV_SCRIPT=${DEFAULT_G16_ENV} && source ${DEFAULT_WORKFLOW_ENV} && ` +
        'gaussian-workflow -t opt -p run -i molecule.xyz -w "/home/u/w" --json run.json')
  })

  it('submitSbatchCommand：workdir/task/slurm.sh', () => {
    expect(submitSbatchCommand('/home/u/w', 'opt+freq')).toBe('cd "/home/u/w/opt+freq" && sbatch slurm.sh')
  })
})

/** 脚本化 fake：按命令特征返回预置输出，记录调用序列。 */
function fakeExec(scripted: Array<{ match: (cmd: string) => boolean; result: ExecResult }>) {
  const calls: string[] = []
  const execCommand = async (_clusterId: string, command: string): Promise<ExecResult> => {
    calls.push(command)
    for (const s of scripted) {
      if (s.match(command)) return s.result
    }
    throw new Error(`unexpected command: ${command.slice(0, 80)}`)
  }
  return { execCommand, calls }
}

const ok = (stdout: string): ExecResult => ({ code: 0, data: stdout, message: '' })
const phaseOk = (phase: string): ExecResult => ok(`[${phase}] writing artifacts\n{"status": "ok", "phase": "${phase}"}\n`)

describe('runGaussianSync（prepare→pre→run→sbatch 全链路）', () => {
  const scripted = () => [
    { match: (c: string) => c.includes('PREP_READY') || c.includes('mkdir -p'), result: ok('PREP_READY\n') },
    { match: (c: string) => c.includes('-p pre'), result: phaseOk('pre') },
    { match: (c: string) => c.includes('-p run'), result: phaseOk('run') },
    { match: (c: string) => c.includes('sbatch slurm.sh'), result: ok('Submitted batch job 120275001\n') },
  ]

  it('四段命令依序执行，返回 slurmJobId', async () => {
    const f = fakeExec(scripted())
    const r = await runGaussianSync({
      execCommand: f.execCommand, clusterId: '11250',
      task: 'opt+freq', structure: XYZ, workdir: '/home/u/w',
    })
    expect(r.slurmJobId).toBe('120275001')
    expect(f.calls).toHaveLength(4)
    expect(f.calls[0]).toContain('mkdir -p "/home/u/w"')
    expect(f.calls[1]).toContain('-p pre')
    expect(f.calls[2]).toContain('GAUSSIAN_ENV_SCRIPT=')
    expect(f.calls[3]).toBe('cd "/home/u/w/opt+freq" && sbatch slurm.sh')
  })

  it('自定义 options 透传（workflow_env/g16_env/partition）', async () => {
    const f = fakeExec(scripted())
    await runGaussianSync({
      execCommand: f.execCommand, clusterId: '11250',
      task: 'opt', structure: XYZ, workdir: '/home/u/w', partition: 'CPU64',
      options: { workflowEnv: '/opt/we.sh', g16Env: '/opt/g16.sh' },
    })
    expect(f.calls[1]).toContain('source /opt/we.sh')
    expect(f.calls[2]).toContain('export GAUSSIAN_ENV_SCRIPT=/opt/g16.sh')
    expect(f.calls[0]).toContain('"partition":"CPU64"')
  })

  it('落盘校验 MISSING → 抛错点名缺失文件', async () => {
    const f = fakeExec([
      { match: (c: string) => c.includes('mkdir -p'), result: ok('MISSING:molecule.xyz\nPREP_READY\n') },
    ])
    await expect(runGaussianSync({
      execCommand: f.execCommand, clusterId: '11250',
      task: 'opt', structure: XYZ, workdir: '/home/u/w',
    })).rejects.toThrow(/MISSING.*molecule\.xyz/)
  })

  it('prepare 无 PREP_READY（命令链断裂）→ 抛错带输出', async () => {
    const f = fakeExec([
      { match: (c: string) => c.includes('mkdir -p'), result: ok('mkdir: cannot create directory\n') },
    ])
    await expect(runGaussianSync({
      execCommand: f.execCommand, clusterId: '11250',
      task: 'opt', structure: XYZ, workdir: '/home/u/w',
    })).rejects.toThrow(/prepare failed/)
  })

  it('pre 阶段无 "status": "ok" → 快速失败带输出尾部', async () => {
    const f = fakeExec([
      { match: (c: string) => c.includes('mkdir -p'), result: ok('PREP_READY\n') },
      { match: (c: string) => c.includes('-p pre'), result: ok('{"status": "error", "message": "bad structure"}\n') },
    ])
    await expect(runGaussianSync({
      execCommand: f.execCommand, clusterId: '11250',
      task: 'opt', structure: XYZ, workdir: '/home/u/w',
    })).rejects.toThrow(/pre phase failed[\s\S]*bad structure/)
  })

  it('run 阶段失败同样快速失败', async () => {
    const f = fakeExec([
      { match: (c: string) => c.includes('mkdir -p'), result: ok('PREP_READY\n') },
      { match: (c: string) => c.includes('-p pre'), result: phaseOk('pre') },
      { match: (c: string) => c.includes('-p run'), result: ok('workflow: unknown task type\n') },
    ])
    await expect(runGaussianSync({
      execCommand: f.execCommand, clusterId: '11250',
      task: 'opt', structure: XYZ, workdir: '/home/u/w',
    })).rejects.toThrow(/run phase failed/)
  })

  it('sbatch 无 Submitted 标记 → 抛错（parseSbatchSubmission 透传）', async () => {
    const f = fakeExec([
      { match: (c: string) => c.includes('mkdir -p'), result: ok('PREP_READY\n') },
      { match: (c: string) => c.includes('-p pre'), result: phaseOk('pre') },
      { match: (c: string) => c.includes('-p run'), result: phaseOk('run') },
      { match: (c: string) => c.includes('sbatch slurm.sh'), result: ok('sbatch: error: invalid partition\n') },
    ])
    await expect(runGaussianSync({
      execCommand: f.execCommand, clusterId: '11250',
      task: 'opt', structure: XYZ, workdir: '/home/u/w',
    })).rejects.toThrow(/sbatch failed/)
  })
})

// ===== post 段与 producer（终态自动 post）=====

const POST_OK_OUTPUT = [
  '[post] parsing job.log',
  '{"status": "ok", "phase": "post", "properties": {"energy": -76.408954, "converged": true, "frequencies_cm-1": [1713.13, 3727.17, 3849.10], "imaginary_frequency_count": 0}, "files": ["g16_optimized.xyz", "job.log"]}',
  '[post] done',
].join('\n')

describe('postPhaseCommand / logTailCommand', () => {
  it('postPhaseCommand 与 pre 同形态（-p post --json post.json）', () => {
    expect(postPhaseCommand('/home/u/w', 'opt+freq', DEFAULT_WORKFLOW_ENV))
      .toBe(`cd "/home/u/w" && source ${DEFAULT_WORKFLOW_ENV} && ` +
        'gaussian-workflow -t opt+freq -p post -i molecule.xyz -w "/home/u/w" --json post.json')
  })

  it('logTailCommand：tail 任务目录 job.log，无日志兜底', () => {
    const cmd = logTailCommand('/home/u/w', 'opt', 50)
    expect(cmd).toContain('tail -n 50 "/home/u/w/opt/job.log"')
    expect(cmd).toContain(`echo '(no job.log found)'`)
  })
})

describe('parsePostOutput（首个可解析 { 行，对齐 plugin.py §751-758）', () => {
  it('日志行 + JSON 行 → properties/files', () => {
    const r = parsePostOutput(POST_OK_OUTPUT)
    expect(r.properties).toMatchObject({ energy: -76.408954, converged: true, imaginary_frequency_count: 0 })
    expect(r.properties['frequencies_cm-1']).toEqual([1713.13, 3727.17, 3849.10])
    expect(r.files).toEqual(['g16_optimized.xyz', 'job.log'])
  })

  it('JSON 行带 plots → 透传；缺 plots → 空数组（旧版部署兼容）', () => {
    const withPlots = POST_OK_OUTPUT.replace(
      '"files": ["g16_optimized.xyz", "job.log"]',
      '"files": ["g16_optimized.xyz", "job.log"], ' +
        '"plots": [{"kind":"ir_spectrum","image":"/w/freq/ir_spectrum.png","data":"/w/freq/ir_spectrum.csv"}]',
    )
    const r1 = parsePostOutput(withPlots)
    expect(r1.plots).toEqual([
      { kind: 'ir_spectrum', image: '/w/freq/ir_spectrum.png', data: '/w/freq/ir_spectrum.csv' },
    ])
    const r2 = parsePostOutput(POST_OK_OUTPUT)
    expect(r2.plots).toEqual([])
  })

  it('首个 { 行非法 JSON → 继续找下一个', () => {
    const out = '{ oops not json\n{"properties": {"energy": -1}}\n'
    const r = parsePostOutput(out)
    expect(r.properties).toEqual({ energy: -1 })
    expect(r.files).toEqual([])
  })

  it('JSON 行缺 properties/files → 空对象/空数组', () => {
    const r = parsePostOutput('{"status": "ok"}\n')
    expect(r.properties).toEqual({})
    expect(r.files).toEqual([])
  })

  it('无任何 JSON 行 → 抛错带输出尾部', () => {
    expect(() => parsePostOutput('line1\nline2 error\n')).toThrow(/no JSON result line[\s\S]*line2 error/)
  })
})

describe('createGaussianProducerHooks（watch 终态后自动 post）', () => {
  const row = (id: string, state: string, exit = '0:0', elapsed = '0') => `${id}|${state}|${exit}|${elapsed}\n`

  function makeProducer(script: Array<{ out?: string; rcFail?: boolean; throw?: string }>, opts: { maxWaitSeconds?: number } = {}) {
    let i = 0
    const commands: string[] = []
    const execCommand = async (_clusterId: string, command: string): Promise<ExecResult> => {
      commands.push(command)
      const step = script[Math.min(i++, script.length - 1)]
      if (step.throw !== undefined) throw new Error(step.throw)
      if (step.rcFail) return { code: 10020, data: { stdout: '', stderr: 'boom', exitCode: 1 }, message: 'remote fail' }
      return { code: 0, data: step.out ?? '', message: 'success' }
    }
    const hooks = createGaussianProducerHooks({
      execCommand,
      clusterId: '11250',
      task: 'opt+freq',
      workdir: '/home/u/w',
      slurmJobId: '700',
      ...(opts.maxWaitSeconds !== undefined ? { maxWaitSeconds: opts.maxWaitSeconds } : {}),
    })
    return { hooks, commands }
  }

  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })
  const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms)

  it('COMPLETED → 自动 post：detail 摘要带 E/imag，终态首读带 properties/files', async () => {
    const { hooks, commands } = makeProducer([
      { out: row('700', 'RUNNING') },
      { out: row('700', 'COMPLETED', '0:0', '30') },
      { out: POST_OK_OUTPUT },
    ])
    await advance(0)
    await advance(10_000)
    const outcome = await hooks.done
    expect(outcome.status).toBe('completed')
    expect(outcome.detail).toBe('1/1 settled (1 COMPLETED); opt+freq E=-76.408954 converged=true imag=0')
    expect(commands.at(-1)).toContain('-p post')
    const out = hooks.readOutput()
    expect(out).toContain('slurm_state: COMPLETED')
    expect(out).toContain('"energy":-76.408954')
    expect(out).toContain('files: g16_optimized.xyz, job.log')
    expect(out).toContain('700 COMPLETED exit=0 elapsed=30s')
    expect(out).not.toContain('plots: ')
  })

  it('COMPLETED 且 post 带 plots → 终态首读含可解析的 plots JSON 行', async () => {
    const postWithPlots = POST_OK_OUTPUT.replace(
      '"files": ["g16_optimized.xyz", "job.log"]',
      '"files": ["g16_optimized.xyz", "job.log"], ' +
        '"plots": [{"kind": "uvvis_spectrum", "image": "/home/u/w/spec/uvvis_spectrum.png", ' +
        '"data": "/home/u/w/spec/uvvis_spectrum.csv"}]',
    )
    const { hooks } = makeProducer([
      { out: row('700', 'RUNNING') },
      { out: row('700', 'COMPLETED', '0:0', '30') },
      { out: postWithPlots },
    ])
    await advance(0)
    await advance(10_000)
    await hooks.done
    const plotsLine = hooks.readOutput().split('\n').find((l) => l.startsWith('plots: '))
    if (plotsLine === undefined) throw new Error('terminal first-read missing plots: line')
    expect(plotsLine).toContain('uvvis_spectrum')
    expect(JSON.parse(plotsLine.slice('plots: '.length))).toEqual([
      { kind: 'uvvis_spectrum', image: '/home/u/w/spec/uvvis_spectrum.png', data: '/home/u/w/spec/uvvis_spectrum.csv' },
    ])
  })

  it('FAILED → 跳过 post，log_tail 进输出，detail 标注', async () => {
    const { hooks, commands } = makeProducer([
      { out: row('700', 'RUNNING') },
      { out: row('700', 'FAILED', '1:0', '30') },
      { out: 'Error termination via Lnk1e in l103.exe\n' },
    ])
    await advance(0)
    await advance(10_000)
    const outcome = await hooks.done
    expect(outcome.detail).toBe('1/1 settled (1 FAILED); opt+freq FAILED, post skipped')
    expect(commands.some((c) => c.includes('-p post'))).toBe(false)
    const out = hooks.readOutput()
    expect(out).toContain('slurm_state: FAILED')
    expect(out).toContain('log_tail:')
    expect(out).toContain('Lnk1e')
  })

  it('COMPLETED 但 post 输出无 JSON → post failed 标注 + log_tail，结算仍 completed', async () => {
    const { hooks } = makeProducer([
      { out: row('700', 'COMPLETED') },
      { out: 'post crashed with traceback\n' },
      { out: 'gaussian log tail line\n' },
    ])
    await advance(0)
    const outcome = await hooks.done
    expect(outcome.status).toBe('completed')
    expect(outcome.detail).toBe('1/1 settled (1 COMPLETED); opt+freq COMPLETED but post failed')
    const out = hooks.readOutput()
    expect(out).toContain('post failed:')
    expect(out).toContain('post crashed with traceback')
    expect(out).toContain('gaussian log tail line')
  })

  it('maxWaitSeconds 透传（超时结算仍 completed，不跑 post）', async () => {
    const { hooks, commands } = makeProducer([{ out: row('700', 'RUNNING') }], { maxWaitSeconds: 5 })
    await advance(0)
    await advance(10_000)
    const outcome = await hooks.done
    expect(outcome.detail).toContain('max-wait')
    expect(commands.some((c) => c.includes('-p post'))).toBe(false)
  })
})

describe('producer 状态板喂料（onTick / onResult）', () => {
  const row = (id: string, state: string, exit = '0:0', elapsed = '0') => `${id}|${state}|${exit}|${elapsed}\n`

  function makeProducer(
    script: Array<{ out?: string; rcFail?: boolean; throw?: string }>,
    opts: {
      maxWaitSeconds?: number
      onTick?: (states: ReadonlyMap<string, import('../src/job-state').SlurmJobInfo>) => void
      onResult?: (result: import('../src/gaussian').GaussianProducerResult) => void
    } = {},
  ) {
    let i = 0
    const execCommand = async (_clusterId: string, command: string): Promise<ExecResult> => {
      void command
      const step = script[Math.min(i++, script.length - 1)]
      if (step.throw !== undefined) throw new Error(step.throw)
      if (step.rcFail) return { code: 10020, data: { stdout: '', stderr: 'boom', exitCode: 1 }, message: 'remote fail' }
      return { code: 0, data: step.out ?? '', message: 'success' }
    }
    const hooks = createGaussianProducerHooks({
      execCommand,
      clusterId: '11250',
      task: 'opt+freq',
      workdir: '/home/u/w',
      slurmJobId: '700',
      ...(opts.maxWaitSeconds !== undefined ? { maxWaitSeconds: opts.maxWaitSeconds } : {}),
      ...(opts.onTick !== undefined ? { onTick: opts.onTick } : {}),
      ...(opts.onResult !== undefined ? { onResult: opts.onResult } : {}),
    })
    return { hooks }
  }

  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })
  const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms)

  it('onTick 透传内层 watch：每成功轮触发，结算轮含终态', async () => {
    const ticks: string[] = []
    const { hooks } = makeProducer(
      [{ out: row('700', 'RUNNING') }, { out: row('700', 'COMPLETED', '0:0', '30') }, { out: POST_OK_OUTPUT }],
      { onTick: (states) => { ticks.push(states.get('700')?.state ?? 'MISSING') } },
    )
    await advance(0)
    expect(ticks).toEqual(['RUNNING'])
    await advance(10_000)
    await hooks.done
    expect(ticks).toEqual(['RUNNING', 'COMPLETED'])
  })

  it('onResult：COMPLETED+post 成功 → status/detail + properties/files（板终态喂料）', async () => {
    const results: Array<import('../src/gaussian').GaussianProducerResult> = []
    const { hooks } = makeProducer(
      [{ out: row('700', 'RUNNING') }, { out: row('700', 'COMPLETED', '0:0', '30') }, { out: POST_OK_OUTPUT }],
      { onResult: (r) => { results.push(r) } },
    )
    await advance(0)
    await advance(10_000)
    await hooks.done
    expect(results).toEqual([{
      status: 'completed',
      detail: '1/1 settled (1 COMPLETED); opt+freq E=-76.408954 converged=true imag=0',
      properties: { energy: -76.408954, converged: true, 'frequencies_cm-1': [1713.13, 3727.17, 3849.10], imaginary_frequency_count: 0 },
      files: ['g16_optimized.xyz', 'job.log'],
      plots: [],
    }])
  })

  it('onResult：FAILED 跳过 post → 无 properties/files，detail 标注', async () => {
    const results: Array<import('../src/gaussian').GaussianProducerResult> = []
    const { hooks } = makeProducer(
      [{ out: row('700', 'FAILED', '1:0', '30') }, { out: 'Error termination via Lnk1e\n' }],
      { onResult: (r) => { results.push(r) } },
    )
    await advance(0)
    await hooks.done
    expect(results).toEqual([{
      status: 'completed',
      detail: '1/1 settled (1 FAILED); opt+freq FAILED, post skipped',
      properties: undefined,
      files: undefined,
      plots: undefined,
    }])
  })

  it('onResult：cancel 路径也触发（status=killed，无物性）', async () => {
    const results: Array<import('../src/gaussian').GaussianProducerResult> = []
    const { hooks } = makeProducer(
      [{ out: row('700', 'RUNNING') }],
      { onResult: (r) => { results.push(r) } },
    )
    await advance(0)
    hooks.cancel('user asked')
    await hooks.done
    expect(results).toEqual([{ status: 'killed', detail: 'user asked', properties: undefined, files: undefined }])
  })
})
