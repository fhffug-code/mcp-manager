/** Browser entry: one panel in the sidebar, and the full page it opens. */
import type { ClientContext } from './context.js'
import { en, zh } from './locales.js'
import { McpPanel } from './McpPanel.js'

/** The locale namespace this page owns. */
export const NS = 'mcpWorkbench'

/** The one id: the sidebar row and the keyed `main` panel must agree on it. */
export const PANEL_ID = 'mcp'

export const inject = ['slots', 'locale']

/** The row's glyph, drawn with the sidebar's own list geometry. */
function McpPanelIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="12.2" cy="11.5" r="1.6" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  )
}

/** Register the row and the page; the Harness puts the row after Plugins and the marketplace. */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { en, zh }) as () => void, 'mcp-workbench/dictionaries')
  ctx.slots.inject('sidebar.panellist', () =>
    ctx.slots.register(
      {
        name: 'sidebar.panellist',
        id: PANEL_ID,
        order: 20,
        label: () => t('panel'),
        locale: NS,
      },
      McpPanelIcon,
    ),
  )
  ctx.slots.inject('main', () =>
    ctx.slots.register(
      {
        name: 'main',
        key: PANEL_ID,
        id: PANEL_ID,
        locale: NS,
        inject: () => ({ t }),
      },
      McpPanel,
    ),
  )
}
