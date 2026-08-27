export const DEFAULT_MCP_BASE_URL = 'https://mcp-gateway.example.internal/api'
export const REMOTE_SHELL_SERVICE_ID = '7552849000000000000'

export function buildMcpUrl(mcpKey: string, baseUrl?: string, serviceId?: string): string {
  const base = (baseUrl || DEFAULT_MCP_BASE_URL).replace(/\/+$/, '')
  const svc = serviceId || REMOTE_SHELL_SERVICE_ID
  return `${base}/mcp/${mcpKey}/${svc}/mcp`
}
