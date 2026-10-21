import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { PACKAGED_SKILLS_DIR, createMatSkillProvider } from '../src/index.ts'

const packagedNames = [
  'abacus-calc',
  'abacus-external-input',
  'batch-orchestrator',
  'batch-roles',
  'gaussian-calc',
  'gaussian-demo-stress',
  'gaussian-external-input',
  'mater-agents-smoke',
  'matgen',
  'orca-external-input',
  'qe-external-input',
  'session-debug',
  'task-builder',
  'vasp-calc',
  'vasp-external-input',
  'xtb-calc',
  'xtb-external-input',
]

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'mat-skills-test-'))
  tempDirs.push(root)
  await mkdir(join(root, 'good-skill'))
  await writeFile(join(root, 'good-skill', 'SKILL.md'), [
    '---',
    'name: good-skill',
    'description: A fixture skill.',
    'disable-model-invocation: true',
    'metadata:',
    '  tier: test',
    '---',
    '',
    'Body line.',
    '',
  ].join('\n'), 'utf8')
  await mkdir(join(root, 'no-description'))
  await writeFile(join(root, 'no-description', 'SKILL.md'), '---\nname: no-description\n---\n', 'utf8')
  await mkdir(join(root, 'not-a-skill'))
  await writeFile(join(root, 'not-a-skill', 'README.md'), 'not a skill bundle', 'utf8')
  return root
}

describe('createMatSkillProvider on packaged skills', () => {
  it('resolves the packaged root next to the package source', () => {
    expect(PACKAGED_SKILLS_DIR).toBe(fileURLToPath(new URL('../skills', import.meta.url)))
  })

  it('lists every packaged skill with bundled provenance and a directory resource base', async () => {
    const provider = createMatSkillProvider(PACKAGED_SKILLS_DIR)
    const candidates = await provider.list({})
    expect(candidates.map((c) => c.name).sort()).toEqual(packagedNames)
    for (const candidate of candidates) {
      expect(candidate.source).toBe('bundled')
      expect(candidate.provider).toBe('mat')
      expect(candidate.rank).toBe(600)
      expect(candidate.resourceBase).toEqual({ kind: 'directory', path: join(PACKAGED_SKILLS_DIR, candidate.name) })
      expect(candidate.path).toBe(join(PACKAGED_SKILLS_DIR, candidate.name, 'SKILL.md'))
      expect(candidate.invocation.modelInvocable).toBe(true)
      expect(candidate.description.length).toBeGreaterThan(0)
    }
  })

  it('loads the gaussian-calc body with metadata and keeps the relative resource base', async () => {
    const provider = createMatSkillProvider(PACKAGED_SKILLS_DIR)
    const candidates = await provider.list({})
    const gaussian = candidates.find((c) => c.name === 'gaussian-calc')
    expect(gaussian).toBeDefined()
    const definition = await provider.get(gaussian!, {})
    expect(definition?.content).toContain('# Gaussian 工作流')
    expect(definition?.content.length ?? 0).toBeGreaterThan(1000)
    expect(definition?.metadata?.['adapted-for']).toBe('mat-dsh')
    expect(definition?.resourceBase).toEqual({
      kind: 'directory',
      path: join(PACKAGED_SKILLS_DIR, 'gaussian-calc'),
    })
  })
})

describe('createMatSkillProvider on adversarial fixtures', () => {
  it('skips invalid bundles with a warning and keeps the rest', async () => {
    const root = await fixtureRoot()
    const warnings: string[] = []
    const provider = createMatSkillProvider(root, (message) => warnings.push(message))
    const candidates = await provider.list({})
    expect(candidates.map((c) => c.name)).toEqual(['good-skill'])
    expect(warnings.some((w) => w.includes('no-description'))).toBe(true)

    const definition = await provider.get(candidates[0]!, {})
    expect(definition?.content).toBe('Body line.')
    expect(definition?.invocation.modelInvocable).toBe(false)
    expect(definition?.metadata).toEqual({ tier: 'test' })
  })

  it('returns an empty catalog for a missing root', async () => {
    const provider = createMatSkillProvider(join(tmpdir(), 'mat-skills-absent-root'))
    await expect(provider.list({})).resolves.toEqual([])
  })
})
