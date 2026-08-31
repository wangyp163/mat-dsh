import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'

/** 回归浏览器 ModuleLoader 契约：不仅检查字符串，还实际调用 factory。 */
describe('mat-ui client bundle', () => {
  it('ModuleLoader factory 自包含 CommonJS module，并返回 apply/inject 导出', async () => {
    const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
    expect(source).not.toContain('React.createElement')
    let factory: ((require: (id: string) => unknown) => unknown) | undefined
    const context = {
      window: {
        __ModuleLoader__: {
          load(entry: { factory: typeof factory }) { factory = entry.factory },
        },
      },
    }
    vm.runInNewContext(source, context)
    expect(factory).toBeTypeOf('function')
    const react = { useEffect: () => {}, useState: () => [[], () => {}] }
    const jsx = { jsx: () => null, jsxs: () => null }
    const exported = factory!((id) => id === 'react' ? react : id === 'react/jsx-runtime' ? jsx : {}) as Record<string, unknown>
    expect(exported.apply).toBeTypeOf('function')
    expect(exported.inject).toEqual(['slots', 'theme'])

    const registrations: Array<Record<string, unknown>> = []
    const ctx = {
      effect: () => {},
      theme: { overrideTokens: () => () => {} },
      slots: {
        inject: (_name: string, callback: () => unknown) => {
          const value = callback()
          if (value && typeof (value as Generator).next === 'function') [...value as Generator]
        },
        register: (options: Record<string, unknown>) => { registrations.push(options); return () => {} },
      },
    }
    ;(exported.apply as (ctx: unknown) => void)(ctx)
    expect(registrations).toContainEqual({
      name: 'conversation.session.header.actions',
      id: 'mat-output-visibility',
      order: 30,
    })
  })
})
