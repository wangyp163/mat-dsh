import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecResult } from '../src/client'
import {
  DEFAULT_CALCULATOR_VASP_COMMAND,
  DEFAULT_MATSTREAM_ENV,
  DEFAULT_VASP_ENV,
  DEFAULT_VASP_PARTITION,
  DEFAULT_VASP_TIME,
  MATSTREAM_WORKFLOW_VERSION,
  createLegacyVaspWorkflowAdapter,
  createVaspProducerHooks,
  formatVaspConfirmationSummary,
  harvestVaspCommand,
  parseVaspHarvestOutput,
  parseVaspWalltimeHours,
  prepareVaspInputsCommand,
  renderVaspSlurmScript,
  runVaspSync,
  estimateVaspCoreHours,
  submitVaspSbatchCommand,
  summarizeVaspPre,
  validateVaspChain,
  vaspConfirmationDigest,
  vaspDiagnosticTextOf,
  vaspPropertiesOf,
  vaspStructureFilename,
} from '../src/vasp'

// 语义对齐 matstream 引擎 v0.1.3 CLI 契约与 matstream-agent 生产模板：
// 作业内整链执行（apptainer sif + `matstream run`）、matstream.json 收割、
// OSZICAR/OUTCAR 收敛探针（引擎自身无收敛检查，dsh 侧补偿）。

const POSCAR = [
  'MoS2',
  '1.0',
  ' 3.160000 0.000000 0.000000',
  '-1.580000 2.735646 0.000000',
  ' 0.000000 0.000000 18.000000',
  'Mo S',
  '1 2',
  'direct',
  ' 0.333333 0.666667 0.250000',
  ' 0.666667 0.333333 0.250000',
  ' 0.333333 0.666667 0.250000',
  '',
].join('\n')

describe('validateVaspChain', () => {
  it('合法链：分号分隔、trim/lowercase 归一', () => {
    expect(validateVaspChain('relax;scf;band')).toEqual(['relax', 'scf', 'band'])
    expect(validateVaspChain(' Relax ; SCF ')).toEqual(['relax', 'scf'])
  })

  it('空链 → INVALID_VASP_CHAIN 前缀错误', () => {
    expect(() => validateVaspChain('  ;  ')).toThrow(/^INVALID_VASP_CHAIN: empty/)
  })

  it('未知任务 → 点名未知项并列出注册表', () => {
    expect(() => validateVaspChain('relax;dos')).toThrow(/unknown task\(s\) \[dos\][\s\S]*relax, scf, band/)
  })
})

describe('结构文件名（ASE 按文件名嗅探格式）', () => {
  it('poscar→POSCAR（前缀命中 vasp 格式）；cif/xyz 走扩展名', () => {
    expect(vaspStructureFilename('poscar')).toBe('POSCAR')
    expect(vaspStructureFilename('cif')).toBe('structure.cif')
    expect(vaspStructureFilename('xyz')).toBe('structure.xyz')
  })
})

describe('renderVaspSlurmScript', () => {
  const script = renderVaspSlurmScript({
    tasks: 'relax;scf;band', preset: 'medium', mode: 'nospin',
    partition: 'kshcnormal', time: '24:00:00', nodes: 1, ntasksPerNode: 32,
    workflowEnv: DEFAULT_MATSTREAM_ENV, vaspEnv: DEFAULT_VASP_ENV, vaspCommand: DEFAULT_CALCULATOR_VASP_COMMAND,
    structureFilename: 'POSCAR',
  })

  it('SBATCH 头：作业名/节点/分区/时限', () => {
    expect(script).toContain('#SBATCH -J ms-relax-scf-band')
    expect(script).toContain('#SBATCH -N 1')
    expect(script).toContain('#SBATCH --ntasks-per-node=32')
    expect(script).toContain('#SBATCH -p kshcnormal')
    expect(script).toContain('#SBATCH --time=24:00:00')
  })

  it('vasp_env 先于 workflow_env 双 source；CALCULATOR_VASP_COMMAND 启动覆盖在位', () => {
    expect(script.indexOf('source /etc/profile')).toBeLessThan(script.indexOf(`source ${DEFAULT_VASP_ENV}`))
    expect(script.indexOf(`source ${DEFAULT_VASP_ENV}`)).toBeLessThan(script.indexOf(`source ${DEFAULT_MATSTREAM_ENV}`))
    expect(script).toContain(`export CALCULATOR_VASP_COMMAND='${DEFAULT_CALCULATOR_VASP_COMMAND}'`)
  })

  it('整链命令直接调 matstream（家目录 env）；cwd 先于执行行', () => {
    expect(script).toContain(`matstream run -c vasp -t 'relax;scf;band' -f POSCAR -p medium -m nospin`)
    expect(script.indexOf('cd "$SLURM_SUBMIT_DIR"')).toBeLessThan(script.indexOf('matstream run'))
    expect(script).not.toContain('apptainer')
  })
})

