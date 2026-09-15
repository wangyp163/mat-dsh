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
    expect(script).toContain('MAT_UI_PACKAGE="$REPO_ROOT/packages/mat-ui"')
    expect(script).toContain('ln -sfn "$MAT_UI_PACKAGE" "$MAT_UI_LINK"')
  })

  it('loads mat-tools as a bare package name, never a !!js expression', async () => {
    const profile = await readFile(new URL('profiles/mat.yml', repoRoot), 'utf8')
    const script = await readFile(new URL('scripts/dsh-web.sh', repoRoot), 'utf8')
    // loader 的 interpolate 只作用于 config/disabled；entry.name 原样传给
    // tree.import，harmony 的包扫描也先于求值急切读 name——!!js 拼接会以
    // {__jsExpr} 对象进 packageNameOf 直接崩（dsh-harmony 0.8.8 实证）。
    expect(profile).toContain("name: 'mat-tools'")
    expect(profile).not.toContain('name: !!js')
    expect(script).toContain('MAT_TOOLS_PACKAGE="$REPO_ROOT/packages/mat-tools"')
    expect(script).toContain('ln -sfn "$MAT_TOOLS_PACKAGE" "$MAT_TOOLS_LINK"')
  })

  it('isolates skill discovery to the repository skill root', async () => {
    const profile = await readFile(new URL('profiles/mat.yml', repoRoot), 'utf8')
    expect(profile).toContain('includeDefaultRoots: false')
    expect(profile).toContain("!!js process.env.MAT_DSH_ROOT + '/skills'")
    expect(profile).not.toContain('/tmp/mat-dsh-m0-home')
  })
})
