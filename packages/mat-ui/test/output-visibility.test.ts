import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_OUTPUT_VISIBILITY,
  applyOutputVisibility,
  loadOutputVisibility,
  observeOutputVisibility,
  parseOutputVisibility,
  saveOutputVisibility,
} from '../src/client/output-visibility'

class FakeRow {
  clicks = 0
  constructor(public expanded: boolean) {}
  getAttribute(name: string) { return name === 'aria-expanded' ? String(this.expanded) : null }
  click() { this.clicks += 1; this.expanded = !this.expanded }
}

class FakeRoot {
  attributes = new Map<string, string>()
  thinking: FakeRow[] = []
  tools: FakeRow[] = []
  setAttribute(name: string, value: string) { this.attributes.set(name, value) }
  querySelectorAll(selector: string) {
    return selector.includes('data-variant="think"') ? this.thinking : this.tools
  }
}

class FakeStorage {
  values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
}

describe('output visibility state', () => {
  it('缺失或坏数据回退整洁模式；合法数据通过', () => {
    expect(parseOutputVisibility(null)).toEqual(DEFAULT_OUTPUT_VISIBILITY)
    expect(parseOutputVisibility('{broken')).toEqual(DEFAULT_OUTPUT_VISIBILITY)
    expect(parseOutputVisibility('{"thinking":"wat"}')).toEqual(DEFAULT_OUTPUT_VISIBILITY)
    expect(parseOutputVisibility('{"thinking":"hidden","tools":"expanded"}')).toEqual({ thinking: 'hidden', tools: 'expanded' })
  })

  it('load/save 使用固定 key，保存后可恢复', () => {
    const storage = new FakeStorage()
    expect(loadOutputVisibility(storage)).toEqual(DEFAULT_OUTPUT_VISIBILITY)
    saveOutputVisibility(storage, { thinking: 'expanded', tools: 'hidden' })
    expect(loadOutputVisibility(storage)).toEqual({ thinking: 'expanded', tools: 'hidden' })
  })

  it('浏览器拒绝 localStorage 时安全回退且保存不抛错', () => {
    const storage = {
      getItem: () => { throw new Error('storage denied') },
      setItem: () => { throw new Error('storage denied') },
    }
    expect(loadOutputVisibility(storage)).toEqual(DEFAULT_OUTPUT_VISIBILITY)
    expect(() => { saveOutputVisibility(storage, { thinking: 'hidden', tools: 'summary' }) }).not.toThrow()
  })
})

describe('applyOutputVisibility', () => {
  it('写根级模式属性；展开/收起 Thinking 与 Tool rows', () => {
    const root = new FakeRoot()
    root.thinking = [new FakeRow(false), new FakeRow(true)]
    root.tools = [new FakeRow(true), new FakeRow(false)]
    applyOutputVisibility(root as unknown as HTMLElement, { thinking: 'expanded', tools: 'summary' })
    expect(root.attributes.get('data-mat-thinking')).toBe('expanded')
    expect(root.attributes.get('data-mat-tools')).toBe('summary')
    expect(root.thinking.map(r => [r.expanded, r.clicks])).toEqual([[true, 1], [true, 0]])
    expect(root.tools.map(r => [r.expanded, r.clicks])).toEqual([[false, 1], [false, 0]])
  })

  it('hidden 收起内容但保留 DOM；重复 apply 幂等；无 disclosure 不报错', () => {
    const root = new FakeRoot()
    root.thinking = [new FakeRow(true)]
    applyOutputVisibility(root as unknown as HTMLElement, { thinking: 'hidden', tools: 'hidden' })
    applyOutputVisibility(root as unknown as HTMLElement, { thinking: 'hidden', tools: 'hidden' })
    expect(root.attributes.get('data-mat-thinking')).toBe('hidden')
    expect(root.attributes.get('data-mat-tools')).toBe('hidden')
    expect(root.thinking[0]).toMatchObject({ expanded: false, clicks: 1 })
    expect(root.tools).toEqual([])
  })
})

describe('observeOutputVisibility', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('新增节点时重应用当前状态，dispose 后 disconnect', () => {
    const callbacks: MutationCallback[] = []
    const disconnect = vi.fn()
    class Observer {
      constructor(callback: MutationCallback) { callbacks.push(callback) }
      observe = vi.fn()
      disconnect = disconnect
    }
    vi.stubGlobal('MutationObserver', Observer)
    const root = new FakeRoot()
    const getState = () => ({ thinking: 'expanded', tools: 'summary' } as const)
    const dispose = observeOutputVisibility(root as unknown as HTMLElement, getState)
    const late = new FakeRow(false)
    root.thinking.push(late)
    callbacks[0]([], {} as MutationObserver)
    expect(late.expanded).toBe(true)
    dispose()
    expect(disconnect).toHaveBeenCalledOnce()
  })
})
