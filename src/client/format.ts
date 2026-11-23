/** Small pure helpers the page uses; kept apart so they can be tested without a DOM. */
import type { CallContent, ProbeResult, ProbeSummary, ServerField, ServerPatch, ServerView } from '../types/index.js'

export interface Row {
  key: string
  name: string
  value: string
  secret: boolean
  expression?: string
  original: boolean
  remove: boolean
}

export interface Draft {
  command: string
  args: string
  cwd: string
  url: string
  toolCallTimeoutMs: string
  startupTimeoutMs: string
  closeTimeoutMs: string
  env: Row[]
  headers: Row[]
}

/** The editable form of one env or header map. */
export function rowsOf(fields: Record<string, ServerField>): Row[] {
  return Object.entries(fields).map(([name, field]) => ({
    key: name,
    name,
    value: field.value ?? '',
    secret: field.secret,
    ...(field.expression === undefined ? {} : { expression: field.expression }),
    original: true,
    remove: false,
  }))
}

/** The editable form of one server. */
export function draftOf(view: ServerView): Draft {
  return {
    command: view.command ?? '',
    args: (view.args ?? []).join(' '),
    cwd: view.cwd ?? '',
    url: view.url ?? '',
    toolCallTimeoutMs: view.timeouts.toolCallTimeoutMs?.toString() ?? '',
    startupTimeoutMs: view.timeouts.startupTimeoutMs?.toString() ?? '',
    closeTimeoutMs: view.timeouts.closeTimeoutMs?.toString() ?? '',
    env: rowsOf(view.env),
    headers: rowsOf(view.headers),
  }
}

const blankToNull = (text: string): string | null => (text.trim() === '' ? null : text.trim())

const milliseconds = (text: string): number | null | undefined => {
  if (text.trim() === '') return null
  const value = Number.parseInt(text.trim(), 10)
  return Number.isInteger(value) && value > 0 ? value : undefined
}

/** Only the entries the user touched, so untouched secrets keep their stored value. */
function changedFields(rows: readonly Row[]): Record<string, string | null> | undefined {
  const change: Record<string, string | null> = {}
  for (const row of rows) {
    if (row.name.trim() === '') continue
    if (row.remove) change[row.name] = null
    else if (row.value !== '') change[row.name] = row.value
  }
  return Object.keys(change).length === 0 ? undefined : change
}

/** Turn the form into the patch the Host applies. */
export function patchOf(view: ServerView, draft: Draft): ServerPatch {
  const patch: ServerPatch = { transport: view.transport }
  if (view.transport === 'stdio') {
    patch.command = blankToNull(draft.command)
    patch.args = draft.args.trim() === '' ? null : draft.args.trim().split(/\s+/)
    patch.cwd = blankToNull(draft.cwd)
  } else {
    patch.url = blankToNull(draft.url)
  }
  const toolCallTimeoutMs = milliseconds(draft.toolCallTimeoutMs)
  if (toolCallTimeoutMs !== undefined) patch.toolCallTimeoutMs = toolCallTimeoutMs
  const startupTimeoutMs = milliseconds(draft.startupTimeoutMs)
  if (startupTimeoutMs !== undefined) patch.startupTimeoutMs = startupTimeoutMs
  const closeTimeoutMs = milliseconds(draft.closeTimeoutMs)
  if (closeTimeoutMs !== undefined) patch.closeTimeoutMs = closeTimeoutMs
  const env = changedFields(draft.env)
  if (env !== undefined) patch.env = env
  const headers = changedFields(draft.headers)
  if (headers !== undefined) patch.headers = headers
  return patch
}

export type ParsedArguments = { ok: true; value: Record<string, unknown> } | { ok: false; message: string }

/** Read the arguments textarea; an empty box means no arguments. */
export function parseArguments(text: string): ParsedArguments {
  const trimmed = text.trim()
  if (trimmed === '') return { ok: true, value: {} }
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, message: 'arguments must be a JSON object' }
  }
  return { ok: true, value: parsed as Record<string, unknown> }
}

export const durationText = (ms: number): string => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`)

/** One readable line for a tool result block. */
export function contentText(content: CallContent): string {
  switch (content.type) {
    case 'text':
      return content.text
    case 'image':
      return `[image ${content.mimeType}, ${content.bytes} bytes]`
    case 'audio':
      return `[audio ${content.mimeType}, ${content.bytes} bytes]`
    case 'resource':
      return content.text === undefined ? `[resource ${content.uri}]` : content.text
    case 'resource-link':
      return `[link ${content.name ?? content.uri}]`
    default:
      return `[${content.kind}]`
  }
}

/** The probe headline for one server, when a probe ran. */
export function probeHeadline(probe: ProbeResult | ProbeSummary | undefined, t: (key: string) => string): string {
  if (probe === undefined) return t('neverProbed')
  if (!probe.ok) return `${t('probeFailed')}: ${probe.error?.message ?? ''}`
  const count = `${probe.toolCount} ${t('toolsCount')}`
  return 'truncated' in probe && probe.truncated ? `${count} (${t('truncated')})` : count
}
