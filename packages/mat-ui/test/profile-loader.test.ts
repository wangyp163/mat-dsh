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

  it('ships environment-independent rows via the mat-bundle patch', async () => {
    const bundle = await readFile(new URL('packages/mat-bundle/cordis.patch.yml', repoRoot), 'utf8')
    const manifest = JSON.parse(await readFile(new URL('packages/mat-bundle/package.json', repoRoot), 'utf8'))
    // bundle manifest 指向的 patch 文件即包内 cordis.patch.yml，且经 exports 可解析。
    expect(manifest.dsh.bundle.patch).toBe('./cordis.patch.yml')
    expect(manifest.exports['./cordis.patch.yml']).toBe('./cordis.patch.yml')
    for (const row of ['mat-tools', 'mat-skills', 'mat-ui', 'optimade-mcp-reference', 'matgen-mcp-reference',
      'subagent-prep', 'subagent-triage', 'subagent-analyst', 'subagent-shepherd']) {
      expect(bundle).toContain(`id: ${row}`)
    }
  })

  it('loads plugin entries as bare package names, never !!js expressions', async () => {
    const bundle = await readFile(new URL('packages/mat-bundle/cordis.patch.yml', repoRoot), 'utf8')
    const script = await readFile(new URL('scripts/dsh-web.sh', repoRoot), 'utf8')
    // loader 的 interpolate 只作用于 config/disabled；entry.name 原样传给
    // tree.import，harmony 的包扫描也先于求值急切读 name——!!js 拼接会以
    // {__jsExpr} 对象进 packageNameOf 直接崩（dsh-harmony 0.8.8 实证）。
    expect(bundle).toContain("name: 'mat-tools'")
    expect(bundle).toContain("name: 'mat-skills'")
    expect(bundle).toContain("name: 'mat-ui'")
    expect(bundle).not.toContain('name: !!js')
    // dev 与目标机同构：脚本把四个包软链进 profile 并注入 bundles 列表。
    expect(script).toContain('MAT_TOOLS_PACKAGE="$REPO_ROOT/packages/mat-tools"')
    expect(script).toContain('MAT_SKILLS_PACKAGE="$REPO_ROOT/packages/mat-skills"')
    expect(script).toContain('MAT_BUNDLE_PACKAGE="$REPO_ROOT/packages/mat-bundle"')
    expect(script).toContain('inject_bundle_into_profile')
  })

  it('keeps environment rows in the user overlay and isolates dev skill discovery', async () => {
    const profile = await readFile(new URL('profiles/mat.yml', repoRoot), 'utf8')
    // 环境相关行留在用户级 overlay：LLM 路由三行族 + dev 技能隔离。
    expect(profile).toContain('id: llm-pi-ai')
    expect(profile).toContain('id: agent-default-model')
    expect(profile).toContain('id: llm-deepseek')
    expect(profile).toContain('includeDefaultRoots: false')
    // MAT_DSH_ROOT 依赖已消除：技能发现由 mat-skills 包内 provider 自解析。
    expect(profile).not.toContain('MAT_DSH_ROOT')
    expect(profile).not.toContain('/tmp/mat-dsh-m0-home')
  })
})
