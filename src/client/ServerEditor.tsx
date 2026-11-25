/** Add a server, or edit one that already exists. The form is the only place the shapes are built. */
import { useState } from 'react'
import type { ServerPatch, ServerView, TransportKind } from '../types/index.js'
import type { Translate } from './context.js'
import { draftOf, patchOf, type Draft, type Row } from './format.js'
import { inputStyle, labelStyle, palette, panelStyle } from './styles.js'

export interface EditorProps {
  /** The server to edit; absent means a new one. */
  view?: ServerView
  t: Translate
  onCancel(): void
  onAdd(name: string, spec: unknown): Promise<void>
  onSave(patch: ServerPatch): Promise<void>
  /** Present when the row may be deleted from here. */
  onDelete?(): Promise<void>
}

const fieldStyle = { display: 'flex', flexDirection: 'column' as const, gap: 4 }

const numberOrUndefined = (text: string): number | undefined => {
  const value = Number.parseInt(text.trim(), 10)
  return Number.isInteger(value) && value > 0 ? value : undefined
}

/** One side's map, read the way the form holds it. */
const valuesOf = (rows: readonly Row[]): Record<string, string> | undefined => {
  const values: Record<string, string> = {}
  for (const row of rows) {
    if (row.name.trim() === '' || row.value === '') continue
    values[row.name.trim()] = row.value
  }
  return Object.keys(values).length === 0 ? undefined : values
}

/** The name/value rows of one map, editable. */
function RowEditor({ rows, t, onChange }: { rows: Row[]; t: Translate; onChange(next: Row[]): void }) {
  const add = (): void => {
    onChange([...rows, { key: '', name: '', value: '', secret: false, original: false, remove: false }])
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {rows.map((row, index) => (
        <div key={`${row.key}-${index}`} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 6 }}>
          <input
            aria-label={t('rowName')}
            placeholder={t('rowName')}
            style={inputStyle}
            value={row.name}
            onChange={(event) => {
              const next = [...rows]
              next[index] = { ...row, name: event.target.value }
              onChange(next)
            }}
          />
          <input
            aria-label={t('rowValue')}
            placeholder={row.secret ? (row.expression ?? t('rowSecret')) : t('rowValue')}
            style={inputStyle}
            value={row.value}
            onChange={(event) => {
              const next = [...rows]
              next[index] = { ...row, value: event.target.value }
              onChange(next)
            }}
          />
          <button
            type="button"
            className="mcpw-icon"
            aria-label={t('removeRow')}
            onClick={() => onChange(rows.filter((_, at) => at !== index))}
          >
            ×
          </button>
        </div>
      ))}
      <button type="button" className="mcpw-link" onClick={add} style={{ alignSelf: 'flex-start' }}>
        + {t('addRow')}
      </button>
    </div>
  )
}

