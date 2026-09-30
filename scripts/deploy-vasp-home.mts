/**
 * deploy-vasp-home.mts —— VASP 家目录双件套一键部署（目标账号参数化）。
 *
 * 用法（目标账号凭证经环境变量注入，不动 env.local 的现行账号凭证）：
 *   set -a; source env.local; set +a        # 本机代理凭证（MAT_MCP_KEY 所属账号）
 *   TARGET_MCP_KEY=sk-xxx tsx scripts/deploy-vasp-home.mts [cluster_id] [--injob-smoke]
 *   # 可选 efile 通道（免 base64 慢速上传）：TARGET_ACCESS_KEY/TARGET_SECRET_KEY/TARGET_USER
 *
 * 部署物（2026-09-24 hpc-user-b 首部署实证，坑全部烧进脚本）：
 *   $HOME/workspace/matstream   基座拷贝 → 陈旧 .conda-unpack-done 删除 → bin/ shebang
 *                               家目录化（公共源在源位置已 unpack，占位前缀不存）→
 *                               wheel 安装（--no-deps：spglib 依赖解析拖 numpy2 会砸
 *                               基座 scipy/matplotlib ABI）→ env.sh + VERSION
 *   $HOME/workspace/vasp-hy     技能侧 bootstrap_vasp.sh（幂等；env.sh 带 mpi/* 卸载
 *                               循环——作业环境预载 mpi/hpcx 与 intelmpi 冲突）
 *   $HOME/workspace/.vasp-calc/scripts/  门禁 v2 播种
 *
 * 大拷贝一律 nohup+flag 轮询（>600s 远端拷贝撞 MCP 单命令上限；客户端超时后远端
 * 继续，exec-gate 串行会让后续调用排队假死——教训 2026-09-24）。
 * 验证链：import 冒烟 → matstream --help → 登录节点 pre 真跑 → 门禁 PASS；
 * --injob-smoke 追加 2 分钟作业内环境链验证（集群副作用）。
 */

import { readFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs'
import { MatClient, outputText, TokenClient, EfileClient } from '../packages/mat-core/src/index.js'
import { parseEnvGateStdout, envGateSchemaFor } from '../packages/mat-core/src/index.js'

const clusterId = process.argv[2] && !process.argv[2].startsWith('-') ? process.argv[2] : '11250'
const injobSmoke = process.argv.includes('--injob-smoke')
const mcpKey = process.env.TARGET_MCP_KEY ?? ''
if (!mcpKey.startsWith('sk-')) {
  console.error('TARGET_MCP_KEY missing/not sk- prefixed — create one in the HPC console for the TARGET account')
  process.exit(1)
}
const client = new MatClient({ mcpKey })

const BASE_SRC = '/public/software/apps/sag-tool/qcsoft/gaussian-workflow/v1.0.0'
const WHEELS = ['matstream-0.1.3-py3-none-any.whl', 'spglib-2.6.0-cp311-cp311-manylinux_2_17_x86_64.manylinux2014_x86_64.whl', 'xmltodict-1.0.4-py3-none-any.whl']
const WHEELS_DIR = '/tmp/mswheels'
const SKILL_DIR = new URL('../skills/vasp-calc/', import.meta.url).pathname

async function run(label: string, cmd: string, t = 120): Promise<string> {
  const r = await client.execCommand(clusterId, cmd, t)
  const text = outputText(r).trim()
  console.log(`[${label}] rc=${r.code} ${text.length > 400 ? text.slice(0, 400) + '…' : text}`)
  return text
}

// ── 0. 身份确认（防拿错 key 部署错账号） ──
const id = await run('identity', 'hostname && whoami && echo HOME=$HOME')
const whoami = id.match(/HOME=(\S+)/)?.[1] ?? ''
console.log(`\n>>> target home: ${whoami}\n`)
if (whoami === '') throw new Error('cannot resolve $HOME on target')

// ── 1. 大拷贝 nohup+flag（基座 + VASP） ──
const flag = await run('copy-status', 'ls $HOME/workspace/logs/vasp-home-deploy.flag 2>/dev/null && echo DONE || echo NOT_YET')
if (!flag.includes('DONE')) {
  await run('copy-kick', [
    'mkdir -p $HOME/workspace/logs',
    `nohup bash -c 'cp -a ${BASE_SRC} $HOME/workspace/matstream; rm -f $HOME/workspace/matstream/.conda-unpack-done; cp -a /public/software/apps/sag-tool/vasp/5.4.4-ioptcell_intelmpi2017_hdf5_libxc $HOME/workspace/vasp-hy; echo DONE > $HOME/workspace/logs/vasp-home-deploy.flag' > $HOME/workspace/logs/vasp-home-deploy.flag.log 2>&1 & echo KICKED`,
  ].join('\n'), 60)
  console.log('copies kicked (base ~600M + vasp 109M; est 10-20 min). Polling…')
  const deadline = Date.now() + 40 * 60_000
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 60_000))
    const s = await run('copy-poll', 'ls $HOME/workspace/logs/vasp-home-deploy.flag 2>/dev/null >/dev/null && echo DONE || du -sh $HOME/workspace/matstream 2>/dev/null', 60)
    if (s.includes('DONE')) break
  }
}
const done = await run('copy-verify', '[ -x $HOME/workspace/matstream/bin/python ] && [ -x $HOME/workspace/vasp-hy/app/bin/vasp_std ] && echo COPIES_OK || echo COPIES_BAD')
if (!done.includes('COPIES_OK')) throw new Error('copies incomplete — inspect [copy-poll] output')

