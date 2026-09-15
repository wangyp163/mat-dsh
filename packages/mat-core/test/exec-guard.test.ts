import { expect, it } from 'vitest'
import {
  GUARD_END_PREFIX,
  GUARD_START_PREFIX,
  RemoteShellCrosstalkError,
  newGuardToken,
  verifyGuardedPayload,
  wrapGuardedCommand,
} from '../src/exec-guard'

// 事故 S3 seq 62103 同形：sbatch 的响应被换成了一份文件列表（code 0 字符串）
const FOREIGN_LISTING = 'molecule.xyz 309 2026-09-04 15:19:04 pre.json run.json opt/ result.json'

it('wrapGuardedCommand：开始标记同行、结束标记独立成行走 stderr、末句透传 rc', () => {
  const token = 'a1b2c3d4e5f60708'
  const wrapped = wrapGuardedCommand('hostname', token)
  const lines = wrapped.split('\n')
  expect(lines[0]).toBe(`printf '\\n${GUARD_START_PREFIX}${token}\\n'; hostname`)
  expect(lines[1]).toBe('__scnx_rc=$?')
  expect(lines[2]).toBe(`printf '\\n${GUARD_END_PREFIX}${token} rc=%s\\n' "$__scnx_rc" >&2`)
  expect(lines[3]).toBe('test "$__scnx_rc" -eq 0')
})

it('wrapGuardedCommand：heredoc 命令（gaussian prepare 形状）不被包裹破坏', () => {
  const token = 'a1b2c3d4e5f60708'
  const command = `mkdir -p /tmp/w && cat > /tmp/w/molecule.xyz << 'XEOF' && echo PREP_READY
3

C 0.0 0.0 0.0
XEOF`
  const wrapped = wrapGuardedCommand(command, token)
  // 包裹语句只追加在命令末行 XEOF 之后的新行，heredoc 定界行保持完整
  expect(wrapped).toContain(`XEOF\n__scnx_rc=$?`)
  expect(wrapped.startsWith(`printf '\\n${GUARD_START_PREFIX}${token}\\n'; mkdir`)).toBe(true)
})

it('code 0：开始标记剥离后 stdout 与原命令输出逐字节一致（含无尾换行）', () => {
  const token = newGuardToken()
  for (const inner of ['cn01\n', '', 'no-newline', 'multi\nline\n']) {
    const payload = { code: 0, data: `\n${GUARD_START_PREFIX}${token}\n${inner}`, message: 'success' }
    expect((verifyGuardedPayload(payload, token) as { data: string }).data).toBe(inner)
  }
})

it('code 0 响应混入他人输出（事故 #1 sbatch→文件列表）→ 抛 RemoteShellCrosstalkError', () => {
  const token = newGuardToken()
  const payload = { code: 0, data: FOREIGN_LISTING, message: 'success' }
  expect(() => verifyGuardedPayload(payload, token)).toThrow(RemoteShellCrosstalkError)
  expect(() => verifyGuardedPayload(payload, token)).toThrow(/foreign\/truncated output.*molecule\.xyz/)
})

it('他人输出若带他方标记（同为包裹命令）同样被拦截（标记 token 不同）', () => {
  const mine = newGuardToken()
  const theirs = newGuardToken()
  const payload = { code: 0, data: `\n${GUARD_START_PREFIX}${theirs}\n${FOREIGN_LISTING}`, message: 'success' }
  expect(() => verifyGuardedPayload(payload, mine)).toThrow(RemoteShellCrosstalkError)
})

it('失败信封：stdout/stderr 剥标记，exitCode 取结束标记的精确 rc（127 不被 test 压成 1）', () => {
  const token = newGuardToken()
  const payload = {
    code: 10020,
    data: {
      stdout: `\n${GUARD_START_PREFIX}${token}\n`,
      stderr: `bash: line 1: nonexistent_cmd_xyz: command not found\n\n${GUARD_END_PREFIX}${token} rc=127\n`,
      exitCode: 1,
    },
    message: 'remote shell command failed',
  }
  const verified = verifyGuardedPayload(payload, token) as { data: { stdout: string; stderr: string; exitCode: number } }
  expect(verified.data.stdout).toBe('')
  // 命令自身 stderr 的尾换行保留，只剥掉我们补的换行+标记行
  expect(verified.data.stderr).toBe('bash: line 1: nonexistent_cmd_xyz: command not found\n')
  expect(verified.data.exitCode).toBe(127)
})

it('失败信封 stderr 混入他人输出（事故 #4 跨会话 stderr 混线）→ 抛串扰错误', () => {
  const mine = newGuardToken()
  const theirs = newGuardToken()
  const payload = {
    code: 10020,
    data: {
      stdout: `\n${GUARD_START_PREFIX}${mine}\n`,
      stderr: `find: '/home/x/ts-irc/irc/irc': No such file or directory\n\n${GUARD_END_PREFIX}${theirs} rc=1\n`,
      exitCode: 1,
    },
    message: 'remote shell command failed',
  }
  expect(() => verifyGuardedPayload(payload, mine)).toThrow(RemoteShellCrosstalkError)
})

it('失败信封 stdout 为空、stderr 带标记 → 正常剥离（rc 透传）', () => {
  const token = newGuardToken()
  const payload = {
    code: 10020,
    data: { stdout: '', stderr: `\n${GUARD_END_PREFIX}${token} rc=2\n`, exitCode: 1 },
    message: 'remote shell command failed',
  }
  const verified = verifyGuardedPayload(payload, token) as { data: { stderr: string; exitCode: number } }
  expect(verified.data.stderr).toBe('')
  expect(verified.data.exitCode).toBe(2)
})

it('服务端级错误（data 空串）原样放行；code 0 空 stdout 不可能合法（标记必在）→ 判串扰', () => {
  const token = newGuardToken()
  expect(verifyGuardedPayload({ code: 10021, data: '', message: 'cluster not found' }, token))
    .toEqual({ code: 10021, data: '', message: 'cluster not found' })
  expect(() => verifyGuardedPayload({ code: 0, data: '', message: '' }, token)).toThrow(RemoteShellCrosstalkError)
})

it('code 0 + 对象 data（stdout 字段）：同样校验并剥离', () => {
  const token = newGuardToken()
  const payload = { code: 0, data: { stdout: `\n${GUARD_START_PREFIX}${token}\ncn01\n` }, message: 'success' }
  const verified = verifyGuardedPayload(payload, token) as { data: { stdout: string } }
  expect(verified.data.stdout).toBe('cn01\n')
})
