import { describe, expect, it } from 'vitest'
import {
  ENV_GATE_SCHEMA,
  isEnvGateFresh,
  parseEnvGateStdout,
} from '../src/env-gate'
import type { EnvGateEntry, EnvGateVerdict } from '../src/env-gate'

/** constraint-decoupling A1：门禁判定纯函数单测。
 *
 * fixture 来源：SKILL.md 门禁节示例 JSON（pass）+ 各失败形态（synthetic，结构照原文构造）。
 * 判定规则照 SKILL.md 原文五条：ok / protocol=new / missing_tasks 空 /
 * deployed_version===expected_version / errors 空。
 */

const PASS_FIXTURE = JSON.stringify({
  schema: 'gaussian-env-gate.v2',
  ok: true,
  workflow: '/public/home/hpc-user-b/workspace/demo',
  python: '/public/home/hpc-user-b/workspace/demo/bin/python',
  cli: '/public/home/hpc-user-b/workspace/demo/bin/gaussian-workflow',
  module: '/public/home/hpc-user-b/workspace/demo/lib/python3.11/site-packages/gaussian_workflow/__init__.py',
  protocol: 'new',
  deployed_version: '1.7.4',
  expected_version: '1.7.4',
  newer_version: '',
  required_tasks: ['ts', 'irc', 'opt', 'freq'],
  tasks: ['ts', 'irc', 'opt', 'freq'],
  missing_tasks: [],
  task_count: 4,
  g16: '/public/home/hpc-user-b/workspace/g16-hy/scripts/env.sh',
  errors: [],
})

function withNoise(json: string): string {
  return 'Loaded modules: python/3.11\nActivating conda...\n' + json + '\n'
}

describe('parseEnvGateStdout — pass', () => {
  it('清洁单行 JSON pass 判定正确', () => {
    const r = parseEnvGateStdout(PASS_FIXTURE)
    expect(r.status).toBe('pass')
    expect(r.verdict).toBeDefined()
    expect(r.verdict!.deployedVersion).toBe('1.7.4')
    expect(r.verdict!.protocol).toBe('new')
    expect(r.verdict!.missingTasks).toEqual([])
    expect(r.verdict!.errors).toEqual([])
    expect(r.warnings).toEqual([])
  })

  it('混入噪声行时仍找到有效 JSON 并 pass', () => {
    const r = parseEnvGateStdout(withNoise(PASS_FIXTURE))
    expect(r.status).toBe('pass')
    expect(r.verdict!.deployedVersion).toBe('1.7.4')
  })

  it('newer_version 非空时 pass 并附 warning', () => {
    const json = JSON.stringify({
      ...JSON.parse(PASS_FIXTURE),
      newer_version: '1.7.5',
    })
    const r = parseEnvGateStdout(json)
    expect(r.status).toBe('pass')
    expect(r.warnings.length).toBe(1)
    expect(r.warnings[0]).toMatch(/newer_version=1\.7\.5/)
  })
})

describe('parseEnvGateStdout — fail', () => {
  it('ok=false → fail', () => {
    const json = JSON.stringify({ ...JSON.parse(PASS_FIXTURE), ok: false })
    const r = parseEnvGateStdout(json)
    expect(r.status).toBe('fail')
    expect(r.reason).toMatch(/ok=false/)
  })

  it('protocol!=new → fail', () => {
    const json = JSON.stringify({ ...JSON.parse(PASS_FIXTURE), protocol: 'legacy' })
    const r = parseEnvGateStdout(json)
    expect(r.status).toBe('fail')
    expect(r.reason).toMatch(/protocol='legacy'/)
  })

  it('missing_tasks 非空 → fail', () => {
    const json = JSON.stringify({ ...JSON.parse(PASS_FIXTURE), ok: false, missing_tasks: ['aea', 'qst3'] })
    const r = parseEnvGateStdout(json)
    expect(r.status).toBe('fail')
    expect(r.reason).toMatch(/missing_tasks=\[aea, qst3\]/)
  })

  it('版本漂移 → fail', () => {
    const json = JSON.stringify({ ...JSON.parse(PASS_FIXTURE), ok: false, deployed_version: '1.6.3', errors: ['version_mismatch'] })
    const r = parseEnvGateStdout(json)
    expect(r.status).toBe('fail')
    expect(r.reason).toMatch(/version drift/)
    expect(r.reason).toMatch(/errors=\[version_mismatch\]/)
  })

  it('errors 非空 → fail（全部缺陷收齐，不首条即返）', () => {
    const json = JSON.stringify({
      ...JSON.parse(PASS_FIXTURE),
      ok: false,
      protocol: 'legacy',
      errors: ['g16_env_missing'],
    })
    const r = parseEnvGateStdout(json)
    expect(r.status).toBe('fail')
    expect(r.reason).toMatch(/ok=false/)
    expect(r.reason).toMatch(/protocol='legacy'/)
    expect(r.reason).toMatch(/g16_env_missing/)
  })

  it('fail 时 verdict 仍在场（供调用方报告详情）', () => {
    const json = JSON.stringify({ ...JSON.parse(PASS_FIXTURE), ok: false })
    const r = parseEnvGateStdout(json)
    expect(r.status).toBe('fail')
    expect(r.verdict).toBeDefined()
  })
})

