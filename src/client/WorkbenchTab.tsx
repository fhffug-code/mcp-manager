/** The MCP Workbench page: list the fleet, inspect one server, probe it, and call a tool. */
import { useCallback, useEffect, useState } from 'react'
import type { CSSProperties, ReactElement, ReactNode } from 'react'
import type { CallResult, ProbeResult, ServerView } from '../types/index.js'
import { ApiError, createApi, type ServerDetail } from './api.js'
import type { Translate } from './context.js'
import {
  contentText,
  draftOf,
  durationText,
  parseArguments,
  patchOf,
  probeHeadline,
  type Draft,
  type Row,
} from './format.js'

const api = createApi()

export interface WorkbenchTabProps {
  t: Translate
}

type Status = 'loading' | 'ready' | 'failed'

const palette = {
  text: 'var(--dsw-alias-text-primary, #1f2328)',
  muted: 'var(--dsw-alias-text-secondary, #6b7280)',
  border: 'var(--dsw-alias-border-secondary, #e5e7eb)',
  surface: 'var(--dsw-alias-surface-secondary, #f9fafb)',
  accent: 'var(--dsw-alias-text-accent, #2563eb)',
  danger: 'var(--dsw-alias-text-danger, #b91c1c)',
  success: 'var(--dsw-alias-text-success, #15803d)',
} as const

const sourceLabel = (source: ServerView['source'], t: Translate): string =>
  source === 'profile' ? t('profileSource') : source === 'plugin' ? t('pluginSource') : t('managerSource')

const errorText = (error: unknown): string =>
  error instanceof ApiError ? `${error.code}: ${error.message}` : String(error)

function Panel(props: { children: ReactNode }): ReactElement {
  return (
    <section style={{ border: `1px solid ${palette.border}`, borderRadius: 8, padding: 12, marginBottom: 12 }}>
      {props.children}
    </section>
  )
}

function Field(props: { label: string; children: ReactNode }): ReactElement {
  return (
    <label style={{ display: 'block', marginBottom: 8 }}>
      <span style={{ display: 'block', fontSize: 12, color: palette.muted, marginBottom: 2 }}>{props.label}</span>
      {props.children}
    </label>
  )
}

const inputStyle: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '4px 6px',
  border: `1px solid ${palette.border}`,
  borderRadius: 6,
  background: 'transparent',
  color: palette.text,
  font: 'inherit',
}

