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

/** Rules the inline styles cannot express: resets, hover, focus and clamped text. */
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
.mcp-workbench input, .mcp-workbench select, .mcp-workbench textarea {
  font: inherit; color: ${palette.text}; background: ${palette.input};
  border: 1px solid ${palette.border}; border-radius: ${radius}; padding: 4px 8px; width: 100%;
  box-sizing: border-box;
}
.mcp-workbench textarea { font-family: ${palette.code}; resize: vertical; }
.mcp-workbench input::placeholder, .mcp-workbench textarea::placeholder { color: ${palette.muted}; }
.mcpw-clamp2 {
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.mcpw-scroll { overflow: auto; }
.mcpw-code { font-family: ${palette.code}; white-space: pre-wrap; word-break: break-word; margin: 0; }
`

/** A titled card, the unit both side columns and the detail column use. */
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

export const headerStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  flexShrink: 0,
}

export const labelStyle = { color: palette.muted, fontSize: 12 }

export const inputStyle = { background: palette.input }
