import { describe, expect, it } from 'vitest'
import {
  DEFAULT_GAUSSIAN_IMPORTANT_PATTERNS,
  filterDownloadableEntries,
  importantRemotePaths,
  mapRemotePath,
  mergeWorkspaceTree,
  normalizeRemotePath,
  projectDegradedPrimary,
  projectPrimaryFiles,
  deriveRemoteHome,
  remoteRelativePath,
} from '../src/remote-file-model'
import type { RemoteFileEntry } from '../src/efile'

function entry(overrides: Partial<RemoteFileEntry> = {}): RemoteFileEntry {
  return {
    name: 'result.log',
    path: '/public/home/u/job/result.log',
    size: 12,
    modifiedAt: '2026-09-01 09:00:00',
    directory: false,
    regularFile: true,
    symbolicLink: false,
    readable: true,
    ...overrides,
  }
}

describe('remote path boundary', () => {
  it('normalizes absolute POSIX paths and rejects unsafe forms', () => {
    expect(normalizeRemotePath('/public/home/u/job/./out//result.log')).toBe('/public/home/u/job/out/result.log')
    for (const unsafe of ['', 'relative/file', '../escape', '/a/../../escape', 'file:///etc/passwd', '/a/\0bad']) expect(() => normalizeRemotePath(unsafe)).toThrow()
  })

  it('derives a relative path only for descendants of the declared workdir', () => {
    expect(remoteRelativePath('/public/home/u/job', '/public/home/u/job/out/a.dat')).toBe('out/a.dat')
    expect(() => remoteRelativePath('/public/home/u/job', '/public/home/u/job2/a.dat')).toThrow(/outside/)
    expect(() => remoteRelativePath('/public/home/u/job', '/public/home/u/job')).toThrow(/file path/)
  })

  it('maps descendants below the local task root without allowing traversal', () => {
    expect(mapRemotePath('/srv/mat-files/11250/job-1', '/public/home/u/job', '/public/home/u/job/out/a.dat')).toBe('/srv/mat-files/11250/job-1/out/a.dat')
    expect(() => mapRemotePath('/srv/root', '/remote/job', '/remote/job/../secret')).toThrow(/traversal|outside/)
  })
})

