import { MatClient, outputText } from '../packages/mat-core/src/index.js'
const client = new MatClient({ mcpKey: process.env.MAT_MCP_KEY ?? '', baseUrl: process.env.MAT_MCP_BASE_URL || undefined })
// 1) 复现 watch 的 sacct 查询,看 WorkDir 列
const r1 = await client.execCommand('11250', 'sacct -j 123370336,123369654 -P -n -o JobID,State,ExitCode,ElapsedRaw,WorkDir,Timelimit 2>&1 | head -6; echo ===; ls -la "$HOME/workspace/h2o-osc-1c/sp/job.log" 2>&1 | head -2', 60)
console.log('SACCT+LOG:', outputText(r1))
// 2) 用最新作业的 workdir 跑精确的 glob 采样命令
const r2 = await client.execCommand('11250', 'for d in "$HOME/workspace/h2o-osc-1c/sp"; do echo "=== $d"; tail -n 200 "$d/job.log" "$d"/*/job.log 2>/dev/null; done | head -12', 60)
console.log('SAMPLE CMD:', outputText(r2))
