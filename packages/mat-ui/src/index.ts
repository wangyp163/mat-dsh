/**
 * mat-ui 节点半（探针版）：web 运行时注册 /mat-status 路由，把 mat-tools
 * 状态板的快照喂给浏览器卡片。headless 无 webServer → fiber 休眠，不报错
 * （cordis 依赖等待语义，见宿主 vendor/cordis/src/fiber.ts `_refresh`）。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { StatusBoard } from 'mat-core'

export const name = 'mat-ui'

/** webServer 与状态板都未就绪时保持 dormant，避免抢先注册空路由。 */
export const inject = ['webServer', 'mat.status']

export function apply(ctx: Context): void {
  const board = ctx.get('mat.status') as StatusBoard | undefined
  if (board === undefined) return
  ctx.webServer.register({
    kind: 'exact',
    path: '/mat-status/jobs',
    handler: (_req: IncomingMessage, res: ServerResponse) => {
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.setHeader('cache-control', 'no-store')
      res.setHeader('access-control-allow-origin', '*')
      res.end(JSON.stringify({ jobs: board.list() }))
    },
  })
}
