import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
// 引入 dsh-system-prompt 的 Context 声明合并（仅类型）。
import type {} from '@deepseek-ai/dsh-system-prompt'
import { MatClient, outputText } from 'mat-core'

export const name = 'mat-tools'
export const inject = ['tools', 'systemPrompt']

let client: MatClient | undefined

function getClient(): MatClient {
  if (!client) {
    const mcpKey = process.env.MAT_MCP_KEY ?? ''
    client = new MatClient({ mcpKey, baseUrl: process.env.MAT_MCP_BASE_URL || undefined })
  }
  return client
}

export function apply(ctx: Context): void {
  // 工具引导段（宿主约定：tool guidance 槽位 100–199）——让模型第一时间知道
  // HPC 计算套件的存在、适用场景与 Slurm 工作流，而不是只靠工具 schema 自行发现。
  ctx.systemPrompt.section({
    name: 'tool:mat-exec',
    order: 100,
    text:
      'HPC HPC clusters are directly reachable through the mat_exec tool. ' +
      'For any request about HPC clusters, Slurm jobs, or remote scientific computing, ' +
      'call mat_exec instead of answering from memory or claiming you cannot access remote machines. ' +
      'Pass the cluster id from the conversation (example: "11250", HPC East-1 Kunshan) ' +
      'and one shell command; it runs on the cluster login node and returns stdout, ' +
      'or stdout/stderr/exitCode when the command fails. ' +
      'Long-running compute (Gaussian, VASP, and similar) must run through Slurm: ' +
      'use mat_exec to inspect the environment (module avail, sinfo), write input files, ' +
      'submit with sbatch, and poll with squeue/sacct — never run the compute synchronously.',
  })

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
