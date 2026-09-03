/** 幂等的 <script> 注入（照宿主 system.ts 形状）：并发共享同一 Promise，失败后可重试。 */
const pending = new Map<string, Promise<void>>()

export function loadScript(src: string): Promise<void> {
  const existing = pending.get(src)
  if (existing !== undefined) return existing
  const loading = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = src
    script.async = true
    script.onload = () => { resolve() }
    script.onerror = () => { pending.delete(src); reject(new Error(`failed to load ${src}`)) }
    document.head.appendChild(script)
  })
  pending.set(src, loading)
  return loading
}
