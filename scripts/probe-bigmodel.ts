/**
 * BigModel glm-5.3-flash 接线探针：填好 env.local 的 BIGMODEL_API_KEY 后运行
 *   set -a; source env.local; set +a; pnpm tsx scripts/probe-bigmodel.ts
 *
 * 逐项验证 profile 声明与网关真实行为一致：
 * 1. 纯文本 + zai thinking（enabled + reasoning_effort=high）—— 正常应答；
 * 2. 三档 effort（low/high/max）逐个可发 —— 深度档位生效（非法档会被网关回落 max，不报错）；
 * 3. 图像输入（1×1 PNG data URL）—— 多模态确认（read_image 的前提）；
 * 4. thinking.type=disabled —— GLM-5.3 系应报 400（证明"不可关思考"，等级集不含 off 是对的）。
 */

const BASE_URL = process.env.BIGMODEL_BASE_URL || 'https://open.bigmodel.cn/api/coding/paas/v4'
const API_KEY = process.env.BIGMODEL_API_KEY || ''
const MODEL = process.env.BIGMODEL_MODEL_ID || 'glm-5.3-flash'

if (!API_KEY) {
  console.error('BIGMODEL_API_KEY 未设置（env.local）')
  process.exit(1)
}

// 1×1 红色像素 PNG
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg=='

async function call(label: string, body: Record<string, unknown>) {
  const response = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({ model: MODEL, max_tokens: 1024, ...body }),
    signal: AbortSignal.timeout(90_000),
  })
  const text = await response.text()
  let json: any
  try { json = JSON.parse(text) } catch { json = undefined }
  if (!response.ok) {
    console.log(`${label}: HTTP ${response.status} ${text.slice(0, 160)}`)
    return null
  }
  if (json?.error) {
    console.log(`${label}: API error ${JSON.stringify(json.error).slice(0, 160)}`)
    return null
  }
  const message = json?.choices?.[0]?.message
  const reasoning = typeof message?.reasoning_content === 'string' && message.reasoning_content !== ''
  console.log(`${label}: ok | thinking=${reasoning ? 'on' : 'off'} | content="${String(message?.content ?? '').slice(0, 60).replace(/\n/g, ' ')}"`)
  return json
}

console.log(`endpoint: ${BASE_URL}  model: ${MODEL}`)
await call('1. text + effort=high', {
  messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
  thinking: { type: 'enabled', clear_thinking: false },
  reasoning_effort: 'high',
})
for (const effort of ['low', 'high', 'max'] as const) {
  await call(`2. effort=${effort}`, {
    messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
    thinking: { type: 'enabled', clear_thinking: false },
    reasoning_effort: effort,
  })
}
await call('3. image input', {
  messages: [{
    role: 'user',
    content: [
      { type: 'text', text: 'What color is this image? One word.' },
      { type: 'image_url', image_url: { url: `data:image/png;base64,${PNG_B64}` } },
    ],
  }],
  thinking: { type: 'enabled', clear_thinking: false },
  reasoning_effort: 'high',
})
await call('4. thinking disabled（预期 400：GLM-5.3 系不可关思考）', {
  messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
  thinking: { type: 'disabled' },
})
