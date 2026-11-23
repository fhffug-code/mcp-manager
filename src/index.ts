/** Host entry: one service, one HTTP route, one tool. */
import { normalizeConfig, type WorkbenchConfig } from './config.js'
import { registerRoute } from './route.js'
import { Workbench } from './service.js'
import { registerTool } from './tool.js'
import type { DshConnection, DshHostContext } from './types/dsh.js'

export { PLUGIN_NAME, PLUGIN_VERSION } from './version.js'

/**
 * Mount the workbench.
 * The config is read once per apply and refreshed in place when this plugin stores a server,
 * so a change does not depend on the row reloading.
 */
export function apply(ctx: DshHostContext, rawConfig?: unknown): void {
  const normalized = normalizeConfig(rawConfig)
  for (const warning of normalized.warnings) ctx.logger.warn(`mcp-workbench: ${warning}`)
  let config: WorkbenchConfig = normalized.config
  const workbench = new Workbench({
    ctx,
    config: () => config,
    applyServers: (servers) => {
      config = { ...config, servers }
    },
  })
  ctx.effect(() => workbench.start(), 'mcp-workbench/registrations')
  ctx.inject(['connection'], (scope) => {
    const connection = scope.get<DshConnection>('connection')
    if (connection === undefined) {
      ctx.logger.warn('mcp-workbench: the connection service is not available; the settings page cannot reach the Host')
      return
    }
    scope.effect(() => registerRoute(connection, workbench), 'mcp-workbench/route')
  })
  registerTool(ctx, workbench)
}
