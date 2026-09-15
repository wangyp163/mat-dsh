/**
 * 台账对账脚本（scale-round E2）：批量 sacct 一发取全部台账作业的 ElapsedRaw，
 * 回写 actualCoreHours 并打印估算/实际两本账 diff。
 *
 * 用法：set -a; source env.local; set +a;
 *   DSH_HOME 无关。tsx scripts/reconcile-ledger.ts <cluster_id> <manifest.json>
 */

import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { MatClient, outputText, portfolioFromJson, portfolioToJson, reconcileLedger } from '../packages/mat-core/src/index.js'

async function main(): Promise<void> {
  const clusterId = process.argv[2] ?? '11250'
  const manifestPath = process.argv[3] ?? ''
  if (manifestPath === '') throw new Error('manifest path required')
  const manifest = portfolioFromJson(readFileSync(manifestPath, 'utf8'))
  const jobIds = (manifest.ledger ?? [])
    .map((e) => e.jobId)
    .filter((j): j is string => j !== undefined)
  if (jobIds.length === 0) {
    console.log('no ledger entries with jobId — nothing to reconcile')
    return
  }
  const command = `sacct -j ${jobIds.join(',')} -P -n -o JobID,State,ExitCode,ElapsedRaw,WorkDir`
  const client = new MatClient({
    mcpKey: process.env.MAT_MCP_KEY ?? '',
    baseUrl: process.env.MAT_MCP_BASE_URL || undefined,
  })
  const r = await client.execCommand(clusterId, command, 60)
  if (r.code !== 0) throw new Error(`sacct failed: ${r.message}`)
  const { reconciled, report } = reconcileLedger(manifest, outputText(r))
  const temporary = `${manifestPath}.part`
  writeFileSync(temporary, portfolioToJson(manifest))
  renameSync(temporary, manifestPath)
  console.log(`reconciled ${reconciled} entries -> ${manifestPath}`)
  for (const line of report) console.log(line)
}

main().catch((err) => {
  console.error(`RECONCILE_FAIL: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
