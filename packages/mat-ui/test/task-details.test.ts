import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'

describe('native HPC task details', () => {
  it('exposes task metadata and a files action', async () => {
    const source = await readFile(new URL('../src/client/TaskDetailsPanel.tsx', import.meta.url), 'utf8')
    expect(source).toContain('打开文件')
    expect(source).toContain('openTab')
    expect(source).toContain('mat-task')
  })
})
