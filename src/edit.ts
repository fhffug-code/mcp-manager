/** Masking and field-wise patching of a raw server config, as the profile stores it. */
import { validateServerSpec } from './config.js'
import type { ServerField, ServerPatch, TransportKind } from './types/index.js'

/** Names whose values never leave the Host, whatever the stored value is. */
export const SECRET_KEY_PATTERN = /(TOKEN|KEY|SECRET|PASSWORD|PASSWD|AUTH|CREDENTIAL)/i

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** The expression behind a value the config editor handed back for a `!!js` scalar. */
function expressionOf(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined
  const keys = Object.keys(value)
  if (keys.length !== 1 || keys[0] !== '__jsExpr') return undefined
  const expression = value['__jsExpr']
  return typeof expression === 'string' ? expression : undefined
}

/**
 * Where the first `!!js` expression sits inside a config value, as a dotted path.
 * A row that keeps one anywhere cannot be rewritten: its schema validates the marker as data, not as an expression.
 */
export function expressionPath(value: unknown, prefix = ''): string | undefined {
  if (expressionOf(value) !== undefined) return prefix === '' ? 'the value' : prefix
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const found = expressionPath(item, `${prefix}[${index}]`)
      if (found !== undefined) return found
    }
    return undefined
  }
  if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      const found = expressionPath(item, prefix === '' ? key : `${prefix}.${key}`)
      if (found !== undefined) return found
    }
  }
  return undefined
}

/** Mask one env or header map for the page: literals where safe, markers where not. */
export function fieldsOf(raw: unknown): Record<string, ServerField> {
  const fields: Record<string, ServerField> = {}
  if (!isRecord(raw)) return fields
  for (const [name, value] of Object.entries(raw)) {
    const expression = expressionOf(value)
    if (expression !== undefined) {
      fields[name] = { value: null, secret: true, expression }
      continue
    }
    if (typeof value !== 'string') continue
    fields[name] = SECRET_KEY_PATTERN.test(name) ? { value: null, secret: true } : { value, secret: false }
  }
  return fields
}

const setOrDelete = (target: Record<string, unknown>, key: string, value: unknown): void => {
  if (value === null) delete target[key]
  else if (value !== undefined) target[key] = value
}

/** A value the page typed: `!!js <expression>` becomes the form the profile stores. */
export function encodeFieldValue(value: string): string | { __jsExpr: string } {
  const match = /^!!js\s+(.+)$/s.exec(value)
  if (match === null) return value
  return { __jsExpr: match[1] ?? '' }
}

const isTransport = (value: unknown): value is TransportKind => value === 'stdio' || value === 'streamable-http'

/**
 * Apply a patch to a raw server config and return the replacement.
 * An omitted field keeps its value, null removes it, and a transport switch drops the fields the new transport ignores.
 */
export function applyPatch(raw: Record<string, unknown>, patch: ServerPatch): Record<string, unknown> {
  const next: Record<string, unknown> = { ...raw }
  const transport = isTransport(patch.transport)
    ? patch.transport
    : isTransport(next['transport'])
      ? next['transport']
      : undefined
  setOrDelete(next, 'transport', transport)
  if (transport === 'stdio') {
    delete next['url']
    // A stdio server never sends headers, so the other transport's map would be dead weight.
    delete next['headers']
    setOrDelete(next, 'command', patch.command)
    setOrDelete(next, 'args', patch.args)
    setOrDelete(next, 'cwd', patch.cwd)
  } else if (transport === 'streamable-http') {
    delete next['command']
    delete next['args']
    delete next['cwd']
    delete next['env']
    setOrDelete(next, 'url', patch.url)
  }
  if (patch.headers !== undefined && transport !== 'stdio') {
    const merged = mergeFields(next['headers'], patch.headers)
    if (merged === undefined) delete next['headers']
    else next['headers'] = merged
  }
  if (patch.env !== undefined && transport !== 'streamable-http') {
    const merged = mergeFields(next['env'], patch.env)
    if (merged === undefined) delete next['env']
    else next['env'] = merged
  }
  for (const key of ['toolCallTimeoutMs', 'startupTimeoutMs', 'closeTimeoutMs'] as const) {
    setOrDelete(next, key, patch[key])
  }
  return next
}

/** Merge a field-wise change into one env or header map, keeping untouched entries and expressions. */
function mergeFields(current: unknown, change: Record<string, string | null>): Record<string, unknown> | undefined {
  const merged: Record<string, unknown> = isRecord(current) ? { ...current } : {}
  for (const [name, value] of Object.entries(change)) {
    if (value === null) delete merged[name]
    else merged[name] = encodeFieldValue(value)
  }
  return Object.keys(merged).length === 0 ? undefined : merged
}

/** A copy of the maps with each `!!js` expression replaced by a string, so the spec validator accepts it. */
function resolvable(next: Record<string, unknown>): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...next }
  for (const key of ['env', 'headers'] as const) {
    const value = copy[key]
    if (!isRecord(value)) continue
    const resolved: Record<string, string> = {}
    for (const [name, item] of Object.entries(value)) {
      resolved[name] = typeof item === 'string' ? item : 'expression'
    }
    copy[key] = resolved
  }
  return copy
}

/** Problems with a patched config, in the words the caller shows; empty means valid. */
export function validatePatched(next: Record<string, unknown>): string[] {
  return validateServerSpec(resolvable(next))
}