// ── 2. shebang 家目录化（公共源在源位置已 unpack；conda-unpack 对烧死路径无效） ──
await run('shebang-fix', [
  'cd $HOME/workspace/matstream',
  // 双引号让远端 bash 展开 $HOME；单引号会把字面量 $HOME 写进 shebang（内核不展开）
  `grep -rl '${BASE_SRC}' bin/ 2>/dev/null | while read f; do sed -i "s|${BASE_SRC}|\$HOME/workspace/matstream|g" "\$f"; done`,
  // 修复通道：旧版脚本已把字面量 "$HOME/..." 写进 shebang 的场景
  // （[$] 匹配字面量 $；替换侧经双引号由远端 bash 展开为真实路径）
  `grep -rl '[$]HOME/workspace/matstream' bin/ 2>/dev/null | while read f; do sed -i "s|[$]HOME/workspace/matstream|$HOME/workspace/matstream|g" "\$f"; done`,
  'echo SHEBANG_DONE',
].join('\n'))

// ── 3. wheels 就位：efile（有 AK/SK）或 base64 分块过 remote shell ──
mkdirSync(WHEELS_DIR, { recursive: true })
if (!existsSync(`${WHEELS_DIR}/matstream-0.1.3-py3-none-any.whl`)) {
  copyFileSync('~/dev/agent-workflow/dist/matstream-0.1.3-py3-none-any.whl', `${WHEELS_DIR}/matstream-0.1.3-py3-none-any.whl`)
}
const efileReady = (process.env.TARGET_ACCESS_KEY ?? '') !== '' && (process.env.TARGET_SECRET_KEY ?? '') !== '' && (process.env.TARGET_USER ?? '') !== ''
if (efileReady) {
  const token = new TokenClient({ accessKey: process.env.TARGET_ACCESS_KEY!, secretKey: process.env.TARGET_SECRET_KEY!, user: process.env.TARGET_USER! })
  const tokens = await token.getTokens()
  const hit = tokens.find((t) => t.clusterId === clusterId)
  if (!hit?.token) throw new Error(`no efile token for cluster ${clusterId}`)
  const url = hit.efileUrls?.[0]?.url ?? 'https://ksefile.internal-hpc.example:65241/efile' // 新账号 center 发现 404 已知坑：直用集群级端点
  const efile = new EfileClient({ token: hit.token, efileUrl: url })
  await run('wheels-dir', 'mkdir -p $HOME/workspace/matstream/wheels', 30)
  for (const f of WHEELS) {
    await efile.uploadFile(`${WHEELS_DIR}/${f}`, `${whoami}/workspace/matstream/wheels`)
    console.log(`[efile] uploaded ${f}`)
  }
} else {
  console.log('[wheels] no TARGET_* efile creds — falling back to base64 chunk transfer (~8.5M total)')
  for (const f of WHEELS) {
    const buf = readFileSync(`${WHEELS_DIR}/${f}`)
    const b64 = buf.toString('base64')
    await run(`w-clear-${f}`, `rm -f /tmp/${f}.b64 /tmp/${f}`, 30)
    // MCP 网关对超大请求体会掐连接（curl rc=1；2026-09-24 二分实证：200K 挂、100K 过）。
    const CHUNK = 100_000
    for (let off = 0; off < b64.length; off += CHUNK) {
      const part = b64.slice(off, off + CHUNK)
      await run(`w-chunk-${f.slice(0, 8)}-${off}`, `printf '%s' '${part}' >> /tmp/${f}.b64`, 120)
    }
    await run(`w-decode-${f.slice(0, 8)}`, `base64 -d /tmp/${f}.b64 > $HOME/workspace/matstream/wheels/${f} 2>/dev/null || (mkdir -p $HOME/workspace/matstream/wheels && base64 -d /tmp/${f}.b64 > $HOME/workspace/matstream/wheels/${f}); rm -f /tmp/${f}.b64; ls -la $HOME/workspace/matstream/wheels/${f}`, 60)
  }
}