describe('unified workspace tree projection', () => {
  it('uses local entries as the baseline and merges remote entries by relative path', () => {
    const nodes = mergeWorkspaceTree({
      local: [
        { path: 'result.json', name: 'result.json', directory: false, regularFile: true, symbolicLink: false, readable: true, size: 12 },
        { path: 'scratch', name: 'scratch', directory: true, regularFile: false, symbolicLink: false, readable: true, size: 0 },
      ],
      remote: [entry({ name: 'result.json', path: '/work/job/result.json' }), entry({ name: 'remote.log', path: '/work/job/remote.log' })],
      workdir: '/work/job',
      syncs: [{ remotePath: '/work/job/result.json', status: 'completed' }],
    })
    expect(nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'result.json', origin: 'both', status: 'synchronized' }),
      expect.objectContaining({ path: 'remote.log', origin: 'remote', status: 'remote-only' }),
      expect.objectContaining({ path: 'scratch', origin: 'local', status: 'local-only' }),
    ]))
  })

  it('projects active sync state instead of treating every local/remote match as synchronized', () => {
    const nodes = mergeWorkspaceTree({
      local: [{ path: 'pending.log', name: 'pending.log', size: 3, directory: false, regularFile: true, symbolicLink: false, readable: true }],
      remote: [entry({ name: 'pending.log', path: '/work/job/pending.log' })],
      workdir: '/work/job',
      syncs: [{ remotePath: '/work/job/pending.log', status: 'pending' }],
    })
    expect(nodes).toContainEqual(expect.objectContaining({ path: 'pending.log', status: 'downloading' }))
  })

  it('derives primary files from producer paths, patterns, and manual pins without duplicates', () => {
    const entries = [entry({ name: 'result.json', path: '/work/job/result.json' }), entry({ name: 'run.log', path: '/work/job/run.log' }), entry({ name: 'notes.txt', path: '/work/job/notes.txt' })]
    expect(projectPrimaryFiles({ workdir: '/work/job', entries, producerFiles: ['result.json'], patterns: ['*.log'], pins: ['notes.txt'], exclusions: [] })).toEqual(['result.json', 'run.log', 'notes.txt'])
  })

  it('keeps local entries when a shell-style workdir makes completed syncs unrelativizable', () => {
    const nodes = mergeWorkspaceTree({
      local: [{ path: 'result.json', name: 'result.json', size: 12, directory: false, regularFile: true, symbolicLink: false, readable: true }],
      remote: [],
      workdir: '$HOME/workspace/water-optfreq',
      syncs: [{ remotePath: '/public/home/u/workspace/water-optfreq/opt+freq/a.xyz', status: 'completed' }],
    })
    expect(nodes).toEqual([expect.objectContaining({ path: 'result.json', origin: 'local', status: 'local-only' })])
  })

  it('projects degraded primary files from producer paths and pins when the remote listing is unavailable', () => {
    expect(projectDegradedPrimary({
      workdir: '/public/home/u/job',
      producerFiles: ['/public/home/u/job/opt+freq/result.json', 'run.log', '/elsewhere/other.log'],
      pins: ['opt+freq/pinned.log'],
      exclusions: ['opt+freq/debug.log'],
    })).toEqual(['opt+freq/result.json', 'run.log', 'opt+freq/pinned.log'])
  })

  it('derives the remote home prefix from producer hints for a shell-style workdir', () => {
    expect(deriveRemoteHome('$HOME/workspace/water-optfreq', ['/public/home/hpc-user-a/workspace/water-optfreq/opt+freq/a.xyz'])).toBe('/public/home/hpc-user-a')
    expect(deriveRemoteHome('$HOME/workspace/gone', ['/public/home/hpc-user-a/workspace/other/x.log'])).toBeUndefined()
    expect(deriveRemoteHome('/public/home/hpc-user-a/workspace', ['/public/home/hpc-user-a/workspace/a'])).toBeUndefined()
    expect(deriveRemoteHome('$HOME', [])).toBeUndefined()
  })

  it('marks a local/remote kind mismatch as a conflict instead of merging it', () => {
    const nodes = mergeWorkspaceTree({
      local: [{ path: 'output', name: 'output', directory: true, regularFile: false, symbolicLink: false, readable: true, size: 0 }],
      remote: [entry({ name: 'output', path: '/work/job/output', directory: false })],
      workdir: '/work/job', syncs: [],
    })
    expect(nodes).toContainEqual(expect.objectContaining({ path: 'output', status: 'conflict', origin: 'both' }))
  })
})

describe('remote entry and important-file policy', () => {
  it('allows only readable regular non-link files within count and byte budgets', () => {
    const accepted = filterDownloadableEntries([
      entry(),
      entry({ name: 'dir', path: '/public/home/u/job/dir', directory: true, regularFile: false }),
      entry({ name: 'link', path: '/public/home/u/job/link', symbolicLink: true }),
      entry({ name: 'private', path: '/public/home/u/job/private', readable: false }),
      entry({ name: 'huge.chk', path: '/public/home/u/job/huge.chk', size: 10_000 }),
    ], { maxFiles: 2, maxBytes: 100 })
    expect(accepted.entries.map((value) => value.name)).toEqual(['result.log'])
    expect(accepted.skipped.map((value) => value.reason)).toEqual(['directory', 'symbolic-link', 'not-readable', 'byte-budget'])
  })

  it('merges producer files, workflow patterns, and user selections in priority order without duplicates', () => {
    const entries = [entry({ name: 'job.log', path: '/work/job/job.log' }), entry({ name: 'result.json', path: '/work/job/result.json' }), entry({ name: 'notes.txt', path: '/work/job/notes.txt' })]
    expect(DEFAULT_GAUSSIAN_IMPORTANT_PATTERNS).toContain('*.log')
    expect(importantRemotePaths({ workdir: '/work/job', entries, producerFiles: ['job.log', '/work/job/job.log'], patterns: ['result*.json'], selectedPaths: ['/work/job/notes.txt'] })).toEqual(['/work/job/job.log', '/work/job/result.json', '/work/job/notes.txt'])
  })

  it('rejects producer and user paths outside workdir rather than silently accepting them', () => {
    expect(() => importantRemotePaths({ workdir: '/work/job', entries: [], producerFiles: ['/etc/passwd'], selectedPaths: [], patterns: [] })).toThrow(/outside/)
  })
})
