/** Small pure helpers the page uses; kept apart so they can be tested without a DOM. */
import type {
  CallContent,
  ProbeResult,
  ProbeSummary,
  ServerField,
  ServerPatch,
  ServerView,
  TransportKind,
} from '../types/index.js'

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

/** An argument list the way the one-line form holds it: an argument with a space is quoted. */
export function joinArgs(args: readonly string[]): string {
  return args.map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg)).join(' ')
}

/** Split the one-line form back into arguments, keeping a quoted run together. */
export function splitArgs(text: string): string[] {
  const args: string[] = []
  let current = ''
  let quoted = false
  let started = false
  for (const char of text) {
    if (char === '"') {
      quoted = !quoted
      started = true
      continue
    }
    if (!quoted && /\s/.test(char)) {
      if (started) {
        args.push(current)
        current = ''
        started = false
      }
      continue
    }
    current += char
    started = true
  }
  if (started) args.push(current)
  return args
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
    args: joinArgs(view.args ?? []),
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

/** Every entry that still has a value; a masked secret is left alone, so it keeps its stored value. */
function changedFields(rows: readonly Row[]): Record<string, string | null> | undefined {
  const change: Record<string, string | null> = {}
  for (const row of rows) {
    if (row.name.trim() === '') continue
    if (row.remove) change[row.name] = null
    else if (row.value !== '') change[row.name] = row.value
  }
  return Object.keys(change).length === 0 ? undefined : change
}

/**
 * Turn the form into the patch the Host applies, for the transport the form shows now.
 *
 * Only the shown transport's fields are sent; the Host drops the other side's fields when it applies
 * the switch, so a record can never carry a mix of the two.
 */
export function patchOf(draft: Draft, transport: TransportKind): ServerPatch {
  const patch: ServerPatch = { transport }
  if (transport === 'stdio') {
    patch.command = blankToNull(draft.command)
    patch.args = draft.args.trim() === '' ? null : splitArgs(draft.args)
    patch.cwd = blankToNull(draft.cwd)
    const env = changedFields(draft.env)
    if (env !== undefined) patch.env = env
  } else {
    patch.url = blankToNull(draft.url)
    const headers = changedFields(draft.headers)
    if (headers !== undefined) patch.headers = headers
  }
  const toolCallTimeoutMs = milliseconds(draft.toolCallTimeoutMs)
  if (toolCallTimeoutMs !== undefined) patch.toolCallTimeoutMs = toolCallTimeoutMs
  const startupTimeoutMs = milliseconds(draft.startupTimeoutMs)
  if (startupTimeoutMs !== undefined) patch.startupTimeoutMs = startupTimeoutMs
  const closeTimeoutMs = milliseconds(draft.closeTimeoutMs)
  if (closeTimeoutMs !== undefined) patch.closeTimeoutMs = closeTimeoutMs
  return patch
}

export type ParsedArguments =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; reason: 'invalid-json'; detail: string }
  | { ok: false; reason: 'not-object' }

/** Read the arguments textarea; an empty box means no arguments. */
export function parseArguments(text: string): ParsedArguments {
  const trimmed = text.trim()
  if (trimmed === '') return { ok: true, value: {} }
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch (error) {
    return { ok: false, reason: 'invalid-json', detail: error instanceof Error ? error.message : String(error) }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { ok: false, reason: 'not-object' }
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
