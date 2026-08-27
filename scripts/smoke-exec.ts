import { MatClient, outputText } from '../packages/mat-core/src/index'

async function main() {
  const clusterId = process.argv[2] ?? '11250'
  const command = process.argv[3] ?? 'hostname && whoami'
  const client = new MatClient({
    mcpKey: process.env.MAT_MCP_KEY ?? '',
    baseUrl: process.env.MAT_MCP_BASE_URL || undefined,
  })
  const t0 = Date.now()
  const result = await client.execCommand(clusterId, command, 30)
  console.log(`elapsed_ms=${Date.now() - t0}`)
  console.log(`code=${result.code} message=${result.message}`)
  console.log('--- output ---')
  console.log(outputText(result))
}

main().catch((err) => {
  console.error(`SMOKE_FAIL: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
