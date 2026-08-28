import { describe, expect, it } from 'vitest'
import { resolveEfileCredentials } from '../src/efile-env'

// efile 文件传输的凭证门（工具层环境变量约定）：缺谁点名谁，
// 指引写入 env.local —— 与 MAT_MCP_KEY 同一套本地凭证纪律。

describe('resolveEfileCredentials', () => {
  it('齐全 → {accessKey, secretKey, user}', () => {
    expect(resolveEfileCredentials({
      MAT_ACCESS_KEY: 'AK1', MAT_SECRET_KEY: 'SECRET1', MAT_USER: 'user1',
    })).toEqual({ accessKey: 'AK1', secretKey: 'SECRET1', user: 'user1' })
  })

  it('部分缺失 → 抛错点名缺失项（固定顺序）并指引 env.local', () => {
    expect(() => resolveEfileCredentials({ MAT_ACCESS_KEY: 'AK1' }))
      .toThrow(/MAT_SECRET_KEY[\s\S]*MAT_USER[\s\S]*env\.local/)
    expect(() => resolveEfileCredentials({ MAT_USER: 'user1' }))
      .toThrow(/MAT_ACCESS_KEY[\s\S]*MAT_SECRET_KEY/)
    expect(() => resolveEfileCredentials({}))
      .toThrow(/MAT_ACCESS_KEY[\s\S]*MAT_SECRET_KEY[\s\S]*MAT_USER/)
  })

  it('空串视为缺失', () => {
    expect(() => resolveEfileCredentials({
      MAT_ACCESS_KEY: '', MAT_SECRET_KEY: 'SECRET1', MAT_USER: 'user1',
    })).toThrow(/MAT_ACCESS_KEY/)
  })
})
