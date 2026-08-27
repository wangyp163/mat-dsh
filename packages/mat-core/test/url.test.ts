import { expect, it } from 'vitest'
import { buildMcpUrl, DEFAULT_MCP_BASE_URL, REMOTE_SHELL_SERVICE_ID } from '../src/url'

it('默认网关构造 remote-shell MCP URL', () => {
  expect(buildMcpUrl('sk-TEST')).toBe(
    `${DEFAULT_MCP_BASE_URL}/mcp/sk-TEST/${REMOTE_SHELL_SERVICE_ID}/mcp`,
  )
})

it('自定义 base_url 与 service_id 生效', () => {
  expect(buildMcpUrl('sk-K', 'http://mcp-dev-gw.internal:32399', 'svc1')).toBe(
    'http://mcp-dev-gw.internal:32399/mcp/sk-K/svc1/mcp',
  )
})

it('base_url 尾部斜杠被归一', () => {
  expect(buildMcpUrl('sk-K', 'http://gw:1/')).toBe('http://gw:1/mcp/sk-K/svc1/mcp'.replace('svc1', REMOTE_SHELL_SERVICE_ID))
})
