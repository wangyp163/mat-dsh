import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'

const source = () => readFile(new URL('../src/client/StatusDock.tsx', import.meta.url), 'utf8')

describe('compact computational status strip', () => {
  it('renders one actionable status entry instead of a monitor card list', async () => {
    const text = await source()
    expect(text).toContain('onOpenTask')
    expect(text).toContain('role="status"')
    expect(text).toContain('mat-status-strip')
    expect(text).not.toContain('setCollapsed')
    expect(text).not.toContain('mat-status-card')
    expect(text).not.toContain('COMPUTATIONAL MONITOR')
  })
})
