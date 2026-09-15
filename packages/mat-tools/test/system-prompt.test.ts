import { mkdtemp, rm } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { apply } from '../src/index'

/**
 * 系统提示引导段内容门：fake ctx 捕获 ctx.systemPrompt.section 注册，
 * 断言 HPC 工具引导段与压测编排引导段的关键红线不回退。
 * 压测引导段是 SOP 固化第 1 层（常驻触发）：用户说"压测"时模型无需读文档
 * 即可从常驻段拿到触发词、计划确认与 session-debug 收口三条内核。
 */

interface PromptSection {
  name: string
  order: number
  text: string
}

function makeCtx() {
  const sections: PromptSection[] = []
  const ctx = {
    systemPrompt: { section: (s: PromptSection) => { sections.push(s) } },
    tools: { register: (_t: unknown) => {} },
    get: () => undefined,
    provide: (_name: string, _value: unknown) => () => {},
  } as unknown as Context
  return { ctx, sections }
}

describe('mat-tools 系统提示引导段', () => {
  let testRoot: string
  beforeEach(async () => {
    testRoot = await mkdtemp('/tmp/mat-system-prompt-')
    vi.stubEnv('MAT_FILE_ROOT', testRoot)
  })
  afterEach(async () => {
    vi.unstubAllEnvs()
    await rm(testRoot, { recursive: true, force: true })
  })

  it('注册 tool 引导段且槽位落在宿主约定 100–199', () => {
    const { ctx, sections } = makeCtx()
    apply(ctx)
    expect(sections.length).toBeGreaterThanOrEqual(2)
    for (const s of sections) {
      expect(s.order).toBeGreaterThanOrEqual(100)
      expect(s.order).toBeLessThanOrEqual(199)
    }
    expect(new Set(sections.map((s) => s.name)).size).toBe(sections.length)
  })

  it('工具引导段保留 gaussian-calc 门禁与异步监控引导', () => {
    const { ctx, sections } = makeCtx()
    apply(ctx)
    const exec = sections.find((s) => s.name === 'tool:mat-exec')
    expect(exec).toBeDefined()
    expect(exec!.text).toContain('gaussian-calc')
    expect(exec!.text).toContain('mat_job_watch')
    expect(exec!.text).toContain('mat_gaussian')
  })

  it('压测引导段含中文触发词、计划确认与 session-debug 收口内核', () => {
    const { ctx, sections } = makeCtx()
    apply(ctx)
    const stress = sections.find((s) => s.name === 'tool:mat-stress')
    expect(stress).toBeDefined()
    const text = stress!.text
    for (const keyword of ['压测', '回归', '端到端验证', '链路验证', '稳定性测试']) {
      expect(text).toContain(keyword)
    }
    expect(text).toContain('gaussian-demo-stress')
    expect(text).toContain('确认')
    expect(text).toContain('session-debug')
    expect(text).toContain('anomalies')
    expect(text).toContain('摘要表')
    expect(text).toContain('gaussian-calc')
  })
})
