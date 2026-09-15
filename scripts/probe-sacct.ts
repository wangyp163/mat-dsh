/**
 * batch-subagent spike 探针：直查 sacct 作业状态（零 LLM 成本）。
 * 用法：tsx scripts/probe-sacct.ts <cluster_id> <job_id>
 */
import { MatClient, outputText } from '../packages/mat-core/src/index.js'

async function main() {
  const clusterId = process.argv[2] ?? '11250'
  const jobId = process.argv[3] ?? ''
  if (jobId === '') throw new Error('job_id required')
  const client = new MatClient({
    mcpKey: process.env.MAT_MCP_KEY ?? '',
    baseUrl: process.env.MAT_MCP_BASE_URL || undefined,
  })
  const command = `sacct -j ${jobId} -P -n -o JobID,State,ExitCode,ElapsedRaw,WorkDir`
  const r = await client.execCommand(clusterId, command, 30)
  console.log(outputText(r))
}

main().catch((err) => {
  console.error(`SACCT_PROBE_FAIL: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
