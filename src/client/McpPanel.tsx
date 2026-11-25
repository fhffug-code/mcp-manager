/** The MCP page: servers on the left, tools beside them, one tool's detail above its test call. */
import { useEffect, useMemo, useState } from 'react'
import type { CallResult, ProbeResult, ProbeTool, ServerView } from '../types/index.js'
import { createApi } from './api.js'
import type { Translate } from './context.js'
import { contentText, durationText, parseArguments } from './format.js'
import { JsonText, JsonTree } from './JsonView.js'
import { prefillArguments } from './prefill.js'
import { ServerEditor } from './ServerEditor.js'
import { barStyle, columnStyle, headerStyle, inputStyle, labelStyle, palette, STYLES } from './styles.js'

/** Which result view the page shows: the payload as JSON, as a tree, or the whole exchange. */
type ResultKind = 'json' | 'tree' | 'raw'

export interface PanelProps {
  t: Translate
}

/** Where a row comes from, in the one word the row shows. */
const sourceLabel = (view: ServerView): string => view.source

const matches = (text: string, query: string): boolean =>
  query.trim() === '' || text.toLowerCase().includes(query.trim().toLowerCase())

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** One clickable row: a muted second line that may be clamped to two lines. */
function RowButton({
  active,
  onClick,
  title,
  second,
  clamp,
}: {
  active: boolean
  onClick(): void
  title: string
  second: string
  clamp: boolean
}) {
  return (
    <button type="button" className="mcpw-list" aria-current={active} onClick={onClick} style={{ padding: '6px 8px' }}>
      <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
      <div
        className={clamp ? 'mcpw-clamp2' : undefined}
        style={{ ...labelStyle, marginTop: 2, wordBreak: 'break-word' }}
      >
        {second}
      </div>
    </button>
  )
}

