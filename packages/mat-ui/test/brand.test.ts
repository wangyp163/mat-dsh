import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const source = (file: string) => readFile(new URL(`../src/client/${file}`, import.meta.url), 'utf8')

describe('HPC 品牌位（sidebar/hero 品牌插槽，零宿主改动）', () => {
  it('锁定式：mark 插槽出品牌名 HPC，名字插槽只留限定词 Harness', async () => {
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

  it('鲸鱼 logo 换成黑色 HPC wordmark：占 sidebar 与 hero 两个 mark 插槽', async () => {
    const index = await source('index.tsx')
    expect(index).toContain("ctx.slots.inject('sidebar.brand.mark'")
    expect(index).toContain("ctx.slots.inject('conversation.hero.brand.mark'")
    const brand = await source('Brand.tsx')
    expect(brand).toContain('matLogoDataUrl')
    const logoData = await source('logo-data.ts')
    expect(logoData).toContain("export const matLogoDataUrl = 'data:image/png;base64,")
  })

  it('mark 样式：不撑破窄 rail（max-width 收缩）+ 深色主题自动反白', async () => {
    const style = await source('style.ts')
    expect(style).toContain('.mat-brand-mark{')
    expect(style).toContain('max-width:100%')
    expect(style).toContain('body[data-ds-dark-theme] .mat-brand-mark{filter:invert(1)}')
  })
})
