/** Browser entry: one Settings → Plugins tab. */
import type { ClientContext } from './context.js'
import { en, zh } from './locales.js'
import { WorkbenchTab } from './WorkbenchTab.js'

/** The locale namespace this page owns. */
export const NS = 'settings.mcpWorkbench'

export const inject = ['slots', 'locale']

/** Register the tab; the Harness renders it inside the Built-in plugins section. */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { en, zh }) as () => void, 'mcp-workbench/dictionaries')
  ctx.slots.inject('settings.plugins.tab', () =>
    ctx.slots.register(
      {
        name: 'settings.plugins.tab',
        id: 'mcp-workbench',
        order: 20,
        label: () => t('tab'),
        locale: NS,
        inject: () => ({ t }),
      },
      WorkbenchTab,
    ),
  )
}