describe('prepareVaspInputsCommand（单往返：mkdir + 双 heredoc + 落盘校验）', () => {
  const slurm = renderVaspSlurmScript({
    tasks: 'relax', preset: 'medium', mode: 'nospin',
    partition: DEFAULT_VASP_PARTITION, time: DEFAULT_VASP_TIME,
    nodes: 1, ntasksPerNode: 32, workflowEnv: DEFAULT_MATSTREAM_ENV,
    vaspEnv: DEFAULT_VASP_ENV, vaspCommand: DEFAULT_CALCULATOR_VASP_COMMAND, structureFilename: 'POSCAR',
  })
  const cmd = prepareVaspInputsCommand({ workdir: '/home/u/w', structure: POSCAR, structureFilename: 'POSCAR', slurmScript: slurm })

  it('mkdir + 双 quoted heredoc + MISSING 校验 + PREP_READY 全在首逻辑行', () => {
    expect(cmd).toContain('mkdir -p "/home/u/w"')
    expect(cmd).toContain(`cat > "/home/u/w/POSCAR" << 'XEOF'`)
    expect(cmd).toContain(`cat > "/home/u/w/slurm.sh" << 'SEOF'`)
    expect(cmd).toContain('[ -s "/home/u/w/$f" ] || echo "MISSING:$f"')
    expect(cmd).toContain('echo PREP_READY')
  })

  it('heredoc 体顺序：结构体在 XEOF 前、slurm 体在 SEOF 前（quoted 定界防展开）', () => {
    expect(cmd).toContain(POSCAR.trim())
    const bodyStart = cmd.indexOf(POSCAR.trim())
    const xeof = cmd.indexOf('XEOF', bodyStart) // 结构体之后的体尾定界
    const slurmStart = cmd.indexOf('#!/bin/bash')
    const seof = cmd.indexOf('SEOF', slurmStart)
    expect(xeof).toBeGreaterThan(bodyStart)
    expect(slurmStart).toBeGreaterThan(xeof)
    expect(seof).toBeGreaterThan(slurmStart)
    expect(cmd.trimEnd().endsWith('SEOF')).toBe(true)
  })

  it('slurm 体内的 $ 变量原样保留（不被本地展开）', () => {
    expect(cmd).toContain('cd "$SLURM_SUBMIT_DIR"')
    expect(cmd).toContain('source $HOME/workspace/matstream/env.sh')
  })
})

describe('submit / harvest 命令', () => {
  it('submitVaspSbatchCommand：workdir 根提交（与 gaussian 的 task 子目录不同）', () => {
    expect(submitVaspSbatchCommand('/home/u/w')).toBe('cd "/home/u/w" && sbatch slurm.sh')
  })

  it('harvestVaspCommand：四个分节锚 + 收敛探针 + 日志尾', () => {
    const cmd = harvestVaspCommand('/home/u/w')
    expect(cmd).toContain(`cd "/home/u/w"`)
    for (const anchor of ['--- matstream.json ---', '--- task_dirs ---', '--- probes ---', '--- job_log_tail ---']) {
      expect(cmd).toContain(`echo '${anchor}'`)
    }
    expect(cmd).toContain("grep -c 'reached required accuracy'")
    expect(cmd).toContain(`tail -n 30 ms-job.out`)
  })
})

