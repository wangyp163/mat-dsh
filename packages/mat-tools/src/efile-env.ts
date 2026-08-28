/**
 * efile 文件传输凭证门（纯函数，无 cordis 依赖）。
 *
 * HPC 开放 API 三凭证从环境读取（env.local 本地纪律，与 MAT_MCP_KEY 同处）；
 * 缺谁点名谁，错误消息指引配置位置。
 */

export interface EfileCredentials {
  accessKey: string
  secretKey: string
  user: string
}

/** 依次检查三个环境变量；任一缺失（含空串）抛错，消息按固定序列点名全部缺失项。 */
export function resolveEfileCredentials(env: NodeJS.ProcessEnv): EfileCredentials {
  const names = ['MAT_ACCESS_KEY', 'MAT_SECRET_KEY', 'MAT_USER'] as const
  const missing = names.filter((name) => !(env[name] ?? '').trim())
  if (missing.length > 0) {
    throw new Error(
      `efile file transfer requires ${missing.join(', ')} in the environment — ` +
      'add them to env.local (HPC 开放平台 accessKey/secretKey 与账号名) and restart the harness',
    )
  }
  return {
    accessKey: env.MAT_ACCESS_KEY!.trim(),
    secretKey: env.MAT_SECRET_KEY!.trim(),
    user: env.MAT_USER!.trim(),
  }
}
