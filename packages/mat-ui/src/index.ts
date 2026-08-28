/**
 * mat-ui 节点半（探针版）：web 运行时注册 /mat-status 路由，把 mat-tools
 * 状态板的快照喂给浏览器卡片。headless 无 webServer → fiber 休眠，不报错
 * （cordis 依赖等待语义，见宿主 vendor/cordis/src/fiber.ts `_refresh`）。
 */
import type { Context } from '@deepseek-ai/cordis'

export const name = 'mat-ui'

export const inject = ['webServer']

export function apply(_ctx: Context): void {
  // 探针：激活即打一行日志；正式路由在 Step 3 落地。
}
