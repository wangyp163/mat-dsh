import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const patches = require('../turn-fold-compat.patch.cjs') as Array<{
  id: string
  after?: string[]
  select: string
  expect: number
  apply(context: {
    node: { getStart(): number; getEnd(): number }
    sourceFile: { text: string }
    edit: { overwrite(start: number, end: number, text: string): void }
  }): void
}>
const upstreamRuntime = new URL('./fixtures/dsh-turn-fold-v0.4.4-inline-source.cjs', import.meta.url)

function applyPatch(source: string, patch: (typeof patches)[number]): string {
  const name = patch.select.match(/name\.name="([^"]+)"/)?.[1]
  if (name === undefined) throw new Error(`unsupported test selector: ${patch.select}`)
  const start = source.indexOf(`function ${name}(`)
  if (start < 0) throw new Error(`${patch.id}: target function is missing`)
  let cursor = source.indexOf('{', start)
  let depth = 0
  let end = -1
  for (; cursor < source.length; cursor++) {
    if (source[cursor] === '{') depth++
    if (source[cursor] === '}' && --depth === 0) {
      end = cursor + 1
      break
    }
  }
  if (end < 0) throw new Error(`${patch.id}: target function is incomplete`)
  let output = source
  patch.apply({
    node: { getStart: () => start, getEnd: () => end },
    sourceFile: { text: source },
    edit: { overwrite: (from, to, text) => { output = source.slice(0, from) + text + source.slice(to) } },
  })
  return output
}

describe('turn-fold interactive tool protection', () => {
  it('keeps every unsettled tool node native until its result arrives', async () => {
    let source = await readFile(upstreamRuntime, 'utf8')
    for (const patch of patches) source = applyPatch(source, patch)
    const start = source.indexOf('function __matDshTurnFoldIsUnsettledToolNode')
    const end = source.indexOf('function __ch4acko3DshTurnFoldRenderNativeEntry', start)
    const helpers = new Function(`${source.slice(start, end)}\nreturn {
      isActivity: __ch4acko3DshTurnFoldIsActivityNode,
      isUnsettled: __matDshTurnFoldIsUnsettledToolNode,
    }`)() as {
      isActivity(node: unknown): boolean
      isUnsettled(node: unknown): boolean
    }

    const pendingQuestion = {
      kind: 'tool-call',
      data: { root: { callId: 'call-question', name: 'ask_user_question' } },
    }
    const pendingShell = {
      kind: 'tool-call',
      data: { root: { callId: 'call-shell', name: 'bash' } },
    }
    const answeredQuestion = {
      kind: 'tool-call',
      data: { root: { kind: 'tool-result', callId: 'call-question' } },
    }

    expect(helpers.isUnsettled(pendingQuestion)).toBe(true)
    expect(helpers.isUnsettled(pendingShell)).toBe(true)
    expect(helpers.isUnsettled(answeredQuestion)).toBe(false)
    expect(helpers.isActivity(pendingQuestion)).toBe(false)
    expect(helpers.isActivity(pendingShell)).toBe(false)
    expect(helpers.isActivity(answeredQuestion)).toBe(true)
    expect(source).toContain(
      'FOLD_KINDS[node.kind] === true && !__matDshTurnFoldIsUnsettledToolNode(node)',
    )
  })

  it('runs after turn-fold and fails closed when the upstream shape changes', () => {
    expect(patches).toHaveLength(2)
    for (const patch of patches) {
      expect(patch.after).toEqual(['@ch4acko3/dsh-turn-fold'])
      expect(patch.expect).toBe(1)
      expect(() => applyPatch('function unrelated() {}', patch)).toThrow(/target function is missing/)
    }
  })
})
