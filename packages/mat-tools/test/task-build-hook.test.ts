import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { MatClient, createMatDb } from 'mat-core'
import type { SqliteConnection } from 'mat-core'
import { apply, resetMatDbForTests } from '../src/index'

/**
 * mat_task_build 工具接线测试（D0 P3 task 构建器）：
 * ① 工具 + 引导段注册（order 103 槽位、中文触发词）；
 * ② ready 输出含摘要与 digest 直提指引，且零集群副作用（exec 被调即炸）；
 * ③ needs_clarification / ④ invalid 的输出形态；
 * ⑤ 复用飞轮接线：mat.db 历史命中 → 波标记复用进输出。
 */

const WATER_XYZ = '3\n\nO 0.000000 0.000000 0.117790\nH 0.000000 0.757160 -0.470790\nH 0.000000 -0.757160 -0.470790\n'

interface RegisteredTool {
  name: string
  execute: (args: Record<string, unknown>) => Promise<string>
}

interface PromptSection { name: string; order: number; text: string }

function makeCtx() {
  const tools = new Map<string, RegisteredTool>()
  const sections: PromptSection[] = []
  const ctx = {
    on: () => () => {},
    systemPrompt: { section: (s: PromptSection) => { sections.push(s) } },
    tools: { register: (t: RegisteredTool) => { tools.set(t.name, t) } },
    get: () => undefined,
    provide: (_n: string, _v: unknown) => () => {},
  } as unknown as Context
  return { ctx, tools, sections }
}

function waterGoal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: 'aimater.goal.v1',
    structure: { label: 'h2o-run1', xyz: WATER_XYZ, source: 'user-upload' },
    intent: { want: ['optimize', 'frequencies'] },
    resources: { partition: 'Agent0' },
    ...overrides,
  }
}

describe('mat_task_build 工具接线', () => {
  let testRoot: string

  beforeEach(async () => {
    testRoot = await mkdtemp('/tmp/mat-task-build-')
    vi.stubEnv('MAT_FILE_ROOT', testRoot)
    resetMatDbForTests()
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    resetMatDbForTests()
    await rm(testRoot, { recursive: true, force: true })
  })

  it('① 注册工具与引导段：order 103 槽位、含中文触发词与执行接线', () => {
    const { ctx, tools, sections } = makeCtx()
    apply(ctx)
    expect(tools.has('mat_task_build')).toBe(true)
    const section = sections.find((s) => s.name === 'tool:mat-task-build')
    expect(section).toBeDefined()
    expect(section!.order).toBe(103)
    expect(section!.text).toContain('task-builder')
    expect(section!.text).toContain('参数模板')
    expect(section!.text).toContain('confirmed_digest')
  })

  it('② ready：TASK_PACKAGE_READY + digest + 直提指引，零集群副作用', async () => {
    const spy = vi.spyOn(MatClient.prototype, 'execCommand').mockImplementation(async () => {
      throw new Error('mat_task_build must not touch the cluster')
    })
    const { ctx, tools } = makeCtx()
    apply(ctx)
    const out = await tools.get('mat_task_build')!.execute({ goal_json: waterGoal() })
    expect(spy).not.toHaveBeenCalled()
    expect(out).toContain('TASK_PACKAGE_READY')
    expect(out).toContain('task        : opt+freq')
    expect(out).toContain('mode        : one-stop')
    expect(out).toContain('计算参数摘要')
    expect(out).toContain('confirmed_digest')
    expect(out).toMatch(/digest\s+: [0-9a-f]{64}/)
  })

  it('③ needs_clarification：缺分区 → 阻塞式问题转述形态', async () => {
    const { ctx, tools } = makeCtx()
    apply(ctx)
    const out = await tools.get('mat_task_build')!.execute({
      goal_json: waterGoal({ resources: {} }),
    })
    expect(out).toContain('NEEDS_CLARIFICATION')
    expect(out).toContain('缺少 Slurm 分区')
    expect(out).toContain('阻塞式')
    expect(out).toContain('[partition]')
  })

  it('④ invalid：异 task 路由键 → INVALID_GOAL 带修复提示', async () => {
    const { ctx, tools } = makeCtx()
    apply(ctx)
    const out = await tools.get('mat_task_build')!.execute({
      goal_json: waterGoal({ intent: { want: ['td'] }, method: { route_kwargs: { opt: ['Tight'] } } }),
    })
    expect(out).toContain('INVALID_GOAL')
    expect(out).toContain('路由键 opt')
  })

  it('⑤ 复用飞轮接线：mat.db 历史 (label, task, converged) 命中 → 输出复用提示', async () => {
    const conn = new DatabaseSync(join(testRoot, 'mat.db'))
    const db = createMatDb(conn as unknown as SqliteConnection)
    db.migrate()
    expect(db.recordResult({
      structure: 'h2o-run1', task: 'opt+freq', energy: -76.408954, converged: true,
      imaginaryFrequencyCount: null, artifactsPath: '/home/u/w/h2o-run1/artifacts.json', ts: Date.now(),
    }).ok).toBe(true)
    conn.close()
    resetMatDbForTests() // 清缓存，让工具重开并读到种子

    const { ctx, tools } = makeCtx()
    apply(ctx)
    const out = await tools.get('mat_task_build')!.execute({ goal_json: waterGoal() })
    expect(out).toContain('TASK_PACKAGE_READY')
    expect(out).toContain('命中复用')
    expect(out).toContain('-76.408954')
    expect(out).toContain('estimated core-hours : 0')
  })
})