/** The server form: a dialog the panel opens, kept apart from the panel's own state. */
export function ServerEditor({ view, t, onCancel, onAdd, onSave, onDelete }: EditorProps) {
  const initial: Draft | undefined = view === undefined ? undefined : draftOf(view)
  const [name, setName] = useState('')
  // Both sides keep their own draft, so switching the transport and switching back finds the values.
  const [transport, setTransport] = useState<TransportKind>(view?.transport ?? 'stdio')
  const [command, setCommand] = useState(initial?.command ?? '')
  const [args, setArgs] = useState(initial?.args ?? '')
  const [cwd, setCwd] = useState(initial?.cwd ?? '')
  const [url, setUrl] = useState(initial?.url ?? '')
  const [toolCallTimeoutMs, setToolCall] = useState(initial?.toolCallTimeoutMs ?? '')
  const [startupTimeoutMs, setStartup] = useState(initial?.startupTimeoutMs ?? '')
  const [closeTimeoutMs, setClose] = useState(initial?.closeTimeoutMs ?? '')
  const [env, setEnv] = useState<Row[]>(initial?.env ?? [])
  const [headers, setHeaders] = useState<Row[]>(initial?.headers ?? [])
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const draft = (): Draft => ({
    command,
    args,
    cwd,
    url,
    toolCallTimeoutMs,
    startupTimeoutMs,
    closeTimeoutMs,
    env,
    headers,
  })

  const specOf = (): Record<string, unknown> => {
    const spec: Record<string, unknown> = { transport }
    if (transport === 'stdio') {
      spec['command'] = command.trim()
      if (args.trim() !== '') spec['args'] = args.trim().split(/\s+/)
      if (cwd.trim() !== '') spec['cwd'] = cwd.trim()
      const values = valuesOf(env)
      if (values !== undefined) spec['env'] = values
    } else {
      spec['url'] = url.trim()
      const values = valuesOf(headers)
      if (values !== undefined) spec['headers'] = values
    }
    const toolCall = numberOrUndefined(toolCallTimeoutMs)
    if (toolCall !== undefined) spec['toolCallTimeoutMs'] = toolCall
    const startup = numberOrUndefined(startupTimeoutMs)
    if (startup !== undefined) spec['startupTimeoutMs'] = startup
    const close = numberOrUndefined(closeTimeoutMs)
    if (close !== undefined) spec['closeTimeoutMs'] = close
    return spec
  }

  const submit = async (): Promise<void> => {
    setBusy(true)
    setError(undefined)
    try {
      if (view === undefined) {
        await onAdd(name.trim(), specOf())
      } else {
        await onSave(patchOf(draft(), transport))
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (): Promise<void> => {
    if (onDelete === undefined) return
    setBusy(true)
    setError(undefined)
    try {
      await onDelete()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
      setConfirming(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-label={view === undefined ? t('addTitle') : t('editTitle')}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.35)',
        display: 'grid',
        placeItems: 'center',
        zIndex: 40,
      }}
    >
      <div style={{ ...panelStyle, width: 'min(560px, 92vw)', maxHeight: '86vh', overflow: 'auto' }}>
        <strong style={{ color: palette.text }}>{view === undefined ? t('addTitle') : t('editTitle')}</strong>
        {view === undefined ? (
          <label style={fieldStyle}>
            <span style={labelStyle}>{t('name')}</span>
            <input style={inputStyle} value={name} onChange={(event) => setName(event.target.value)} />
          </label>
        ) : (
          <div style={{ color: palette.muted }}>{view.name}</div>
        )}
        <label style={fieldStyle}>
          <span style={labelStyle}>{t('transport')}</span>
          <select
            style={inputStyle}
            value={transport}
            onChange={(event) => setTransport(event.target.value === 'stdio' ? 'stdio' : 'streamable-http')}
          >
            <option value="stdio">stdio</option>
            <option value="streamable-http">streamable-http</option>
          </select>
        </label>
        {transport === 'stdio' ? (
          <>
            <label style={fieldStyle}>
              <span style={labelStyle}>{t('command')}</span>
              <input style={inputStyle} value={command} onChange={(event) => setCommand(event.target.value)} />
            </label>
            <label style={fieldStyle}>
              <span style={labelStyle}>{t('args')}</span>
              <input style={inputStyle} value={args} onChange={(event) => setArgs(event.target.value)} />
            </label>
            <label style={fieldStyle}>
              <span style={labelStyle}>{t('cwd')}</span>
              <input style={inputStyle} value={cwd} onChange={(event) => setCwd(event.target.value)} />
            </label>
            <div style={fieldStyle}>
              <span style={labelStyle}>{t('env')}</span>
              <RowEditor rows={env} t={t} onChange={setEnv} />
            </div>
          </>
        ) : (
          <>
            <label style={fieldStyle}>
              <span style={labelStyle}>{t('url')}</span>
              <input style={inputStyle} value={url} onChange={(event) => setUrl(event.target.value)} />
            </label>
            <div style={fieldStyle}>
              <span style={labelStyle}>{t('headers')}</span>
              <RowEditor rows={headers} t={t} onChange={setHeaders} />
            </div>
          </>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
          <label style={fieldStyle}>
            <span style={labelStyle}>{t('toolCallTimeout')}</span>
            <input style={inputStyle} value={toolCallTimeoutMs} onChange={(event) => setToolCall(event.target.value)} />
          </label>
          <label style={fieldStyle}>
            <span style={labelStyle}>{t('startupTimeout')}</span>
            <input style={inputStyle} value={startupTimeoutMs} onChange={(event) => setStartup(event.target.value)} />
          </label>
          <label style={fieldStyle}>
            <span style={labelStyle}>{t('closeTimeout')}</span>
            <input style={inputStyle} value={closeTimeoutMs} onChange={(event) => setClose(event.target.value)} />
          </label>
        </div>
        {error === undefined ? null : <div style={{ color: palette.danger }}>{error}</div>}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {onDelete === undefined ? null : confirming ? (
              <>
                <span style={{ ...labelStyle, color: palette.danger }}>{t('deleteConfirm')}</span>
                <button type="button" className="mcpw-primary" disabled={busy} onClick={() => void remove()}>
                  {t('delete')}
                </button>
                <button type="button" disabled={busy} onClick={() => setConfirming(false)}>
                  {t('keep')}
                </button>
              </>
            ) : (
              <button type="button" className="mcpw-link" disabled={busy} onClick={() => setConfirming(true)}>
                {t('deleteServer')}
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={onCancel} disabled={busy}>
              {t('cancel')}
            </button>
            <button type="button" className="mcpw-primary" onClick={() => void submit()} disabled={busy}>
              {view === undefined ? t('create') : t('save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
