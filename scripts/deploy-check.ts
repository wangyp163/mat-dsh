/**
 * 新 PC 部署一键自检：set -a; source env.local; set +a; pnpm tsx scripts/deploy-check.ts
 *
 * 六项检查（必需要有 ✓ 才算部署就绪，可选项缺了只降级不拦截）：
 *   1 本机依赖   node ≥18 / pnpm / curl（mat-core 生产传输依赖 curl 二进制）
 *   2 凭证       env.local：MAT_MCP_KEY 必需；LLM 三件/efile 三件/BigModel 可选
 *   3 宿主仓     兄弟布局 deepseek-harness 或 DEEPSEEK_HARNESS_REPO 指向处存在
 *   4 MCP 往返   MatClient.execCommand hostname（完整经过 exec-gate/exec-guard/三级重试）
 *   5 Slurm      sinfo 可见分区（前 3 行）
 *   6 Gaussian   远端 demo workflow（env.sh + bin/gaussian-workflow + 版本）与 g16 env
 * 凭证只检查"已设置"，绝不回显值。远端探测全部只读。
 */

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { MatClient, outputText } from '../packages/mat-core/src/index.js'

const CLUSTER_ID = process.env.MAT_CLUSTER_ID || '11250'
const repoRoot = resolve(new URL('..', import.meta.url).pathname)

let failed = false
function item(ok: boolean, required: boolean, label: string, detail = ''): void {
  const mark = ok ? '✓' : required ? '✗' : '!'
  if (!ok && required) failed = true
  console.log(`${mark} ${label}${detail === '' ? '' : ` — ${detail}`}`)
}

// 1 本机依赖
const nodeMajor = Number(process.versions.node.split('.')[0])
const has = (cmd: string) => { try { execFileSync(cmd, ['--version'], { stdio: 'ignore' }); return true } catch { return false } }
item(nodeMajor >= 18, true, `node ${process.versions.node}`, nodeMajor >= 18 ? '' : '需 ≥18')
item(has('pnpm'), true, 'pnpm')
item(has('curl'), true, 'curl', 'mat-core 默认传输依赖 curl 二进制（MAT_TRANSPORT=fetch 可免）')

// 2 凭证（只看有无，不回显）
const set = (name: string) => (process.env[name] ?? '').trim() !== ''
item(set('MAT_MCP_KEY') && process.env.MAT_MCP_KEY!.startsWith('sk-'), true, 'MAT_MCP_KEY（remote-shell，必需）')
item(set('LLM_API_KEY') && set('LLM_BASE_URL') && set('LLM_MODEL_ID'), false, 'LLM 三件（HPC 网关会话模型）')
item(set('MAT_ACCESS_KEY') && set('MAT_SECRET_KEY') && set('MAT_USER'), false, 'efile 三件（缺省自动回落 remote-shell 分块通道）')
item(set('BIGMODEL_API_KEY'), false, 'BIGMODEL_API_KEY（glm-5.3-flash 多模态，可选）')

// 3 宿主仓（兄弟布局）
const hostRepo = process.env.DEEPSEEK_HARNESS_REPO || join(repoRoot, '..', 'deepseek-harness')
item(existsSync(join(hostRepo, 'package.json')), true, `宿主仓 ${hostRepo}`, '兄弟布局不符时设 DEEPSEEK_HARNESS_REPO')

// 4/5/6 远端（凭证缺失则跳过）
if (!failed && set('MAT_MCP_KEY')) {
  const client = new MatClient({ mcpKey: process.env.MAT_MCP_KEY! })
  try {
    const started = Date.now()
    const hostname = outputText(await client.execCommand(CLUSTER_ID, 'hostname', 30)).trim()
    item(hostname !== '', true, `MCP 往返（${CLUSTER_ID}）`, `${hostname}，${Date.now() - started}ms（含 exec-gate/guard）`)
    const sinfo = outputText(await client.execCommand(CLUSTER_ID, 'sinfo -h -o %P | head -3', 30)).trim()
    item(sinfo !== '', true, 'Slurm 分区可见', sinfo.split('\n').join(', '))
    const probe = await client.execCommand(CLUSTER_ID,
      `test -f "$HOME/workspace/demo/env.sh" && test -x "$HOME/workspace/demo/bin/gaussian-workflow" && echo WF_OK; ` +
      `"$HOME/workspace/demo/bin/python" -c 'import gaussian_workflow; print("WF_VER", getattr(gaussian_workflow, "__version__", "unknown"))' 2>/dev/null; ` +
      `test -x "$HOME/workspace/g16-hy/g16/g16" && echo G16_OK || echo G16_MISSING`,
      60)
    const out = outputText(probe)
    const wfOk = out.includes('WF_OK')
    const wfVer = /WF_VER (\S+)/.exec(out)?.[1] ?? 'n/a'
    const g16Ok = out.includes('G16_OK')
    item(wfOk, true, '远端 demo workflow', `env.sh+CLI 就绪；包自报 ${wfVer}（非权威——权威锚=skill env_profile.sh 1.6.2，新账号缺部署见 DEPLOY.md「远端侧」）`)
    item(g16Ok, true, '远端 g16 环境', g16Ok ? '$HOME/workspace/g16-hy 就绪' : '缺——可由 skill scripts/bootstrap_g16.sh 自动拷贝')
  } catch (err) {
    item(false, true, 'MCP 往返', err instanceof Error ? err.message.slice(0, 160) : String(err))
  }
} else if (set('MAT_MCP_KEY')) {
  console.log('- 远端检查跳过（前序必需项未过）')
} else {
  console.log('- 远端检查跳过（MAT_MCP_KEY 未设置）')
}

console.log(failed ? '\n部署未就绪：存在必需项失败。' : '\n部署就绪：可 scripts/dsh-web.sh start。')
process.exit(failed ? 1 : 0)
