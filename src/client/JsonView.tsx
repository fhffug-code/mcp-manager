/** Two ways to read a result: the JSON text, and a tree that folds one level at a time. */
import { palette } from './styles.js'
import type { Translate } from './context.js'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** The value as formatted JSON, cut to a readable size. */
export function JsonText({ value }: { value: unknown }) {
  let text: string
  try {
    text = JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    text = String(value)
  }
  return (
    <pre className="mcpw-code mcpw-scroll" style={{ flex: 1, minHeight: 0, color: palette.text }}>
      {text}
    </pre>
  )
}

const summaryOf = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.length}]`
  if (isRecord(value)) return `{${Object.keys(value).length}}`
  return JSON.stringify(value) ?? String(value)
}

function Node({ name, value, t }: { name?: string; value: unknown; t: Translate }) {
  const label = name === undefined ? '' : `${name}: `
  if (Array.isArray(value) || isRecord(value)) {
    const entries = Array.isArray(value)
      ? value.map((item, index) => [`${index}`, item] as const)
      : Object.entries(value)
    return (
      <details open={entries.length <= 8} style={{ paddingLeft: 12 }}>
        <summary style={{ cursor: 'pointer', color: palette.muted }}>
          {label}
          <span style={{ color: palette.text }}>{summaryOf(value)}</span>
        </summary>
        {entries.length === 0 ? (
          <div style={{ paddingLeft: 12, color: palette.muted }}>{t('emptyValue')}</div>
        ) : (
          entries.map(([key, item]) => <Node key={key} name={key} value={item} t={t} />)
        )}
      </details>
    )
  }
  return (
    <div style={{ paddingLeft: 12 }} className="mcpw-code">
      <span style={{ color: palette.muted }}>{label}</span>
      <span>{JSON.stringify(value) ?? String(value)}</span>
    </div>
  )
}

/** The result as a tree of native, foldable nodes. */
export function JsonTree({ value, t }: { value: unknown; t: Translate }) {
  return (
    <div className="mcpw-scroll" style={{ flex: 1, minHeight: 0 }}>
      <Node value={value} t={t} />
    </div>
  )
}
