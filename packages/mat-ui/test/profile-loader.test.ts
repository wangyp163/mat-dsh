import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const repoRoot = new URL('../../../', import.meta.url)

describe('HPC profile entries under the Harmony ESM loader', () => {
  it('uses explicit file extensions for local TypeScript modules', async () => {
    const tools = await readFile(new URL('packages/mat-tools/src/index.ts', repoRoot), 'utf8')
    expect(tools).toContain("from './efile-env.ts'")
    const coreFiles = ['index.ts', 'transport.ts', 'efile.ts', 'fetch-transport.ts', 'client.ts', 'slurm.ts', 'watch-loop.ts', 'gaussian.ts', 'token.ts']
    for (const file of coreFiles) {
      const source = await readFile(new URL(`packages/mat-core/src/${file}`, repoRoot), 'utf8')
      const extensionless = (source.match(/from ['\"]\.\/[^'\"]+['\"]/g) ?? [])
        .filter((specifier) => !/\.ts['\"]$/.test(specifier))
      expect(extensionless, file).toEqual([])
      expect(source, file).not.toMatch(/constructor\([^)]*(?:private|public|protected|readonly)\s+/)
    }
  })

  it('loads mat-ui as a package so Harmony discovers its patches', async () => {
    const profile = await readFile(new URL('profiles/mat.yml', repoRoot), 'utf8')
    const script = await readFile(new URL('scripts/dsh-web.sh', repoRoot), 'utf8')
    expect(profile).toContain("name: 'mat-ui'")
    expect(script).toContain('MAT_UI_PACKAGE=~/mat-harness/mat-dsh/packages/mat-ui')
    expect(script).toContain('ln -sfn "$MAT_UI_PACKAGE" "$MAT_UI_LINK"')
  })

  it('isolates skill discovery to the repository skill root', async () => {
    const profile = await readFile(new URL('profiles/mat.yml', repoRoot), 'utf8')
    expect(profile).toContain('includeDefaultRoots: false')
    expect(profile).toContain('- ~/mat-harness/mat-dsh/skills')
    expect(profile).not.toContain('/tmp/mat-dsh-m0-home')
  })
})
