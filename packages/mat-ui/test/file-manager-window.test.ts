import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const source = (file: string) => readFile(new URL(`../src/client/${file}`, import.meta.url), 'utf8')

describe('native HPC file details tab', () => {
  it('registers the file manager as an additive native details tab, not an overlay', async () => {
    const index = await source('index.tsx')
    const panel = await source('FileManagerPanel.tsx')
    expect(index).toContain('conversation.details.tab')
    expect(index).not.toContain("shell.overlay")
    expect(panel).not.toContain('mat-file-manager-launcher')
    expect(panel).toContain('role="tree"')
  })

  it('uses the unified workspace tree and exposes primary files', async () => {
    const panel = await source('FileManagerPanel.tsx')
    expect(panel).toContain('/mat-files/tree?')
    expect(panel).toContain('primary')
    expect(panel).toContain('selectedPaths')
    expect(panel).toContain('loadDirectory(entry.path)')
    expect(panel).toContain('/mat-files/download')
  })

  it('uses DSH-native visual primitives and attachment-only downloads', async () => {
    const index = await source('index.tsx')
    const panel = await source('FileManagerPanel.tsx')
    const style = await source('style.ts')
    expect(panel).toContain('@deepseek-ai/dsh-client-ui-primitives')
    expect(style).not.toContain('mat-file-manager-launcher')
    expect(style).not.toContain('mat-file-manager{position:absolute')
    expect(style).not.toContain('academic')
    expect(index).not.toContain('overrideTokens')
  })
})
