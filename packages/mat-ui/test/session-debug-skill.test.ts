import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const skillUrl = new URL('../../../skills/session-debug/SKILL.md', import.meta.url)

describe('session-debug skill', () => {
  it('documents reusable compressed-session analysis with safe output', async () => {
    const skill = await readFile(skillUrl, 'utf8')
    expect(skill).toMatch(/^---\nname: session-debug\n/)
    expect(skill).toContain('session.jsonl.zstd')
    expect(skill).toContain('pnpm debug:session')
    expect(skill).toContain('stale-skill-root')
    expect(skill).toContain('不得打印')
  })
})