/** The page. Everything it shows comes from the one route the Host registers. */
export function McpPanel({ t }: PanelProps) {
  const api = useMemo(() => createApi(), [])
  const [servers, setServers] = useState<ServerView[]>([])
  const [serverQuery, setServerQuery] = useState('')
  const [selected, setSelected] = useState<string>()
  const [probe, setProbe] = useState<ProbeResult>()
  const [probing, setProbing] = useState(false)
  const [toolQuery, setToolQuery] = useState('')
  const [tool, setTool] = useState<ProbeTool>()
  const [argsText, setArgsText] = useState('')
  const [result, setResult] = useState<CallResult>()
  const [request, setRequest] = useState<{ tool: string; arguments: Record<string, unknown> }>()
  const [resultKind, setResultKind] = useState<ResultKind>('json')
  const [callError, setCallError] = useState<string>()
  const [sending, setSending] = useState(false)
  const [failure, setFailure] = useState<string>()
  const [pending, setPending] = useState<Record<string, boolean>>({})
  const [rowError, setRowError] = useState<Record<string, string>>({})
  const [editor, setEditor] = useState<{ mode: 'add' | 'edit'; view?: ServerView }>()

  const refresh = async (): Promise<void> => {
    try {
      setServers(await api.list())
      setFailure(undefined)
    } catch (error) {
      setFailure(message(error))
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  const clearPending = (name: string): void => {
    setPending((current) => {
      const next = { ...current }
      delete next[name]
      return next
    })
  }

  const select = async (name: string): Promise<void> => {
    setSelected(name)
    setProbe(undefined)
    setTool(undefined)
    setResult(undefined)
    setRequest(undefined)
    setCallError(undefined)
    setToolQuery('')
    try {
      const next = await api.detail(name)
      setProbe(next.probe)
    } catch (error) {
      setFailure(message(error))
    }
  }

  const runProbe = async (): Promise<void> => {
    if (selected === undefined) return
    setProbing(true)
    setFailure(undefined)
    try {
      const next = await api.probe(selected, true)
      setProbe(next)
      await refresh()
    } catch (error) {
      setFailure(message(error))
    } finally {
      setProbing(false)
    }
  }

  /**
   * Switch a server and show the new state at once: the write reaches the profile, but a re-read
   * taken before that lands still reports the old value, so the list is reconciled afterwards.
   */
  const toggle = async (view: ServerView): Promise<void> => {
    const wanted = !(pending[view.name] ?? view.enabled)
    setPending((current) => ({ ...current, [view.name]: wanted }))
    setRowError((current) => {
      const next = { ...current }
      delete next[view.name]
      return next
    })
    setProbe(undefined)
    try {
      const updated = await api.setEnabled(view.name, wanted)
      setServers((current) => current.map((item) => (item.name === updated.name ? updated : item)))
      await settle(view.name, wanted)
    } catch (error) {
      clearPending(view.name)
      setRowError((current) => ({ ...current, [view.name]: message(error) }))
    }
  }

  /** Wait for the profile write to land, then let the list be the truth again. */
  const settle = async (name: string, wanted: boolean): Promise<void> => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await delay(500 * (attempt + 1))
      let list: ServerView[]
      try {
        list = await api.list()
      } catch (error) {
        setFailure(message(error))
        break
      }
      setServers(list)
      const row = list.find((item) => item.name === name)
      if (row !== undefined && row.enabled !== wanted) continue
      clearPending(name)
      if (selected === name) {
        try {
          const next = await api.detail(name)
          setProbe(next.probe)
        } catch (error) {
          setFailure(message(error))
        }
      }
      return
    }
    clearPending(name)
  }

  const pickTool = (next: ProbeTool): void => {
    setTool(next)
    setResult(undefined)
    setRequest(undefined)
    setCallError(undefined)
    setResultKind('json')
    setArgsText(JSON.stringify(prefillArguments(next.inputSchema), null, 2))
  }

  const send = async (): Promise<void> => {
    if (selected === undefined || tool === undefined) return
    const parsed = parseArguments(argsText)
    if (!parsed.ok) {
      setCallError(parsed.message)
      return
    }
    setCallError(undefined)
    setSending(true)
    try {
      const next = await api.call(selected, tool.name, parsed.value)
      setResult(next)
      setRequest({ tool: tool.name, arguments: parsed.value })
      setResultKind(next.ok ? 'json' : 'raw')
    } catch (error) {
      setCallError(message(error))
    } finally {
      setSending(false)
    }
  }

  const visibleServers = servers.filter((view) => matches(`${view.name} ${view.source} ${view.endpoint}`, serverQuery))
  const tools = probe?.tools ?? []
  const visibleTools = tools.filter((item) => matches(`${item.name} ${item.description ?? ''}`, toolQuery))
  // The dialog keeps its own draft, so it is remounted per target: a draft never leaks between servers.
  const editorTarget = editor?.view

  return (
    <div
      className="mcp-workbench"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        height: '100%',
        minHeight: 0,
        boxSizing: 'border-box',
        padding: '12px 16px',
        paddingTop: 'calc(var(--dsh-frame-top-clearance, 0px) + 12px)',
      }}
    >
      <style>{STYLES}</style>
      <div style={headerStyle}>
        <strong style={{ fontSize: 16 }}>{t('title')}</strong>
        <button type="button" className="mcpw-primary" onClick={() => setEditor({ mode: 'add' })}>
          + {t('addServer')}
        </button>
      </div>

      {failure === undefined ? null : <div style={{ color: palette.danger }}>{failure}</div>}

      <div className="mcpw-split">
        <section
          data-testid="split-servers"
          className="mcpw-divide-right"
          style={columnStyle}
          aria-label={t('servers')}
        >
          <input
            style={inputStyle}
            placeholder={t('searchServers')}
            aria-label={t('searchServers')}
            value={serverQuery}
            onChange={(event) => setServerQuery(event.target.value)}
          />
          <div className="mcpw-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
            {visibleServers.length === 0 ? (
              <div style={labelStyle}>{t('noServers')}</div>
            ) : (
              visibleServers.map((view) => {
                const enabled = pending[view.name] ?? view.enabled
                const busy = pending[view.name] !== undefined
                return (
                  <div key={view.name} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <RowButton
                          active={view.name === selected}
                          onClick={() => void select(view.name)}
                          title={view.name}
                          second={`${sourceLabel(view)} · ${view.transport} · ${enabled ? t('enabled') : t('disabled')}`}
                          clamp={false}
                        />
                      </div>
                      <button
                        type="button"
                        className="mcpw-switch"
                        role="switch"
                        aria-checked={enabled}
                        aria-busy={busy}
                        title={!view.editable ? t('readOnly') : enabled ? t('disable') : t('enable')}
                        aria-label={enabled ? t('disable') : t('enable')}
                        disabled={!view.editable}
                        onClick={() => void toggle(view)}
                      >
                        <span />
                      </button>
                      <button
                        type="button"
                        className="mcpw-icon"
                        title={t('editServer')}
                        aria-label={t('editServer')}
                        disabled={!view.editable}
                        onClick={() => setEditor({ mode: 'edit', view })}
                      >
                        ⚙
                      </button>
                    </div>
                    {rowError[view.name] === undefined ? null : (
                      <div style={{ color: palette.danger, fontSize: 12, paddingInlineStart: 8 }}>
                        {rowError[view.name]}
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </section>

        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
          <div data-testid="bar-tools" className="mcpw-divide-bottom" style={barStyle}>
            <button
              type="button"
              className="mcpw-primary"
              disabled={selected === undefined || probing}
              onClick={() => void runProbe()}
            >
              {probing ? t('testing') : probe === undefined ? t('testConnection') : t('testAgain')}
            </button>
            <input
              style={{ ...inputStyle, width: 220, flex: 'none' }}
              placeholder={t('searchTools')}
              aria-label={t('searchTools')}
              disabled={tools.length === 0}
              value={toolQuery}
              onChange={(event) => setToolQuery(event.target.value)}
            />
          </div>

          <div className="mcpw-split">
            <section
              data-testid="split-tools"
              className="mcpw-divide-right"
              style={columnStyle}
              aria-label={t('tools')}
            >
              {selected === undefined ? (
                <div style={labelStyle}>{t('pickServer')}</div>
              ) : probe === undefined ? (
                <div style={labelStyle}>{t('notProbed')}</div>
              ) : (
                <>
                  <div style={labelStyle}>
                    {probe.ok
                      ? `${probe.toolCount} ${t('toolsCount')} · ${durationText(probe.durationMs)}`
                      : `${t('probeFailed')}: ${probe.error?.message ?? ''}`}
                  </div>
                  <div className="mcpw-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
                    {visibleTools.length === 0 ? (
                      <div style={labelStyle}>{t('noTools')}</div>
                    ) : (
                      visibleTools.map((item) => (
                        <RowButton
                          key={item.name}
                          active={item.name === tool?.name}
                          onClick={() => pickTool(item)}
                          title={item.name}
                          second={item.description ?? t('noDescription')}
                          clamp
                        />
                      ))
                    )}
                  </div>
                </>
              )}
            </section>

            <div className="mcpw-rows">
              <section
                data-testid="cell-description"
                className="mcpw-divide-bottom"
                style={{ ...columnStyle, overflow: 'hidden' }}
                aria-label={t('toolDetail')}
              >
                {tool === undefined ? (
                  <div style={labelStyle}>{t('pickTool')}</div>
                ) : (
                  <>
                    <div style={{ fontWeight: 600, flexShrink: 0 }}>{tool.name}</div>
                    <div
                      className="mcpw-scroll"
                      style={{ ...labelStyle, flex: 1, minHeight: 0, whiteSpace: 'pre-wrap' }}
                    >
                      {tool.description ?? t('noDescription')}
                    </div>
                  </>
                )}
              </section>

              <section data-testid="cell-call" style={columnStyle} aria-label={t('tryCall')}>
                {tool === undefined ? (
                  <div style={labelStyle}>{t('pickTool')}</div>
                ) : (
                  <>
                    <div
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}
                    >
                      <span style={labelStyle}>{t('tryCall')}</span>
                      <button type="button" className="mcpw-primary" onClick={() => void send()} disabled={sending}>
                        {sending ? t('sending') : t('send')}
                      </button>
                    </div>
                    <textarea
                      aria-label={t('arguments')}
                      spellCheck={false}
                      value={argsText}
                      onChange={(event) => setArgsText(event.target.value)}
                      style={{ ...inputStyle, height: '18vh', minHeight: 96, flexShrink: 0 }}
                    />
                    {callError === undefined ? null : <div style={{ color: palette.danger }}>{callError}</div>}
                    {result === undefined ? (
                      <div style={labelStyle}>{t('noResult')}</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minHeight: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                          {(['json', 'tree', 'raw'] as const).map((kind) => (
                            <button
                              key={kind}
                              type="button"
                              className={resultKind === kind ? 'mcpw-primary' : undefined}
                              onClick={() => setResultKind(kind)}
                            >
                              {t(`view_${kind}`)}
                            </button>
                          ))}
                          <span style={{ ...labelStyle, marginLeft: 'auto' }}>
                            {result.ok ? t('succeeded') : t('failed')} · {durationText(result.durationMs)}
                            {result.isError ? ` · ${t('toolError')}` : ''}
                          </span>
                        </div>
                        {resultKind === 'raw' ? (
                          <JsonText
                            value={{
                              request: { server: selected, ...(request ?? {}) },
                              response: result.raw ?? { content: result.content, isError: result.isError },
                            }}
                          />
                        ) : resultKind === 'tree' ? (
                          <JsonTree
                            value={result.raw ?? { content: result.content.map((block) => ({ ...block })) }}
                            t={t}
                          />
                        ) : (
                          <div
                            className="mcpw-scroll"
                            style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minHeight: 0 }}
                          >
                            {result.content.length === 0 ? (
                              <div style={labelStyle}>{t('emptyResult')}</div>
                            ) : (
                              result.content.map((block, index) => (
                                <pre
                                  key={index}
                                  className="mcpw-code"
                                  style={{ background: palette.input, padding: 6, borderRadius: 8 }}
                                >
                                  {contentText(block)}
                                </pre>
                              ))
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </section>
            </div>
          </div>
        </div>
      </div>

      {editor === undefined ? null : (
        <ServerEditor
          key={editorTarget === undefined ? 'new' : editorTarget.name}
          t={t}
          {...(editorTarget === undefined ? {} : { view: editorTarget })}
          onCancel={() => setEditor(undefined)}
          onAdd={async (name, spec) => {
            await api.add(name, spec)
            setEditor(undefined)
            await refresh()
          }}
          onSave={async (patch) => {
            if (editorTarget === undefined) return
            await api.save(editorTarget.name, patch)
            setEditor(undefined)
            await refresh()
            if (selected === editorTarget.name) {
              const next = await api.detail(editorTarget.name)
              setProbe(next.probe)
            }
          }}
          {...(editorTarget !== undefined && editorTarget.editable
            ? {
                onDelete: async () => {
                  await api.remove(editorTarget.name)
                  setEditor(undefined)
                  setSelected(undefined)
                  setProbe(undefined)
                  setTool(undefined)
                  setResult(undefined)
                  await refresh()
                },
              }
            : {})}
        />
      )}
    </div>
  )
}
