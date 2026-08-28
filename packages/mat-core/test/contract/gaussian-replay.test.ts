import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ExecResult } from '../../src/client'
import { parsePostOutput, runGaussianSync } from '../../src/gaussian'

/**
 * 回放契约：M2 探针（2026-08-28，cluster 11250，水 opt+freq B3LYP/6-31G(d)）
 * 录制的 gaussian-workflow pre/run/post 原始 stdout，回放进同步段全链路与
 * post 解析器 —— phase 输出结构（calcflow.result.v1 单行 JSON + 环境加载行）、
 * `"status": "ok"` 判定、properties/files 提取一旦漂移即红。
 * 基准值（Python 时代实测）：E≈-76.408954 Ha、freqs≈[1713.13, 3727.17, 3849.10]、imag=0。
 */

const fx = (rel: string): string => readFileSync(join(import.meta.dirname, 'fixtures', rel), 'utf8')
const ok = (stdout: string): ExecResult => ({ code: 0, data: stdout, message: 'success' })

describe('契约回放：gaussian phase 原始输出（探针真实录制）', () => {
  it('pre 输出：环境加载行 + 单行 calcflow.result.v1，含 "status": "ok"（同步段判定命中）', () => {
    const stdout = fx('gaussian/pre-ok.stdout.txt')
    expect(stdout.startsWith('[GAUSSIAN-WORKFLOW-KSYZQ] Environment loaded')).toBe(true)
    expect(stdout).toContain('"status": "ok"')
    expect(stdout).toContain('"phase": "pre"')
    // 首个可解析 { 行即结果行（parsePostOutput 同款语义）
    const parsed = parsePostOutput(stdout)
    expect(parsed.files[0]).toContain('job.gjf')
    expect(parsed.properties).toEqual({})
  })

  it('run 输出：slurm 块回显 Agent0/32 核', () => {
    const stdout = fx('gaussian/run-ok.stdout.txt')
    expect(stdout).toContain('"status": "ok"')
    expect(stdout).toContain('"partition": "Agent0"')
    expect(stdout).toContain('"ntasks_per_node": 32')
  })

  it('post 输出：properties 基准三项近似通过（Python 交叉验证）', () => {
    const { properties, files } = parsePostOutput(fx('gaussian/post-ok.stdout.txt'))
    // E: |Δ| < 0.001 Ha
    expect(Math.abs((properties['energy'] as number) - (-76.408954))).toBeLessThan(0.001)
    // 三频各 |Δ| < 1.0 cm⁻¹
    const freqs = properties['frequencies_cm-1'] as number[]
    expect(freqs).toHaveLength(3)
    const baseline = [1713.13, 3727.17, 3849.10]
    freqs.forEach((f, i) => expect(Math.abs(f - baseline[i])).toBeLessThan(1.0))
    expect(properties['converged']).toBe(true)
    expect(properties['imaginary_frequency_count']).toBe(0)
    expect(files.some((f) => f.endsWith('g16_optimized.xyz'))).toBe(true)
  })
})

describe('契约回放：runGaussianSync 全链路（真实四段输出脚本化驱动）', () => {
  it('prepare(PREP_READY)→pre→run→sbatch 四段真实输出依序通过，取回录制 slurm id', async () => {
    const calls: string[] = []
    const script: Array<{ match: (cmd: string) => boolean; result: ExecResult }> = [
      { match: (c) => c.includes('PREP_READY') || c.includes('mkdir -p'), result: ok('PREP_READY\n') },
      { match: (c) => c.includes('-p pre'), result: ok(fx('gaussian/pre-ok.stdout.txt')) },
      { match: (c) => c.includes('-p run'), result: ok(fx('gaussian/run-ok.stdout.txt')) },
      { match: (c) => c.includes('sbatch slurm.sh'), result: ok('Submitted batch job 120283614\n') },
    ]
    const execCommand = async (_clusterId: string, command: string): Promise<ExecResult> => {
      calls.push(command)
      for (const s of script) if (s.match(command)) return s.result
      throw new Error(`unexpected command: ${command.slice(0, 60)}`)
    }
    const r = await runGaussianSync({
      execCommand, clusterId: '11250',
      task: 'opt+freq', structure: '3\n\nO 0 0 0.117790\nH 0 0.757160 -0.470790\nH 0 -0.757160 -0.470790\n',
      workdir: '/public/home/hpc-user-a/workspace/h2o-m2-probe',
    })
    expect(r.slurmJobId).toBe('120283614')
    expect(calls).toHaveLength(4)
  })
})
