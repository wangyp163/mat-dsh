import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { MatClient, outputText } from 'mat-core'

export const name = 'mat-tools'
export const inject = ['tools']

let client: MatClient | undefined

function getClient(): MatClient {
  if (!client) {
    const mcpKey = process.env.MAT_MCP_KEY ?? ''
    client = new MatClient({ mcpKey, baseUrl: process.env.MAT_MCP_BASE_URL || undefined })
  }
  return client
}

export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'mat_exec',
    description:
      'Execute a shell command on a remote HPC HPC cluster via remote-shell. ' +
      'Returns stdout, or stdout/stderr/exitCode when the remote command fails. ' +
      'Use for cluster inspection (sinfo, squeue, ls) and lightweight commands; ' +
      'long-running compute must go through Slurm submission, not this tool.',
    parameters: {
      cluster_id: { type: 'string', required: true, description: 'HPC cluster id, e.g. 11250 (华东一区【昆山】)' },
      command: { type: 'string', required: true, description: 'Shell command to run on the cluster login node' },
      timeout_seconds: { type: 'number', description: 'Remote timeout in seconds (default 30)' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) {
      const result = await getClient().execCommand(
        args.cluster_id,
        args.command,
        args.timeout_seconds ?? 30,
      )
      return outputText(result)
    },
  }))
}