const HARVEST_OK = [
  '--- matstream.json ---',
  '{',
  '    "context": "Relax 完成\\nScf 完成，费米能级 0.123 eV",',
  '    "files": ["/home/u/w/Task.1.Relax/OUTCAR", "/home/u/w/Task.2.Scf/CONTCAR"],',
  '    "image": ["/home/u/w/Task.3.Band/band_cleanup.png"],',
  '    "slurm_path": "/home/u/w/Task.1.Relax/slurm.sh"',
  '}',
  '--- task_dirs ---',
  'Task.1.Relax',
  'Task.2.Scf',
  'Task.3.Band',
  '--- probes ---',
  'probe: Task.1.Relax',
  '  F= -.12345678E+02E0   -.12345678E+02E0',
  'reached required accuracy - stopping structural energy minimisation',
  'accuracy_marker_count: 1',
  '  energy  without entropy=   -12.345678  energy(SD)=  -12.345678',
  'probe: Task.2.Scf',
  '  F= -.12400000E+02E0',
  'accuracy_marker_count: 0',
  '  energy  without entropy=   -12.400000  energy(SD)=  -12.400000',
  'probe: Task.3.Band',
  'no OSZICAR',
  '  energy  without entropy=   -11.000000  energy(SD)=  -11.000000',
  '--- job_log_tail ---',
  'MatStream workflow finished',
].join('\n')

describe('parseVaspHarvestOutput', () => {
  it('成功收割：多行 matstream.json 整块解析 + 任务清单 + 探针归并', () => {
    const r = parseVaspHarvestOutput(HARVEST_OK)
    expect(r.hasResultJson).toBe(true)
    expect(r.engineError).toBeUndefined()
    expect(r.context).toContain('费米能级')
    expect(r.files).toHaveLength(2)
    expect(r.images).toEqual(['/home/u/w/Task.3.Band/band_cleanup.png'])
    expect(r.slurmPath).toBe('/home/u/w/Task.1.Relax/slurm.sh')
    expect(r.taskDirs).toEqual(['Task.1.Relax', 'Task.2.Scf', 'Task.3.Band'])
    expect(r.probes).toHaveLength(3)
    expect(r.probes[0]).toMatchObject({ taskDir: 'Task.1.Relax', accuracyMarkerCount: 1, energy: -12.345678 })
    expect(r.probes[1]).toMatchObject({ taskDir: 'Task.2.Scf', accuracyMarkerCount: 0, energy: -12.4 })
    expect(r.probes[2]).toMatchObject({ taskDir: 'Task.3.Band', energy: -11.0 })
    expect(r.jobLogTail).toContain('MatStream workflow finished')
  })

  it('error 壳：error 键提取（引擎失败不得当成功透传）', () => {
    const out = HARVEST_OK.replace(/"context": ".*",/, '"error": "错误: VASP_COMMAND did not execute successfully",')
    const r = parseVaspHarvestOutput(out)
    expect(r.engineError).toContain('VASP_COMMAND')
    expect(r.context).toBeUndefined()
  })

  it('matstream.json 缺席：字段缺省不抛（收割是诊断性读取）', () => {
    const out = HARVEST_OK.replace(/--- matstream\.json ---[\s\S]*?--- task_dirs ---/, '--- matstream.json ---\n(no matstream.json)\n--- task_dirs ---')
    const r = parseVaspHarvestOutput(out)
    expect(r.hasResultJson).toBe(false)
    expect(r.files).toEqual([])
    expect(r.taskDirs).toHaveLength(3)
  })

  it('stdout 单行 JSON 回退契约（引擎 stdout 与文件同源）', () => {
    const out = HARVEST_OK.replace('{\n    "context": "Relax 完成\\nScf 完成，费米能级 0.123 eV",\n    "files": ["/home/u/w/Task.1.Relax/OUTCAR", "/home/u/w/Task.2.Scf/CONTCAR"],\n    "image": ["/home/u/w/Task.3.Band/band_cleanup.png"],\n    "slurm_path": "/home/u/w/Task.1.Relax/slurm.sh"\n}',
      '{"context":"ok","files":["a"],"image":[],"slurm_path":"s"}')
    const r = parseVaspHarvestOutput(out)
    expect(r.hasResultJson).toBe(true)
    expect(r.files).toEqual(['a'])
  })
})

