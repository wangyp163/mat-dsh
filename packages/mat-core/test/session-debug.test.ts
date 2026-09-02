import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const run = promisify(execFile)
const cli = new URL('../../../scripts/session-debug.ts', import.meta.url).pathname

async function analyze(lines: string): Promise<any> {
  const dir = await mkdtemp(join(tmpdir(), 'session-debug-'))
  const path = join(dir, 'session.jsonl')
  try {
    await writeFile(path, lines)
    const result = await run('pnpm', ['exec', 'tsx', cli, path, '--json'])
    return JSON.parse(result.stdout)
  } finally {
    await rm(dir, { recursive: true })
  }
}

describe('session.jsonl debugger', () => {
  it('reconstructs turns, steps, tool pairs, and lifecycle diagnostics', async () => {
    const lines = [
      JSON.stringify({ type: 'session', id: 's-1', cwd: '/work', agentPreset: 'standard' }),
      JSON.stringify({ type: 'turn/start', seq: 0, time: 1000, data: { turn: 1 } }),
      JSON.stringify({ type: 'step/start', seq: 2, time: 1010, data: { turn: 1, step: 1 } }),
      JSON.stringify({ type: 'user/message', seq: 3, time: 1011, data: { content: [{ type: 'text', text: 'run it' }], source: { kind: 'user' } } }),
      JSON.stringify({ type: 'tool/call', seq: 4, time: 1020, data: { turn: 1, step: 1, callId: 'c1', name: 'bash', arguments: '{"command":"printf secret"}' } }),
      JSON.stringify({ type: 'tool/result', seq: 5, time: 1050, data: { turn: 1, step: 1, message: { source: { kind: 'tool', callId: 'c1' }, content: [{ type: 'tool-result', toolCallId: 'c1', content: [{ type: 'text', text: 'ok' }], isError: false }] } } }),
      JSON.stringify({ type: 'step/end', seq: 6, time: 1060, data: { turn: 1, step: 1 } }),
    ].join('\n')

    const report = await analyze(lines)
    expect(report.session.id).toBe('s-1')
    expect(report.turns[0]).toMatchObject({ turn: 1, state: 'open', userMessages: ['run it'] })
    expect(report.steps[0]).toMatchObject({ turn: 1, step: 1, state: 'closed', durationMs: 50 })
    expect(report.tools[0]).toMatchObject({ name: 'bash', callId: 'c1', state: 'matched', durationMs: 30 })
    expect(report.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'seq-gap', detail: expect.stringContaining('1') }),
      expect.objectContaining({ kind: 'open-turn' }),
    ]))
  })

  it('accounts for packed chunk rows without reporting false sequence gaps', async () => {
    const report = await analyze([
      JSON.stringify({ type: 'session', id: 's-packed' }),
      JSON.stringify({ type: 'turn/start', seq: 0, time: 1000, data: { turn: 1 } }),
      JSON.stringify({ type: 'text-chunks', seq0: 1, time0: 1001, data: { turn: 1, step: 1, index: 0, dt: [2, 3], texts: ['a', 'b', 'c'] } }),
      JSON.stringify({ type: 'turn/end', seq: 4, time: 1010, data: { turn: 1, reason: { kind: 'completed' } } }),
    ].join('\n'))

    expect(report.eventCount).toBe(5)
    expect(report.eventTypes['assistant/chunk']).toBe(3)
    expect(report.storageRows).toBe(4)
    expect(report.diagnostics).not.toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'seq-gap' })]))
  })

  it('reports stale temporary skill resource bases only for skill loads', async () => {
    const report = await analyze([
      JSON.stringify({ type: 'session', id: 's-skill' }),
      JSON.stringify({ type: 'tool/result', seq: 0, time: 1000, data: { turn: 1, step: 1, message: { source: { kind: 'tool', callId: 'skill-call' }, content: [{ type: 'tool-result', toolCallId: 'skill-call', content: [{ type: 'text', text: '<skill_content name="gaussian-calc"><skill_resources>Base directory for this skill: /tmp/mat-dsh-m0-home/skills/gaussian-calc</skill_resources></skill_content>' }] }] } } }),
      JSON.stringify({ type: 'tool/result', seq: 1, time: 1001, data: { turn: 1, step: 1, message: { source: { kind: 'tool', callId: 'other' }, content: [{ type: 'tool-result', toolCallId: 'other', content: [{ type: 'text', text: '/tmp/ordinary-output' }] }] } } }),
    ].join('\n'))

    expect(report.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'stale-skill-root', detail: expect.stringContaining('/tmp/mat-dsh-m0-home/skills/gaussian-calc') }),
    ]))
    expect(report.diagnostics).not.toEqual(expect.arrayContaining([expect.objectContaining({ detail: expect.stringContaining('/tmp/ordinary-output') })]))
  })

  it('reports failed tools and defaults to redacted human-readable content', async () => {
    const report = await analyze([
      JSON.stringify({ type: 'session', id: 's-2', apiKey: 'top-secret' }),
      JSON.stringify({ type: 'turn/start', seq: 0, time: 999, data: { turn: 1 } }),
      JSON.stringify({ type: 'user/message', seq: 1, time: 1000, data: { content: [{ type: 'text', text: 'token sk-test1234567890' }], source: { kind: 'user' } } }),
      JSON.stringify({ type: 'user/message', seq: 2, time: 1001, data: { content: [{ type: 'text', text: 'internal prompt' }], source: { kind: 'plugin', plugin: 'system' } } }),
      JSON.stringify({ type: 'tool/call', seq: 3, time: 1010, data: { turn: 1, step: 1, callId: 'bad', name: 'bash', arguments: '{}' } }),
      JSON.stringify({ type: 'tool/result', seq: 4, time: 1020, data: { turn: 1, step: 1, error: { name: 'Error', code: 'EXIT_1' }, message: { source: { kind: 'tool', callId: 'bad' }, content: [{ type: 'tool-result', toolCallId: 'bad', content: [{ type: 'text', text: 'Authorization: Bearer abc.def' }], isError: true }] } } }),
    ].join('\n'))

    expect(JSON.stringify(report)).not.toContain('sk-test1234567890')
    expect(JSON.stringify(report)).not.toContain('abc.def')
    expect(report.session.apiKey).toBe('[REDACTED]')
    expect(report.turns[0].userMessages).toEqual(['token [REDACTED]'])
    expect(report.tools[0]).toMatchObject({ state: 'failed', error: { name: 'Error', code: 'EXIT_1' } })
    expect(report.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'tool-error' })]))
  })
})
