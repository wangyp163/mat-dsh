/**
 * batch-subagent spike 探针：直连 mat-core 跑环境门禁（零 LLM 成本）。
 *
 * 用法：set -a; source env.local; set +a; tsx scripts/probe-batch-gate.ts [cluster_id] [timeout_s]
 * 输出：stdout 原样转印远端门禁 JSON（证据落盘用）；退出码非 0 = 探针/传输失败。
 */
import { MatClient, outputText } from '../packages/mat-core/src/index.js'

async function main() {
  const clusterId = process.argv[2] ?? '11250'
  const timeoutSeconds = Number(process.argv[3] ?? 180)
  const command = 'bash $HOME/workspace/.gaussian-calc/scripts/check_environment.sh'
  const client = new MatClient({
    mcpKey: process.env.MAT_MCP_KEY ?? '',
    baseUrl: process.env.MAT_MCP_BASE_URL || undefined,
  })
  const t0 = Date.now()
  const result = await client.execCommand(clusterId, command, timeoutSeconds)
  console.log(`# cluster=${clusterId} elapsed_ms=${Date.now() - t0} code=${result.code} message=${result.message}`)
  console.log(outputText(result))
}

main().catch((err) => {
  console.error(`GATE_PROBE_FAIL: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
