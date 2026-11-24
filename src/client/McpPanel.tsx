/** The MCP page: servers on the left, tools in the middle, one tool's detail and test call on the right. */
import { useEffect, useMemo, useState } from 'react'
import type { CallResult, ProbeResult, ProbeTool, ServerView } from '../types/index.js'
import { createApi } from './api.js'
import type { Translate } from './context.js'
import { contentText, durationText, parseArguments } from './format.js'
import { JsonText, JsonTree } from './JsonView.js'
import { prefillArguments } from './prefill.js'
import { ServerEditor } from './ServerEditor.js'
import { inputStyle, labelStyle, palette, panelStyle, STYLES } from './styles.js'

/** Which of the two result views the page shows. */
type ResultKind = 'json' | 'tree' | 'raw'

export interface PanelProps {
  t: Translate
}

const sourceLabel = (view: ServerView): string =>
  view.source === 'profile' ? 'profile' : view.source === 'plugin' ? 'plugin' : 'manager'

const matches = (text: string, query: string): boolean =>
  query.trim() === '' || text.toLowerCase().includes(query.trim().toLowerCase())

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
  const [editor, setEditor] = useState<{ mode: 'add' | 'edit'; view?: ServerView }>()

  const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

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

  const toggle = async (view: ServerView): Promise<void> => {
    try {
      await api.setEnabled(view.name, !view.enabled)
      await refresh()
      if (selected === view.name) await api.detail(view.name)
    } catch (error) {
      setFailure(message(error))
    }
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <strong style={{ fontSize: 16 }}>{t('title')}</strong>
        <button type="button" className="mcpw-primary" onClick={() => setEditor({ mode: 'add' })}>
          + {t('addServer')}
        </button>
      </div>

      {failure === undefined ? null : <div style={{ color: palette.danger }}>{failure}</div>}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(220px, 280px) minmax(240px, 340px) minmax(420px, 1fr)',
          gap: 10,
          flex: 1,
          minHeight: 0,
        }}
      >
        <section style={panelStyle} aria-label={t('servers')}>
          <input
            style={inputStyle}
            placeholder={t('searchServers')}
            value={serverQuery}
            onChange={(event) => setServerQuery(event.target.value)}
          />
          <div className="mcpw-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
            {visibleServers.length === 0 ? (
              <div style={labelStyle}>{t('noServers')}</div>
            ) : (
              visibleServers.map((view) => (
                <div key={view.name} style={{ display: 'flex', alignItems: 'flex-start', gap: 4 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <RowButton
                      active={view.name === selected}
                      onClick={() => void select(view.name)}
                      title={view.name}
                      second={`${sourceLabel(view)} · ${view.transport} · ${view.enabled ? t('enabled') : t('disabled')}`}
                      clamp={false}
                    />
                  </div>
                  <button
                    type="button"
                    className="mcpw-icon"
                    title={view.editable === false ? t('readOnly') : view.enabled ? t('disable') : t('enable')}
                    aria-label={view.enabled ? t('disable') : t('enable')}
                    disabled={view.editable === false}
                    onClick={() => void toggle(view)}
                  >
                    {view.enabled ? '◉' : '○'}
                  </button>
                  <button
                    type="button"
                    className="mcpw-icon"
                    title={t('editServer')}
                    aria-label={t('editServer')}
                    disabled={view.editable === false}
                    onClick={() => setEditor({ mode: 'edit', view })}
                  >
                    ⚙
                  </button>
                </div>
              ))
            )}
          </div>
        </section>

        <section style={panelStyle} aria-label={t('tools')}>
          {selected === undefined ? (
            <div style={labelStyle}>{t('pickServer')}</div>
          ) : probe === undefined ? (
            <button type="button" className="mcpw-primary" onClick={() => void runProbe()} disabled={probing}>
              {probing ? t('testing') : t('testConnection')}
            </button>
          ) : (
            <>
              <button type="button" className="mcpw-primary" onClick={() => void runProbe()} disabled={probing}>
                {probing ? t('testing') : t('testAgain')}
              </button>
              <div style={labelStyle}>
                {probe.ok
                  ? `${probe.toolCount} ${t('toolsCount')} · ${durationText(probe.durationMs)}`
                  : `${t('probeFailed')}: ${probe.error?.message ?? ''}`}
              </div>
              <input
                style={inputStyle}
                placeholder={t('searchTools')}
                value={toolQuery}
                onChange={(event) => setToolQuery(event.target.value)}
              />
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

        <section style={{ ...panelStyle, minWidth: 0 }} aria-label={t('toolDetail')}>
          {tool === undefined ? (
            <div style={labelStyle}>{t('pickTool')}</div>
          ) : (
            <>
              <div style={{ flexShrink: 0 }}>
                <div style={{ fontWeight: 600 }}>{tool.name}</div>
                <div style={{ ...labelStyle, marginTop: 4, maxHeight: '28vh', overflow: 'auto' }}>
                  {tool.description ?? t('noDescription')}
                </div>
              </div>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  flex: 1,
                  minHeight: 320,
                  borderTop: `1px solid ${palette.border}`,
                  paddingTop: 8,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
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
                  style={{ ...inputStyle, height: '22vh', minHeight: 120 }}
                />
                {callError === undefined ? null : <div style={{ color: palette.danger }}>{callError}</div>}
                {result === undefined ? (
                  <div style={labelStyle}>{t('noResult')}</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minHeight: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
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
              </div>
            </>
          )}
        </section>
      </div>

      {editor === undefined ? null : (
        <ServerEditor
          t={t}
          {...(editor.view === undefined ? {} : { view: editor.view })}
          onCancel={() => setEditor(undefined)}
          onAdd={async (name, spec) => {
            await api.add(name, spec)
            setEditor(undefined)
            await refresh()
          }}
          onSave={async (patch) => {
            if (editor.view === undefined) return
            await api.save(editor.view.name, patch)
            setEditor(undefined)
            await refresh()
            if (selected === editor.view.name) await api.detail(editor.view.name)
          }}
        />
      )}
    </div>
  )
}
