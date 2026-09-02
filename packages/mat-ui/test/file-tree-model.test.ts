import { describe, expect, it } from 'vitest'
import { mergeTreeEntries, visibleTreeEntries } from '../src/client/file-tree-model'

const file = (path: string, directory = false) => ({ path, name: path.split('/').at(-1)!, size: 1, directory, regularFile: !directory, symbolicLink: false, readable: true, origin: 'local' as const, status: 'local-only' as const })

describe('file tree projection', () => {
  it('shows descendants only while every parent directory is expanded', () => {
    const entries = [file('results', true), file('results/data', true), file('results/data/out.log')]
    expect(visibleTreeEntries(entries, [])).toEqual([expect.objectContaining({ path: 'results', depth: 0 })])
    expect(visibleTreeEntries(entries, ['results'])).toEqual([
      expect.objectContaining({ path: 'results', depth: 0 }),
      expect.objectContaining({ path: 'results/data', depth: 1 }),
    ])
    expect(visibleTreeEntries(entries, ['results', 'results/data'])).toHaveLength(3)
  })

  it('replaces a loaded directory branch without duplicating its root siblings', () => {
    const current = [file('results', true), file('notes.txt'), file('results/old.log')]
    expect(mergeTreeEntries(current, 'results', [file('results/new.log')]).map(value => value.path)).toEqual([
      'notes.txt', 'results', 'results/new.log',
    ])
  })
})
