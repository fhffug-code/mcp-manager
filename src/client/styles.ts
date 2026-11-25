/**
 * The palette and the one stylesheet the panel needs.
 * Every value comes from a real Harness token: an invented one falls back and breaks dark mode.
 */
export const palette = {
  text: 'var(--dsw-alias-label-primary, inherit)',
  muted: 'var(--dsw-alias-label-tertiary, inherit)',
  border: 'var(--dsw-alias-border-l2, currentColor)',
  panel: 'var(--dsw-alias-card-fill, transparent)',
  input: 'var(--dsw-alias-bg-base, transparent)',
  selected: 'var(--dsw-alias-interactive-bg-hover-solid, transparent)',
  selectedBorder: 'var(--dsw-alias-border-selected, currentColor)',
  accent: 'var(--dsw-alias-link, currentColor)',
  danger: 'var(--dsw-alias-state-error-primary, currentColor)',
  success: 'var(--dsw-alias-state-success-primary, currentColor)',
  code: 'var(--ds-font-family-code, ui-monospace)',
} as const

const radius = 'var(--dsw-radius-sm, 8px)'
const radiusLarge = 'var(--dsw-radius-md, 12px)'

/** The line that separates one band of the page from the next. */
export const hairline = `1px solid ${palette.border}`

/** Rules the inline styles cannot express: splits, resets, hover, focus and clamped text. */
export const STYLES = `
.mcp-workbench { color: ${palette.text}; font-size: 13px; }
.mcp-workbench button {
  font: inherit; color: inherit; background: transparent; border: 1px solid ${palette.border};
  border-radius: ${radius}; padding: 4px 10px; cursor: pointer;
}
.mcp-workbench button:hover { background: ${palette.selected}; }
.mcp-workbench button:disabled { opacity: .5; cursor: default; }
.mcp-workbench button.mcpw-primary { border-color: ${palette.selectedBorder}; }
.mcp-workbench button.mcpw-link { border: none; padding: 2px 6px; color: ${palette.accent}; }
.mcp-workbench button.mcpw-icon { border: none; padding: 2px 6px; color: ${palette.muted}; }
.mcp-workbench button.mcpw-list { display: block; width: 100%; text-align: start; border: 1px solid transparent; }
.mcp-workbench button.mcpw-list[aria-current='true'] {
  background: ${palette.selected}; border-color: ${palette.selectedBorder};
}
.mcp-workbench button.mcpw-switch {
  position: relative; flex: none; width: 30px; height: 18px; padding: 0; border-radius: 999px;
  background: transparent; border: 1px solid ${palette.border};
}
.mcp-workbench button.mcpw-switch > span {
  position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%;
  background: ${palette.muted}; transition: transform .12s ease, background .12s ease;
}
.mcp-workbench button.mcpw-switch[aria-checked='true'] {
  background: ${palette.selected}; border-color: ${palette.selectedBorder};
}
.mcp-workbench button.mcpw-switch[aria-checked='true'] > span {
  transform: translateX(12px); background: ${palette.text};
}
.mcp-workbench button.mcpw-switch[aria-busy='true'] > span { opacity: .45; }
.mcp-workbench input, .mcp-workbench select, .mcp-workbench textarea {
  font: inherit; color: ${palette.text}; background: ${palette.input};
  border: 1px solid ${palette.border}; border-radius: ${radius}; padding: 4px 8px; width: 100%;
  box-sizing: border-box;
}
.mcp-workbench textarea { font-family: ${palette.code}; resize: vertical; }
.mcp-workbench input::placeholder, .mcp-workbench textarea::placeholder { color: ${palette.muted}; }
.mcpw-split {
  display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 8fr);
  flex: 1; min-height: 0; column-gap: 0;
}
.mcpw-rows {
  display: grid; grid-template-rows: minmax(0, 3fr) minmax(0, 7fr);
  flex: 1; min-height: 0; row-gap: 0;
}
.mcpw-divide-right { border-right: ${hairline}; }
.mcpw-divide-bottom { border-bottom: ${hairline}; }
.mcpw-clamp2 {
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.mcpw-scroll { overflow: auto; }
.mcpw-code { font-family: ${palette.code}; white-space: pre-wrap; word-break: break-word; margin: 0; }
@media (max-width: 900px) {
  .mcpw-split { grid-template-columns: minmax(0, 1fr); grid-auto-rows: minmax(0, 1fr); }
  .mcpw-rows { grid-template-rows: minmax(0, 1fr); grid-auto-rows: minmax(0, 1fr); }
  .mcpw-divide-right { border-right: none; border-bottom: ${hairline}; }
}
`

/** A titled card, used by the configuration dialog. */
export const panelStyle = {
  background: palette.panel,
  border: `1px solid ${palette.border}`,
  borderRadius: radiusLarge,
  padding: 10,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 8,
}

/** The page's title row: the name on the start, the one page-level action on the end. */
export const headerStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  flexShrink: 0,
}

/** One band of the page: it fills its cell and scrolls inside instead of growing it. */
export const columnStyle = {
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 8,
  padding: 10,
  minWidth: 0,
  minHeight: 0,
}

/** A band's tool row: one action on the start, one search box on the end. */
export const barStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  padding: '8px 10px',
  flexShrink: 0,
}

export const labelStyle = { color: palette.muted, fontSize: 12 }

export const inputStyle = { background: palette.input }