// ── 4. 安装（--no-deps！）+ env.sh + VERSION ──
await run('pip-install', 'cd $HOME/workspace/matstream && bin/python -m pip install --no-deps --force-reinstall wheels/*.whl 2>&1 | tail -2', 540)
await run('write-env', `cat > $HOME/workspace/matstream/env.sh << 'ENV_EOF'
#!/bin/bash
# matstream workflow conda-pack 环境（python3.11 + ase3.29 + numpy1.26 + scipy + matplotlib
#   + matstream/spglib/xmltodict，「matstream」entry-point）。
ENV_ROOT="${whoami}/workspace/matstream"
: "\${LD_LIBRARY_PATH:=}"; : "\${CONDA_PREFIX:=}"
if [ -n "\$CONDA_PREFIX" ]; then
    export PATH="\$(echo "\$PATH" | sed -e "s|\${CONDA_PREFIX}/bin||g" -e "s|::|:|g" -e "s|^:||" -e "s|:\$||")"
    unset CONDA_DEFAULT_ENV CONDA_PREFIX CONDA_PROMPT_MODIFIER CONDA_SHLVL
fi
if [ -x "\$ENV_ROOT/bin/python" ]; then
    export PATH="\$ENV_ROOT/bin:\$PATH"
    export CONDA_PREFIX="\$ENV_ROOT"
    export CONDA_DEFAULT_ENV="matstream"
fi
echo "[MATSTREAM] Environment loaded"
ENV_EOF
echo "0.1.3" > $HOME/workspace/matstream/VERSION && touch $HOME/workspace/matstream/.conda-unpack-done && echo ENV_WRITTEN`)

// ── 5. vasp-hy：跑技能侧 bootstrap（幂等，单一事实源） ──
const bootstrap = readFileSync(`${SKILL_DIR}scripts/bootstrap_vasp.sh`, 'utf8')
await run('bootstrap-vasp', ['mkdir -p $HOME/workspace/.deploy', "cat > $HOME/workspace/.deploy/bootstrap_vasp.sh << 'BS_EOF'", bootstrap, 'BS_EOF', 'bash $HOME/workspace/.deploy/bootstrap_vasp.sh 2>&1 | tail -3'].join('\n'), 540)

// ── 6. 冒烟：import + CLI + 登录节点 pre 真跑 ──
const imports = await run('import-smoke', '$HOME/workspace/matstream/bin/python -c \'import numpy, spglib, xmltodict, ase, matstream; print(numpy.__version__, spglib.__version__, ase.__version__, matstream.__version__)\'', 120)
console.log(`[import] ${imports}`)
const pre = await run('pre-smoke', [
  'mkdir -p $HOME/workspace/vasp-pre-smoke && cd $HOME/workspace/vasp-pre-smoke && rm -rf Task.* matstream.json',
  `printf 'Si diamond\\n1.0\\n 5.43 0 0\\n 0 5.43 0\\n 0 0 5.43\\nSi\\n8\\ndirect\\n 0 0 0\\n .25 .25 .25\\n .5 .5 0\\n .75 .75 .25\\n .5 0 .5\\n .75 .25 .75\\n 0 .5 .5\\n .25 .75 .75\\n' > POSCAR`,
  'source $HOME/workspace/matstream/env.sh && matstream pre -c vasp -t relax -f POSCAR -p veryfast -m nospin >/dev/null 2>&1; ls Task.Relax/INCAR Task.Relax/POTCAR >/dev/null 2>&1 && echo PRE_OK || echo PRE_FAIL',
].join(' && ').replace('&& source', '; source'), 540)
if (!pre.includes('PRE_OK')) throw new Error('login-node pre smoke failed')

// ── 7. 门禁 v2 播种 + 判定 ──
const gate = readFileSync(`${SKILL_DIR}scripts/check_environment.sh`, 'utf8')
const profile = readFileSync(`${SKILL_DIR}scripts/env_profile.sh`, 'utf8')
const gateOut = await run('gate', [
  'mkdir -p $HOME/workspace/.vasp-calc/scripts',
  "cat > $HOME/workspace/.vasp-calc/scripts/env_profile.sh << 'ENV_EOF'", profile, 'ENV_EOF',
  "cat > $HOME/workspace/.vasp-calc/scripts/check_environment.sh << 'GATE_EOF'", gate, 'GATE_EOF',
  'chmod +x $HOME/workspace/.vasp-calc/scripts/check_environment.sh && bash $HOME/workspace/.vasp-calc/scripts/check_environment.sh',
].join('\n'), 300)
const parsed = parseEnvGateStdout(gateOut, envGateSchemaFor('vasp'))
console.log(`[gate] ${parsed.status}${parsed.reason !== undefined ? ` — ${parsed.reason}` : ''}`)
if (parsed.status !== 'pass') throw new Error(`env gate not pass: ${parsed.reason}`)

console.log('\n=== DEPLOY OK ===')
console.log(`matstream + vasp-hy + gate v2 provisioned for ${whoami} on cluster ${clusterId}`)
if (injobSmoke) {
  console.log('(in-job smoke: run `tsx scripts/probe-vasp-matstream.ts ' + clusterId + ' --smoke` with the TARGET key in MAT_MCP_KEY)')
}
