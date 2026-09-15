/**
 * remote_shell_execute 输出归属校验（2026-09-04 15:19 三并发会话输出串扰修复）。
 *
 * exec-gate 把同 (密钥, 集群) 的命令串行化，防住本侧全部调用方；但当第三方
 * 进程绕过闸并发调用、或服务端路由故障复发时，串行化无法兜底——本模块给每条
 * 命令打上本次调用独有的开始/结束标记，响应里找不到自己的标记即判定为他人
 * 输出，抛 RemoteShellCrosstalkError 触发上层重试（新标记重发），把「静默
 * 拿错数据」变成「可检测的显式失败」。事故四例（sbatch 返回文件列表、stat
 * 解析到他人 ls、post 返回他人目录列表、stderr 混线）在此全部会被拦截。
 *
 * 包裹形状（POSIX，逐语句独立成行，不吞命令内部的 heredoc/注释/续行）：
 *   printf '\nSCNXS:<token>\n'; <command>
 *   __scnx_rc=$?
 *   printf '\nSCNXE:<token> rc=%s\n' "$__scnx_rc" >&2
 *   test "$__scnx_rc" -eq 0
 * 开始标记走 stdout、结束标记走 stderr（成功信封只回 stdout，不占预算）；
 * 末句 test 把命令真实退出码透传给整条包裹命令，结束标记里的 rc 保留精确值
 * （test 会把非零压成 1）。校验通过的响应剥掉标记后原样返回，语义与无防护
 * 版本完全一致。
 */

import { randomBytes } from 'node:crypto'

export const GUARD_START_PREFIX = 'SCNXS:'
export const GUARD_END_PREFIX = 'SCNXE:'

/** 误拿他人输出（串扰/路由错乱）时抛出；上层按传输故障重试。 */
export class RemoteShellCrosstalkError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RemoteShellCrosstalkError'
  }
}

export function newGuardToken(): string {
  return randomBytes(8).toString('hex')
}

/** 包裹命令；token 必须是 [0-9a-f]+（newGuardToken 产物）。 */
export function wrapGuardedCommand(command: string, token: string): string {
  return [
    `printf '\\n${GUARD_START_PREFIX}${token}\\n'; ${command}`,
    '__scnx_rc=$?',
    `printf '\\n${GUARD_END_PREFIX}${token} rc=%s\\n' "$__scnx_rc" >&2`,
    'test "$__scnx_rc" -eq 0',
  ].join('\n')
}

function snippet(text: string, limit = 120): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat
}

function startMarkerLine(token: string): string {
  return `${GUARD_START_PREFIX}${token}`
}

function endMarkerPattern(token: string): RegExp {
  return new RegExp(`^${GUARD_END_PREFIX}${token} rc=(\\d+)$`)
}

/** 按整行精确匹配剥离开始标记，返回标记行之后的原始 stdout。 */
function stripStartMarker(stdout: string, token: string): string | null {
  const marker = startMarkerLine(token)
  const lines = stdout.split('\n')
  const index = lines.indexOf(marker)
  if (index === -1) return null
  return lines.slice(index + 1).join('\n')
}

/** 剥离结束标记，返回 [原始 stderr, 命令真实退出码]；找不到标记返回 null。 */
function stripEndMarker(stderr: string, token: string): { stderr: string; rc: number } | null {
  const pattern = endMarkerPattern(token)
  const lines = stderr.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    const match = pattern.exec(lines[i])
    if (match) return { stderr: lines.slice(0, i).join('\n'), rc: Number(match[1]) }
  }
  return null
}

function crosstalk(what: string, text: string): RemoteShellCrosstalkError {
  return new RemoteShellCrosstalkError(
    `remote-shell output crosstalk suspected (${what} has no guard marker for this call; ` +
    `got foreign/truncated output: "${snippet(text)}")`,
  )
}

/**
 * 校验并剥离 remote_shell_execute 响应中的防护标记。
 * - code 0 + 字符串 data：stdout 必含开始标记，缺失即串扰；
 * - 失败信封（data 为含 stdout/stderr 的对象）：非空流各自必须携带对应标记，
 *   退出码以结束标记内的 rc 为准（保留 test 压码前的精确值）；
 * - 服务端级错误（data 为空串/无 shell 流）：无命令输出可验，原样放行。
 */
export function verifyGuardedPayload(payload: Record<string, unknown>, token: string): Record<string, unknown> {
  const code = typeof payload.code === 'number' ? payload.code : Number(payload.code ?? -1)
  const data = payload.data
  if (code === 0 && typeof data === 'string') {
    const inner = stripStartMarker(data, token)
    if (inner === null) throw crosstalk('success stdout', data)
    return { ...payload, data: inner }
  }
  if (code === 0 && typeof data === 'object' && data !== null && !Array.isArray(data)
    && typeof (data as Record<string, unknown>).stdout === 'string') {
    const raw = (data as Record<string, unknown>).stdout as string
    const inner = stripStartMarker(raw, token)
    if (inner === null) throw crosstalk('success stdout', raw)
    return { ...payload, data: { ...(data as Record<string, unknown>), stdout: inner } }
  }
  if (code !== 0 && typeof data === 'object' && data !== null && !Array.isArray(data)) {
    const envelope = { ...(data as Record<string, unknown>) }
    if (typeof envelope.stdout === 'string' && envelope.stdout !== '') {
      const inner = stripStartMarker(envelope.stdout, token)
      if (inner === null) throw crosstalk('failure stdout', envelope.stdout)
      envelope.stdout = inner
    }
    if (typeof envelope.stderr === 'string' && envelope.stderr !== '') {
      const stripped = stripEndMarker(envelope.stderr, token)
      if (stripped === null) throw crosstalk('failure stderr', envelope.stderr)
      envelope.stderr = stripped.stderr
      envelope.exitCode = stripped.rc
    }
    return { ...payload, data: envelope }
  }
  return payload
}
