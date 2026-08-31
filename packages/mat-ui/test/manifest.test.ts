import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('mat-ui browser manifest', () => {
  it('声明所有运行期客户端依赖，保证槽位和主题服务先就绪', async () => {
    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
      dsh: { client: { inject: string[] } }
    }
    expect(manifest.dsh.client.inject).toEqual([
      '@deepseek-ai/dsh-client-runtime',
      '@deepseek-ai/dsh-client-ui-conversation',
      '@deepseek-ai/dsh-client-ui-theme',
      '@deepseek-ai/dsh-client-ui-tool',
    ])
  })
})
