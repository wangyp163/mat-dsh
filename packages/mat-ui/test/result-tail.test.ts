import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('latest computation task metadata', () => {
  it('does not render calculation properties or detail text', () => {
    const source = readFileSync(resolve(import.meta.dirname, '../src/client/ResultTail.tsx'), 'utf8')
    expect(source).not.toContain('job.detail')
    expect(source).not.toContain('job.properties')
    expect(source).toContain('monitorMetadata')
  })
})