describe('parseEnvGateStdout — seed-needed', () => {
  it('stdout 含 SCRIPT_NOT_FOUND → seed-needed', () => {
    const r = parseEnvGateStdout('bash: check_environment.sh: command not found\nSCRIPT_NOT_FOUND\n')
    expect(r.status).toBe('seed-needed')
    expect(r.reason).toMatch(/SCRIPT_NOT_FOUND/)
  })

  it('无法解析任何 JSON → seed-needed', () => {
    const r = parseEnvGateStdout('Traceback (most recent call last):\n  ...\nModuleNotFoundError: No module named gaussian_workflow\n')
    expect(r.status).toBe('seed-needed')
    expect(r.reason).toMatch(/no single-line JSON/)
  })

  it('schema 不是 gaussian-env-gate.v2 → seed-needed', () => {
    const json = JSON.stringify({ schema: 'gaussian-env-gate.v1', ok: true })
    const r = parseEnvGateStdout(json)
    expect(r.status).toBe('seed-needed')
    expect(r.reason).toMatch(/gaussian-env-gate\.v1/)
    expect(r.reason).toMatch(/older script generation/)
  })

  it('缺 deployed_version 字段 → seed-needed（字段集即脚本代数）', () => {
    const obj = JSON.parse(PASS_FIXTURE) as Record<string, unknown>
    delete obj.deployed_version
    const r = parseEnvGateStdout(JSON.stringify(obj))
    expect(r.status).toBe('seed-needed')
    expect(r.reason).toMatch(/deployed_version/)
  })

  it('缺 expected_version 字段 → seed-needed', () => {
    const obj = JSON.parse(PASS_FIXTURE) as Record<string, unknown>
    delete obj.expected_version
    const r = parseEnvGateStdout(JSON.stringify(obj))
    expect(r.status).toBe('seed-needed')
    expect(r.reason).toMatch(/expected_version/)
  })

  it('缺 newer_version 字段 → seed-needed', () => {
    const obj = JSON.parse(PASS_FIXTURE) as Record<string, unknown>
    delete obj.newer_version
    const r = parseEnvGateStdout(JSON.stringify(obj))
    expect(r.status).toBe('seed-needed')
    expect(r.reason).toMatch(/newer_version/)
  })
})

describe('isEnvGateFresh', () => {
  const makeEntry = (registeredAt: number): EnvGateEntry => ({
    clusterId: '11250',
    engine: 'gaussian',
    verdict: {} as EnvGateVerdict,
    registeredAt,
  })

  const maxAge = 12 * 60 * 60 * 1000 // 12h

  it('undefined → 不新鲜', () => {
    expect(isEnvGateFresh(undefined, Date.now(), maxAge)).toBe(false)
  })

  it('刚登记 → 新鲜', () => {
    const now = Date.now()
    expect(isEnvGateFresh(makeEntry(now - 1000), now, maxAge)).toBe(true)
  })

  it('TTL 内 → 新鲜', () => {
    const now = Date.now()
    expect(isEnvGateFresh(makeEntry(now - maxAge + 1), now, maxAge)).toBe(true)
  })

  it('TTL 到期 → 不新鲜', () => {
    const now = Date.now()
    expect(isEnvGateFresh(makeEntry(now - maxAge - 1), now, maxAge)).toBe(false)
  })

  it('时钟回拨（age < 0）→ 保守视为不新鲜', () => {
    const now = Date.now()
    expect(isEnvGateFresh(makeEntry(now + 5000), now, maxAge)).toBe(false)
  })

  it('TTL=0 → 任何正 age 都不新鲜', () => {
    const now = Date.now()
    expect(isEnvGateFresh(makeEntry(now - 1), now, 0)).toBe(false)
  })

  it('ENV_GATE_SCHEMA 常量未变（其他模块的 import 契约）', () => {
    expect(ENV_GATE_SCHEMA).toBe('gaussian-env-gate.v2')
  })
})
