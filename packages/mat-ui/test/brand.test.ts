import { readFile, access } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const source = (file: string) => readFile(new URL(`../src/client/${file}`, import.meta.url), 'utf8')

describe('HPC 品牌位（sidebar 品牌名插槽，零宿主改动）', () => {
  it('品牌名：占 sidebar.brand.name 插槽，只渲染限定词 Harness', async () => {
    const index = await source('index.tsx')
    expect(index).toContain("ctx.slots.inject('sidebar.brand.name'")
    const brand = await source('Brand.tsx')
    expect(brand).toContain('>Harness</span>')
    expect(brand).not.toContain('HPC Harness')
  })

  it('品牌名样式镜像宿主 fallback 度量（17px、无字距、不换行）', async () => {
    const style = await source('style.ts')
    expect(style).toContain('.mat-brand-name{')
    expect(style).toContain('font-size:17px')
    expect(style).toContain('white-space:nowrap')
  })

  it('HPC wordmark 已去除：mark 插槽不再占用，回退宿主鱼形 fallback', async () => {
    const index = await source('index.tsx')
    expect(index).not.toContain("ctx.slots.inject('sidebar.brand.mark'")
    expect(index).not.toContain("ctx.slots.inject('conversation.hero.brand.mark'")
    const brand = await source('Brand.tsx')
    expect(brand).not.toContain('MatBrandMark')
    expect(brand).not.toContain('matLogoDataUrl')
    const style = await source('style.ts')
    expect(style).not.toContain('mat-brand-mark')
    await expect(access(new URL('../src/client/logo-data.ts', import.meta.url)))
      .rejects.toThrow()
  })
})