describe('vaspPropertiesOf（headline 取数与收敛判定）', () => {
  it('relax;scf;band：headline energy 取末位自洽任务（scf），band 非自洽不入选', () => {
    const p = vaspPropertiesOf(parseVaspHarvestOutput(HARVEST_OK))
    expect(p['energy']).toBe(-12.4)
    expect(p['energy_per_task_eV']).toEqual({
      'Task.1.Relax': -12.345678,
      'Task.2.Scf': -12.4,
      'Task.3.Band': -11.0,
    })
  })

  it('relax 族 accuracy 标记 → converged；全自洽链（无 relax）不设 converged 键', () => {
    expect(vaspPropertiesOf(parseVaspHarvestOutput(HARVEST_OK))['converged']).toBe(true)
    const noRelax = HARVEST_OK.replace(/probe: Task\.1\.Relax[\s\S]*?probe: Task\.2\.Scf/, 'probe: Task.2.Scf')
      .replace('Task.1.Relax\nTask.2.Scf\nTask.3.Band', 'Task.2.Scf\nTask.3.Band')
    const p = vaspPropertiesOf(parseVaspHarvestOutput(noRelax))
    expect(p['converged']).toBeUndefined()
    expect(p['energy']).toBe(-12.4) // 仍取末位自洽（scf）
  })

  it('relax 未收敛（marker 0）→ converged=false', () => {
    const out = HARVEST_OK.replace('accuracy_marker_count: 1', 'accuracy_marker_count: 0')
    expect(vaspPropertiesOf(parseVaspHarvestOutput(out))['converged']).toBe(false)
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

describe('runVaspSync（prepare→sbatch 两段）', () => {
  const scripted = () => [
    { match: (c: string) => c.includes('PREP_READY') || c.includes('mkdir -p'), result: ok('PREP_READY\n') },
    { match: (c: string) => c.includes('sbatch slurm.sh'), result: ok('Submitted batch job 122832841\n') },
  ]

  it('两段命令依序执行，返回 slurmJobId', async () => {
    const f = fakeExec(scripted())
    const r = await runVaspSync({
      execCommand: f.execCommand, clusterId: '11250',
      tasks: 'relax;scf;band', structure: POSCAR, structureFilename: 'POSCAR',
      workdir: '/home/u/w',
    })
    expect(r.slurmJobId).toBe('122832841')
    expect(f.calls).toHaveLength(2)
    expect(f.calls[0]).toContain('mkdir -p "/home/u/w"')
    expect(f.calls[0]).toContain(`-t 'relax;scf;band'`)
    expect(f.calls[1]).toBe('cd "/home/u/w" && sbatch slurm.sh')
  })

  it('自定义 partition/time/env 透传进 slurm 渲染', async () => {
    const f = fakeExec(scripted())
    await runVaspSync({
      execCommand: f.execCommand, clusterId: '11250',
      tasks: 'scf', structure: POSCAR, structureFilename: 'POSCAR',
      workdir: '/home/u/w', partition: 'kshc2', time: '48:00:00',
      options: { workflowEnv: '$HOME/workspace/ms2/env.sh', vaspEnv: '$HOME/workspace/vasp2/env.sh' },
    })
    expect(f.calls[0]).toContain('#SBATCH -p kshc2')
    expect(f.calls[0]).toContain('#SBATCH --time=48:00:00')
    expect(f.calls[0]).toContain('source $HOME/workspace/ms2/env.sh')
    expect(f.calls[0]).toContain('source $HOME/workspace/vasp2/env.sh')
  })

  it('落盘校验 MISSING → 抛错点名缺失文件', async () => {
    const f = fakeExec([
      { match: (c: string) => c.includes('mkdir -p'), result: ok('MISSING:slurm.sh\nPREP_READY\n') },
    ])
    await expect(runVaspSync({
      execCommand: f.execCommand, clusterId: '11250',
      tasks: 'scf', structure: POSCAR, structureFilename: 'POSCAR', workdir: '/home/u/w',
    })).rejects.toThrow(/input files not written.*slurm\.sh/)
  })

  it('sbatch 失败 → parseSbatchSubmission 透传抛错', async () => {
    const f = fakeExec([
      { match: (c: string) => c.includes('mkdir -p'), result: ok('PREP_READY\n') },
      { match: (c: string) => c.includes('sbatch slurm.sh'), result: ok('sbatch: error: invalid partition specified\n') },
    ])
    await expect(runVaspSync({
      execCommand: f.execCommand, clusterId: '11250',
      tasks: 'scf', structure: POSCAR, structureFilename: 'POSCAR', workdir: '/home/u/w',
    })).rejects.toThrow(/sbatch failed/)
  })
})

describe('createVaspProducerHooks（watch 终态后自动收割）', () => {
  const row = (id: string, state: string, exit = '0:0', elapsed = '0') => `${id}|${state}|${exit}|${elapsed}\n`

  function makeProducer(script: Array<{ out?: string; rcFail?: boolean; throw?: string }>, opts: { diagnose?: (t: string) => Array<{ id: string; path: string }> } = {}) {
    let i = 0
    const commands: string[] = []
    const execCommand = async (_clusterId: string, command: string): Promise<ExecResult> => {
      commands.push(command)
      const step = script[Math.min(i++, script.length - 1)]
      if (step.throw !== undefined) throw new Error(step.throw)
      if (step.rcFail) return { code: 10020, data: { stdout: '', stderr: 'boom', exitCode: 1 }, message: 'remote fail' }
      return { code: 0, data: step.out ?? '', message: 'success' }
    }
    const hooks = createVaspProducerHooks({
      execCommand,
      clusterId: '11250',
      tasks: 'relax;scf;band',
      workdir: '/home/u/w',
      slurmJobId: '700',
      ...(opts.diagnose !== undefined ? { diagnose: opts.diagnose } : {}),
    })
    return { hooks, commands }
  }

  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })
  const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms)

  it('COMPLETED → 自动收割：终态首读带 energy/converged/task_dirs/files/plots', async () => {
    const { hooks, commands } = makeProducer([
      { out: row('700', 'RUNNING') },
      { out: row('700', 'COMPLETED', '0:0', '30') },
      { out: HARVEST_OK },
    ])
    await advance(0)
    await advance(10_000)
    const outcome = await hooks.done
    expect(outcome.status).toBe('completed')
    expect(outcome.detail).toContain('E=-12.4')
    expect(outcome.detail).toContain('relax_converged=true')
    const output = hooks.readOutput()
    expect(output).toContain('slurm_state: COMPLETED')
    expect(output).toContain('converged: true')
    expect(output).toContain('"Task.2.Scf":-12.4')
    expect(output).toContain('task_dirs: Task.1.Relax, Task.2.Scf, Task.3.Band')
    expect(output).toContain('files: /home/u/w/Task.1.Relax/OUTCAR')
    expect(output).toContain('band_cleanup.png')
    // 收割命令只跑一次且只读
    expect(commands.filter((c) => c.includes('matstream.json'))).toHaveLength(1)
  })

  it('COMPLETED 但引擎 error 壳 → 结构化标注不判作业失败（防御分支）', async () => {
    const errorHarvest = HARVEST_OK.replace(/"context": ".*",/, '"error": "错误: VASP_COMMAND did not execute successfully",')
    const { hooks } = makeProducer([
      { out: row('700', 'RUNNING') },
      { out: row('700', 'COMPLETED', '1:0', '30') },
      { out: errorHarvest },
    ])
    await advance(0)
    await advance(10_000)
    const outcome = await hooks.done
    expect(outcome.status).toBe('completed')
    expect(outcome.detail).toContain('engine reported error')
    expect(hooks.readOutput()).toContain('engine_error: 错误: VASP_COMMAND')
  })

  it('FAILED → 收割诊断（engine_error/log_tail 前缀契约）+ kb_hint', async () => {
    const errorHarvest = HARVEST_OK.replace(/"context": ".*",/, '"error": "错误: ZBRENT: fatal",')
    const { hooks } = makeProducer(
      [
        { out: row('700', 'RUNNING') },
        { out: row('700', 'FAILED', '1:0', '30') },
        { out: errorHarvest },
      ],
      { diagnose: () => [{ id: 'vasp-zbrent', path: 'references/errors/vasp-zbrent.md' }] },
    )
    await advance(0)
    await advance(10_000)
    const outcome = await hooks.done
    expect(outcome.status).toBe('completed')
    expect(outcome.detail).toContain('FAILED, harvest attached')
    const output = hooks.readOutput()
    expect(output).toContain('slurm_state: FAILED')
    expect(output).toContain('engine_error: 错误: ZBRENT: fatal')
    expect(output).toContain('log_tail: ')
    expect(output).toContain('kb_hint: kb:vasp-zbrent')
  })

  it('收割 exec 失败 → 不判作业失败，状态行照常', async () => {
    const { hooks } = makeProducer([
      { out: row('700', 'RUNNING') },
      { out: row('700', 'COMPLETED', '0:0', '30') },
      { throw: 'transport dead' },
    ])
    await advance(0)
    await advance(10_000)
    const outcome = await hooks.done
    expect(outcome.status).toBe('completed')
    expect(hooks.readOutput()).toContain('slurm_state: COMPLETED')
  })

  it('vaspDiagnosticTextOf：只取诊断前缀行，无命中回退整段', () => {
    const text = ['slurm_state: FAILED', 'engine_error: 错误: X', 'log_tail: tail lines'].join('\n')
    expect(vaspDiagnosticTextOf(text)).toBe('engine_error: 错误: X\nlog_tail: tail lines')
    expect(vaspDiagnosticTextOf('plain text')).toBe('plain text')
  })
})

describe('确认闸投影与摘要', () => {
  it('parseVaspWalltimeHours：HH:MM[:SS] 与 D-HH:MM:SS；非法 null', () => {
    expect(parseVaspWalltimeHours('24:00:00')).toBe(24)
    expect(parseVaspWalltimeHours('0:30')).toBe(0.5)
    expect(parseVaspWalltimeHours('2-12:00:00')).toBe(60)
    expect(parseVaspWalltimeHours('abc')).toBeNull()
  })

  it('estimateVaspCoreHours：nodes×ntasks×hours', () => {
    expect(estimateVaspCoreHours(1, 32, '24:00:00')).toBe(768)
    expect(estimateVaspCoreHours(null, 32, '24:00:00')).toBeNull()
  })

  it('同配置同摘要同 digest；关键字段变更即变', () => {
    const base = summarizeVaspPre({ tasks: 'relax;scf', preset: 'medium', mode: 'nospin', partition: 'kshcnormal' })
    expect(base).toMatchObject({
      tasks: 'relax;scf', preset: 'medium', mode: 'nospin',
      partition: 'kshcnormal', nodes: 1, ntasksPerNode: 32,
      walltime: '24:00:00', estimatedCoreHours: 768, workflowVersion: MATSTREAM_WORKFLOW_VERSION,
    })
    expect(vaspConfirmationDigest(base)).toBe(vaspConfirmationDigest(summarizeVaspPre({ tasks: 'relax;scf', preset: 'medium', mode: 'nospin', partition: 'kshcnormal' })))
    expect(vaspConfirmationDigest(base)).not.toBe(vaspConfirmationDigest(summarizeVaspPre({ tasks: 'relax;scf', preset: 'slow', mode: 'nospin', partition: 'kshcnormal' })))
  })

  it('formatVaspConfirmationSummary：投影含任务链/资源/核时/引擎锚', () => {
    const summary = summarizeVaspPre({ tasks: 'relax;scf;band', preset: 'medium', mode: 'spin', partition: 'kshcnormal' })
    const text = formatVaspConfirmationSummary(summary, 'deadbeef')
    expect(text).toContain('relax;scf;band / medium / spin')
    expect(text).toContain('partition=kshcnormal')
    expect(text).toContain('768')
    expect(text).toContain(`matstream ${MATSTREAM_WORKFLOW_VERSION} ($HOME/workspace/matstream)`)
    expect(text).toContain('digest                   : deadbeef')
  })
})

describe('HPC VASP adapter', () => {
  it('exposes the in-job chain path behind the remote workflow adapter boundary', async () => {
    const calls: string[] = []
    const adapter = createLegacyVaspWorkflowAdapter({
      execute: async (request) => {
        calls.push(request.workflow.id)
        return { executionId: request.workdir, workdir: request.workdir }
      },
    })
    await expect(adapter.run({
      workflow: adapter.workflow,
      clusterId: '11250',
      workdir: '/home/u/w',
      inputs: { tasks: 'relax;scf', structure: POSCAR, structure_filename: 'POSCAR' },
    })).resolves.toMatchObject({ executionId: '/home/u/w' })
    expect(calls).toEqual(['vasp-matstream-chain'])
  })
})
