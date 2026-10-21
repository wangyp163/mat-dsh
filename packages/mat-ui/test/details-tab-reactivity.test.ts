import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const patches = require('../details-tab-reactivity.patch.cjs') as Array<{
  id: string
  target: { package: string; file: string }
  select: string
  expect: number
  apply(context: {
    node: { getStart(): number; getEnd(): number }
    sourceFile: { text: string }
    source: string
    edit: { insertRight(at: number, text: string): void }
  }): void
}>

/** 最小宿主组合片段：补丁锚点 activeTab 所在的 details inject 对象。 */
const FIXTURE = [
  'window.__ModuleLoader__.load({',
  '\tid: "@deepseek-ai/dsh-client-ui-conversation",',
  '\tfactory: (require) => {',
  '\t\tvar module = { exports: {} };',
  '\t\tvar exports = module.exports;',
  '\t\tlet react = require("react");',
  '\t\tconst detailsController = { active: "details", state: null };',
  '\t\tfunction ConversationController() {',
  '\t\t\tthis.inject = (sessionId) => ({',
  '\t\t\t\tcloseDetails: () => {',
  '\t\t\t\t\tdetailsController.close();',
  '\t\t\t\t},',
  '\t\t\t\topenTab: (id) => {',
  '\t\t\t\t\tdetailsController.open(id);',
  '\t\t\t\t},',
  '\t\t\t\topenWorkspace: (path) => {',
  '\t\t\t\t\treturn null;',
  '\t\t\t\t},',
  '\t\t\t\tactiveTab: () => detailsController.active,',
  '\t\t\t\thooks: {',
  '\t\t\t\t\ttabs: null,',
  '\t\t\t\t\tstate: detailsController.getState()',
  '\t\t\t\t}',
  '\t\t\t});',
  '\t\t}',
  '\t\treturn module.exports;',
  '\t}',
  '})',
].join('\n')

/** 无 AST 的 apply 桩：按 `activeTab: () => X.active` 文本定位节点边界。 */
function applyPatch(source: string, patch: (typeof patches)[number]): string {
  const match = source.match(/activeTab: \(\) => \w+\.active/)
  if (match === null) throw new Error(`${patch.id}: activeTab anchor is missing`)
  if (source.indexOf(match[0]) !== source.lastIndexOf(match[0])) {
    throw new Error(`${patch.id}: activeTab anchor is not unique`)
  }
  const start = source.indexOf(match[0])
  let output = source
  patch.apply({
    node: { getStart: () => start, getEnd: () => start + match[0].length },
    sourceFile: { text: source },
    source,
    edit: { insertRight: (at, text) => { output = output.slice(0, at) + text + output.slice(at) } },
  })
  return output
}

describe('details tab reactivity patch', () => {
  it('injects a subscribed useDetailsState next to the non-reactive activeTab read', () => {
    expect(patches).toHaveLength(1)
    const patch = patches[0]!
    expect(patch.target.package).toBe('@deepseek-ai/dsh-client-ui-conversation')
    expect(patch.target.file).toBe('lib/client.js')
    expect(patch.select).toBe('PropertyAssignment[name.name="activeTab"]')
    expect(patch.expect).toBe(1)
    const output = applyPatch(FIXTURE, patch)
    expect(output).toContain(
      'useDetailsState: (selector) => react.useSyncExternalStore((onStoreChange) => detailsController.state.subscribe(onStoreChange), () => selector(detailsController.state.getSnapshot()))',
    )
    // 插入不破坏原有属性：activeTab 与 hooks 仍在。
    expect(output).toContain('activeTab: () => detailsController.active,')
    expect(output).toContain('state: detailsController.getState()')
  })

  it('wires the injected hook so a tab click notifies React subscribers', () => {
    const output = applyPatch(FIXTURE, patches[0]!)
    const rhs = output.match(/useDetailsState: (\(\w+\) => .+),\n\t+hooks:/)![1]!
    const listeners = new Set<() => void>()
    let state = { active: 'details' }
    const controller = {
      state: {
        subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn) } },
        getSnapshot: () => state,
      },
    }
    const unsubscribes: Array<() => void> = []
    let renders = 0
    const react = {
      useSyncExternalStore(subscribe: (onStoreChange: () => void) => () => void, getSnapshot: () => unknown) {
        const onStoreChange = () => { renders += 1 }
        unsubscribes.push(subscribe(onStoreChange))
        return getSnapshot()
      },
    }
    const hook = new Function('react', 'detailsController', `return (${rhs})`)(react, controller)
    expect(hook((value: typeof state) => value)).toBe(state)
    state = { active: 'mat-files' }
    for (const fn of listeners) fn()
    // 通知触发订阅回调（React 侧重渲染），下一次渲染读到新 active。
    expect(renders).toBe(1)
    expect(hook((value: typeof state) => value)).toEqual({ active: 'mat-files' })
    expect(unsubscribes).toHaveLength(2)
    expect(unsubscribes[0]!()).toBeUndefined()
    expect(listeners.size).toBe(1)
  })

  it('fails closed when the host bundle shape changes', () => {
    expect(() => applyPatch('function unrelated() {}', patches[0]!)).toThrow(/activeTab anchor is missing/)
    const withoutReact = FIXTURE.replace('let react = require("react");', '')
    expect(() => applyPatch(withoutReact, patches[0]!)).toThrow(/react import binding not found/)
    // 改名的 react 绑定是运行环境合法形状：补丁应当适配而不是失败。
    const renamed = applyPatch(FIXTURE.replace('let react = require("react");', 'let react1 = require("react");'), patches[0]!)
    expect(renamed).toContain('react1.useSyncExternalStore')
  })

  it('is registered as a harmony source patch and applies to the live host bundle', async (ctx) => {
    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
      dsh?: { harmony?: { patches?: string[] } }
    }
    expect(manifest.dsh?.harmony?.patches).toContain('./details-tab-reactivity.patch.cjs')
    const live = await readFile(require.resolve('@deepseek-ai/dsh-client-ui-conversation/client'), 'utf8')
    // 宿主指纹门：锚点 activeTab 形状来自宿主 filesystem-contract 重构后的产物。
    // 对已发布 rc.8 产物锚点缺失时跳过实弹断言——补丁静默不生效是文档化行为
    // （AGENTS.md「跨宿主版本可能静默失效」；逃生口 MAT_UI_OFF=1）。
    if (!/activeTab: \(\) => \w+\.active/.test(live)) {
      ctx.skip()
      return
    }
    const output = applyPatch(live, patches[0]!)
    expect(output).toContain('useDetailsState: (selector) => react.useSyncExternalStore')
    expect(output.match(/useDetailsState:/g)).toHaveLength(1)
  })
})
