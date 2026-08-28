import { describe, expect, it } from 'vitest'
import type { ExecResult } from '../src/client'
import {
  DEFAULT_G16_ENV,
  DEFAULT_WORKFLOW_ENV,
  defaultPreJson,
  defaultRunJson,
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

describe('默认配置', () => {
  it('defaultPreJson：schema/resources/ase 方法组完整', () => {
    expect(defaultPreJson()).toEqual({
      schema_version: 'gaussian_workflow.pre.v1',
      resources: { ncores: 32, memory: '64GB' },
      generator: { dialect: 'ase' },
      ase: {
        calculator_kwargs: {
          method: 'B3LYP', basis: '6-31G(d)', charge: 0, mult: 1,
          opt: ['Tight', 'CalcFC'], freq: 'HPModes',
        },
      },
      output: { input_file: 'job.gjf' },
    })
  })

  it('defaultRunJson：仅 slurm 块，分区缺省 Agent0', () => {
    expect(defaultRunJson()).toEqual({
      slurm: { partition: 'Agent0', nodes: 1, ntasks_per_node: 32, time: '00:30:00', mem: '64GB' },
    })
    expect(defaultRunJson('CPU64').slurm).toMatchObject({ partition: 'CPU64' })
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