function RowEditor(props: {
  rows: Row[]
  onChange(rows: Row[]): void
  t: Translate
  secretLabel: string
}): ReactElement {
  const update = (index: number, change: Partial<Row>): void => {
    props.onChange(props.rows.map((row, at) => (at === index ? { ...row, ...change } : row)))
  }
  const add = (): void => {
    props.onChange([
      ...props.rows,
      {
        key: `new-${props.rows.length}-${Date.now()}`,
        name: '',
        value: '',
        secret: false,
        original: false,
        remove: false,
      },
    ])
  }
  return (
    <div>
      {props.rows.map((row, index) => (
        <div key={row.key} style={{ display: 'flex', gap: 6, marginBottom: 4, alignItems: 'center' }}>
          <input
            aria-label={props.t('key')}
            style={{ ...inputStyle, flex: '0 0 34%' }}
            value={row.name}
            readOnly={row.original}
            onChange={(event) => update(index, { name: event.target.value })}
          />
          <input
            aria-label={props.t('value')}
            style={{ ...inputStyle, flex: 1, opacity: row.remove ? 0.4 : 1 }}
            value={row.value}
            placeholder={row.expression ?? (row.secret ? props.secretLabel : '')}
            onChange={(event) => update(index, { value: event.target.value })}
          />
          <button
            type="button"
            title={row.remove ? props.t('cancel') : props.t('remove')}
            onClick={() => update(index, { remove: !row.remove })}
            style={{
              background: 'transparent',
              border: 'none',
              color: row.remove ? palette.accent : palette.danger,
              cursor: 'pointer',
            }}
          >
            {row.remove ? '↺' : '×'}
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        style={{ background: 'transparent', border: 'none', color: palette.accent, cursor: 'pointer', padding: 0 }}
      >
        + {props.t('addKey')}
      </button>
    </div>
  )
}

export function WorkbenchTab({ t }: WorkbenchTabProps): ReactElement {
  const [status, setStatus] = useState<Status>('loading')
  const [servers, setServers] = useState<ServerView[]>([])
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()
  const [selected, setSelected] = useState<string>()
  const [detail, setDetail] = useState<ServerDetail>()
  const [draft, setDraft] = useState<Draft>()
  const [probe, setProbe] = useState<ProbeResult>()
  const [tool, setTool] = useState<string>('')
  const [argsText, setArgsText] = useState('{}')
  const [callResult, setCallResult] = useState<CallResult>()
  const [busy, setBusy] = useState<string>()
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({
    name: '',
    transport: 'stdio' as 'stdio' | 'streamable-http',
    command: '',
    args: '',
    url: '',
    env: '',
  })

  const fail = (cause: unknown): void => setError(errorText(cause))

  const reload = useCallback(async (): Promise<void> => {
    try {
      setServers(await api.list())
      setStatus('ready')
    } catch (cause) {
      setStatus('failed')
      fail(cause)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const openServer = async (name: string): Promise<void> => {
    setSelected(name)
    setError(undefined)
    setNotice(undefined)
    setProbe(undefined)
    setCallResult(undefined)
    setBusy('detail')
    try {
      const next = await api.detail(name)
      setDetail(next)
      setDraft(draftOf(next.server))
      setProbe(next.probe)
    } catch (cause) {
      fail(cause)
    } finally {
      setBusy(undefined)
    }
  }

  const runProbe = async (force: boolean): Promise<void> => {
    if (detail === undefined) return
    setBusy('probe')
    setError(undefined)
    try {
      setProbe(await api.probe(detail.server.name, force))
      await reload()
    } catch (cause) {
      fail(cause)
    } finally {
      setBusy(undefined)
    }
  }

  const save = async (): Promise<void> => {
    if (detail === undefined || draft === undefined) return
    setBusy('save')
    setError(undefined)
    try {
      const next = await api.save(detail.server.name, patchOf(detail.server, draft))
      setDetail(next)
      setDraft(draftOf(next.server))
      setNotice(t('saved'))
      await reload()
    } catch (cause) {
      fail(cause)
    } finally {
      setBusy(undefined)
    }
  }

  const toggleEnabled = async (): Promise<void> => {
    if (detail === undefined) return
    setBusy('toggle')
    setError(undefined)
    try {
      await api.setEnabled(detail.server.name, !detail.server.enabled)
      await reload()
      await openServer(detail.server.name)
    } catch (cause) {
      fail(cause)
    } finally {
      setBusy(undefined)
    }
  }

  const restart = async (): Promise<void> => {
    if (detail === undefined) return
    setBusy('restart')
    setError(undefined)
    try {
      await api.restart(detail.server.name)
      await reload()
      await openServer(detail.server.name)
    } catch (cause) {
      fail(cause)
    } finally {
      setBusy(undefined)
    }
  }

  const remove = async (): Promise<void> => {
    if (detail === undefined) return
    setBusy('remove')
    setError(undefined)
    try {
      await api.remove(detail.server.name)
      setDetail(undefined)
      setDraft(undefined)
      setSelected(undefined)
      setNotice(t('removed'))
      await reload()
    } catch (cause) {
      fail(cause)
    } finally {
      setBusy(undefined)
    }
  }

  const runCall = async (): Promise<void> => {
    if (detail === undefined) return
    const parsed = parseArguments(argsText)
    if (!parsed.ok) {
      setError(t('jsonInvalid'))
      return
    }
    const name = tool.trim()
    if (name === '') {
      setError(t('tools'))
      return
    }
    setBusy('call')
    setError(undefined)
    setCallResult(undefined)
    try {
      setCallResult(await api.call(detail.server.name, name, parsed.value))
    } catch (cause) {
      fail(cause)
    } finally {
      setBusy(undefined)
    }
  }

  const create = async (): Promise<void> => {
    setBusy('create')
    setError(undefined)
    try {
      const env: Record<string, string> = {}
      for (const line of form.env.split('\n')) {
        const at = line.indexOf('=')
        if (at > 0) env[line.slice(0, at).trim()] = line.slice(at + 1)
      }
      const spec =
        form.transport === 'stdio'
          ? {
              transport: 'stdio',
              command: form.command,
              ...(form.args.trim() === '' ? {} : { args: form.args.trim().split(/\s+/) }),
              ...(Object.keys(env).length === 0 ? {} : { env }),
            }
          : { transport: 'streamable-http', url: form.url, ...(Object.keys(env).length === 0 ? {} : { headers: env }) }
      await api.add(form.name, spec)
      setAdding(false)
      setForm({ name: '', transport: 'stdio', command: '', args: '', url: '', env: '' })
      await reload()
    } catch (cause) {
      fail(cause)
    } finally {
      setBusy(undefined)
    }
  }

  const banners = (
    <>
      {error === undefined ? null : (
        <div role="alert" style={{ color: palette.danger, marginBottom: 8 }}>
          {error}
        </div>
      )}
      {notice === undefined ? null : <div style={{ color: palette.success, marginBottom: 8 }}>{notice}</div>}
    </>
  )

  if (status === 'loading') return <div style={{ padding: 16, color: palette.muted }}>{t('loading')}</div>
  if (status === 'failed') {
    return (
      <div style={{ padding: 16 }}>
        <p style={{ color: palette.danger }}>{t('failed')}</p>
        <button type="button" onClick={() => void reload()}>
          {t('retry')}
        </button>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', color: palette.text }}>
      <aside style={{ flex: '0 0 300px' }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <button type="button" onClick={() => void reload()} disabled={busy !== undefined}>
            {t('refresh')}
          </button>
          <button type="button" onClick={() => setAdding((open) => !open)}>
            {t('add')}
          </button>
        </div>
        {adding ? (
          <Panel>
            <Field label={t('name')}>
              <input
                style={inputStyle}
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            </Field>
            <Field label={t('transport')}>
              <select
                style={inputStyle}
                value={form.transport}
                onChange={(event) =>
                  setForm({ ...form, transport: event.target.value === 'stdio' ? 'stdio' : 'streamable-http' })
                }
              >
                <option value="stdio">stdio</option>
                <option value="streamable-http">streamable-http</option>
              </select>
            </Field>
            {form.transport === 'stdio' ? (
              <>
                <Field label={t('command')}>
                  <input
                    style={inputStyle}
                    value={form.command}
                    onChange={(event) => setForm({ ...form, command: event.target.value })}
                  />
                </Field>
                <Field label={t('args')}>
                  <input
                    style={inputStyle}
                    value={form.args}
                    onChange={(event) => setForm({ ...form, args: event.target.value })}
                  />
                </Field>
                <Field label={t('env')}>
                  <textarea
                    style={{ ...inputStyle, minHeight: 56 }}
                    placeholder="TOKEN=..."
                    value={form.env}
                    onChange={(event) => setForm({ ...form, env: event.target.value })}
                  />
                </Field>
              </>
            ) : (
              <>
                <Field label={t('url')}>
                  <input
                    style={inputStyle}
                    value={form.url}
                    onChange={(event) => setForm({ ...form, url: event.target.value })}
                  />
                </Field>
                <Field label={t('headers')}>
                  <textarea
                    style={{ ...inputStyle, minHeight: 56 }}
                    placeholder="Authorization=..."
                    value={form.env}
                    onChange={(event) => setForm({ ...form, env: event.target.value })}
                  />
                </Field>
              </>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={() => void create()}
                disabled={busy !== undefined || form.name.trim() === ''}
              >
                {t('create')}
              </button>
              <button type="button" onClick={() => setAdding(false)}>
                {t('cancel')}
              </button>
            </div>
          </Panel>
        ) : null}
        {servers.length === 0 ? (
          <p style={{ color: palette.muted }}>{t('empty')}</p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {servers.map((server) => (
              <li key={`${server.source}:${server.name}`} style={{ marginBottom: 6 }}>
                <button
                  type="button"
                  onClick={() => void openServer(server.name)}
                  aria-current={selected === server.name ? 'true' : undefined}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: 8,
                    borderRadius: 8,
                    cursor: 'pointer',
                    color: palette.text,
                    border: `1px solid ${selected === server.name ? palette.accent : palette.border}`,
                    background: selected === server.name ? palette.surface : 'transparent',
                  }}
                >
                  <span style={{ display: 'block', fontWeight: 600 }}>{server.name}</span>
                  <span style={{ display: 'block', fontSize: 12, color: palette.muted }}>
                    {sourceLabel(server.source, t)} · {server.transport} ·{' '}
                    {server.enabled ? t('enabled') : t('disabled')}
                  </span>
                  <span style={{ display: 'block', fontSize: 12, color: palette.muted }}>
                    {probeHeadline(server.probe, t)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>
      <main style={{ flex: 1, minWidth: 0 }}>
        {banners}
        {detail === undefined || draft === undefined ? (
          <p style={{ color: palette.muted }}>{t('choose')}</p>
        ) : (
          <>
            <h3 style={{ margin: '0 0 4px' }}>{detail.server.name}</h3>
            <p style={{ margin: '0 0 12px', fontSize: 12, color: palette.muted }}>
              {sourceLabel(detail.server.source, t)} · {detail.server.transport}
              {detail.server.live === undefined ? null : ` · ${t('live')}: ${detail.server.live}`}
              {detail.server.editable ? '' : ` · ${t('readOnly')}`}
            </p>
            {detail.server.editable ? null : <p style={{ color: palette.muted }}>{t('notEditableHint')}</p>}
            <Panel>
              {detail.server.transport === 'stdio' ? (
                <>
                  <Field label={t('command')}>
                    <input
                      style={inputStyle}
                      value={draft.command}
                      onChange={(event) => setDraft({ ...draft, command: event.target.value })}
                    />
                  </Field>
                  <Field label={t('args')}>
                    <input
                      style={inputStyle}
                      value={draft.args}
                      onChange={(event) => setDraft({ ...draft, args: event.target.value })}
                    />
                  </Field>
                  <Field label={t('cwd')}>
                    <input
                      style={inputStyle}
                      value={draft.cwd}
                      onChange={(event) => setDraft({ ...draft, cwd: event.target.value })}
                    />
                  </Field>
                  <div style={{ marginBottom: 8 }}>
                    <span style={{ display: 'block', fontSize: 12, color: palette.muted, marginBottom: 2 }}>
                      {t('env')}
                    </span>
                    <RowEditor
                      rows={draft.env}
                      onChange={(env) => setDraft({ ...draft, env })}
                      t={t}
                      secretLabel={t('secretHint')}
                    />
                  </div>
                </>
              ) : (
                <>
                  <Field label={t('url')}>
                    <input
                      style={inputStyle}
                      value={draft.url}
                      onChange={(event) => setDraft({ ...draft, url: event.target.value })}
                    />
                  </Field>
                  <div style={{ marginBottom: 8 }}>
                    <span style={{ display: 'block', fontSize: 12, color: palette.muted, marginBottom: 2 }}>
                      {t('headers')}
                    </span>
                    <RowEditor
                      rows={draft.headers}
                      onChange={(headers) => setDraft({ ...draft, headers })}
                      t={t}
                      secretLabel={t('secretHint')}
                    />
                  </div>
                </>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <Field label={t('toolCallTimeoutMs')}>
                  <input
                    style={inputStyle}
                    value={draft.toolCallTimeoutMs}
                    onChange={(event) => setDraft({ ...draft, toolCallTimeoutMs: event.target.value })}
                  />
                </Field>
                <Field label={t('startupTimeoutMs')}>
                  <input
                    style={inputStyle}
                    value={draft.startupTimeoutMs}
                    onChange={(event) => setDraft({ ...draft, startupTimeoutMs: event.target.value })}
                  />
                </Field>
                <Field label={t('closeTimeoutMs')}>
                  <input
                    style={inputStyle}
                    value={draft.closeTimeoutMs}
                    onChange={(event) => setDraft({ ...draft, closeTimeoutMs: event.target.value })}
                  />
                </Field>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" onClick={() => void runProbe(probe !== undefined)} disabled={busy !== undefined}>
                  {probe === undefined ? t('probe') : t('probeAgain')}
                </button>
                {detail.server.editable ? (
                  <button type="button" onClick={() => void save()} disabled={busy !== undefined}>
                    {t('save')}
                  </button>
                ) : null}
                {detail.server.source === 'plugin' ? (
                  <>
                    <button type="button" onClick={() => void toggleEnabled()} disabled={busy !== undefined}>
                      {detail.server.enabled ? t('disable') : t('enable')}
                    </button>
                    <button type="button" onClick={() => void remove()} disabled={busy !== undefined}>
                      {t('remove')}
                    </button>
                  </>
                ) : null}
                {detail.server.source === 'profile' ? null : (
                  <button type="button" onClick={() => void restart()} disabled={busy !== undefined}>
                    {t('restart')}
                  </button>
                )}
              </div>
            </Panel>
            <Panel>
              <strong>{t('lastProbe')}</strong>
              <p style={{ margin: '4px 0', color: probe?.ok === true ? palette.text : palette.muted }}>
                {probeHeadline(probe, t)}
                {probe?.serverInfo === undefined
                  ? null
                  : ` · ${probe.serverInfo.name ?? ''} ${probe.serverInfo.version ?? ''}`}
                {probe === undefined ? null : ` · ${durationText(probe.durationMs)}`}
              </p>
              {probe?.error === undefined ? null : (
                <p style={{ color: palette.danger }}>
                  {probe.error.stage}: {probe.error.message}
                </p>
              )}
              {probe?.ok === true ? (
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {probe.tools.map((listed) => (
                    <li key={listed.name} style={{ marginBottom: 2 }}>
                      <button
                        type="button"
                        onClick={() => setTool(listed.name)}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          padding: 0,
                          cursor: 'pointer',
                          color: tool === listed.name ? palette.accent : palette.text,
                          font: 'inherit',
                        }}
                      >
                        {listed.name}
                      </button>
                      {listed.schemaOmitted === true ? (
                        <span style={{ fontSize: 12, color: palette.muted }}> ({t('truncated')})</span>
                      ) : null}
                      {listed.description === undefined ? null : (
                        <span style={{ fontSize: 12, color: palette.muted }}> — {listed.description}</span>
                      )}
                    </li>
                  ))}
                </ul>
              ) : null}
            </Panel>
            <Panel>
              <Field label={t('tools')}>
                <input style={inputStyle} value={tool} onChange={(event) => setTool(event.target.value)} />
              </Field>
              <Field label={t('arguments')}>
                <textarea
                  style={{ ...inputStyle, minHeight: 72, fontFamily: 'ui-monospace, SFMono-Regular, monospace' }}
                  value={argsText}
                  onChange={(event) => setArgsText(event.target.value)}
                />
              </Field>
              <button type="button" onClick={() => void runCall()} disabled={busy !== undefined || tool.trim() === ''}>
                {t('call')}
              </button>
              {callResult === undefined ? null : (
                <div style={{ marginTop: 10 }}>
                  <p style={{ margin: '0 0 4px', fontSize: 12, color: palette.muted }}>
                    {durationText(callResult.durationMs)}
                    {callResult.isError ? ` · ${t('isError')}` : ''}
                    {callResult.truncated ? ` · ${t('truncated')}` : ''}
                  </p>
                  {callResult.error === undefined ? null : (
                    <p style={{ color: palette.danger }}>
                      {callResult.error.stage}: {callResult.error.message}
                    </p>
                  )}
                  {callResult.content.map((block, index) => (
                    <pre
                      key={`${block.type}-${index}`}
                      style={{
                        margin: '0 0 6px',
                        padding: 8,
                        borderRadius: 6,
                        background: palette.surface,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        fontSize: 12,
                      }}
                    >
                      {contentText(block)}
                    </pre>
                  ))}
                </div>
              )}
            </Panel>
          </>
        )}
      </main>
    </div>
  )
}
