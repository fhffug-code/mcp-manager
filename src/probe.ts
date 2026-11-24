/** Temporary MCP connections: probe a server and call one of its tools. */
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import type { McpServerSpec } from './config.js'
import { PLUGIN_VERSION } from './version.js'
import type { CallContent, CallResult, ProbeError, ProbeResult, ProbeStage, ProbeTool } from './types/index.js'

/** Budgets shared by every connection this plugin opens. */
export interface ProbeOptions {
  probeTimeoutMs: number
  toolCallTimeoutMs: number
  maxToolSchemas: number
  resultMaxBytes: number
  /** Resolves a `${credential:NAME}` reference; without it every reference counts as unresolved. */
  credentials?: (name: string) => Promise<string | undefined>
}

/** A reference the manager would resolve before it connects. */
const CREDENTIAL_PATTERN = /\$\{credential:([^}]+)\}/g

/** Names whose values must never reach a spawned server through the inherited environment. */
const SECRET_ENV_PATTERN = /(TOKEN|KEY|SECRET|PASSWORD|PASSWD|AUTH|CREDENTIAL)/i

/** The tool list page budget; a server that keeps paging is reported as truncated. */
const MAX_PAGES = 16

/** The tool name budget for one probe. */
const MAX_TOOL_NAMES = 512

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** The parent environment without credential-shaped or DSH-owned names, plus the spec's own values. */
function childEnvironment(explicit: Record<string, string> = {}): Record<string, string> {
  const environment: Record<string, string> = {}
  for (const [name, value] of Object.entries(process.env)) {
    if (value === undefined) continue
    if (name.startsWith('DSH_')) continue
    if (SECRET_ENV_PATTERN.test(name)) continue
    environment[name] = value
  }
  return { ...environment, ...explicit }
}

/** Build the transport a spec describes. */
function createTransport(spec: McpServerSpec): StdioClientTransport | StreamableHTTPClientTransport {
  if (spec.transport === 'stdio') {
    return new StdioClientTransport({
      command: spec.command ?? '',
      ...(spec.args === undefined ? {} : { args: spec.args }),
      env: childEnvironment(spec.env),
      ...(spec.cwd === undefined ? {} : { cwd: spec.cwd }),
    })
  }
  if (spec.url === undefined) throw new Error('streamable-http server declares no url')
  return new StreamableHTTPClientTransport(new URL(spec.url), {
    requestInit: { headers: spec.headers ?? {} },
  })
}

/** Credential references this server's configuration carries, in the order they appear. */
export function credentialNames(spec: McpServerSpec): string[] {
  const found: string[] = []
  const scan = (value: string): void => {
    for (const match of value.matchAll(CREDENTIAL_PATTERN)) {
      const name = match[1] ?? ''
      if (name !== '' && !found.includes(name)) found.push(name)
    }
  }
  const walk = (record: Record<string, string> | undefined): void => {
    for (const value of Object.values(record ?? {})) scan(value)
  }
  if (spec.command !== undefined) scan(spec.command)
  if (spec.url !== undefined) scan(spec.url)
  if (spec.cwd !== undefined) scan(spec.cwd)
  for (const arg of spec.args ?? []) scan(arg)
  walk(spec.env)
  walk(spec.headers)
  return found
}

/**
 * Replace every `${credential:NAME}` with the value the store holds for it.
 *
 * Returns the names that hold no value: the caller reports those as a credential failure instead of
 * sending the template to the server.
 */
async function expandCredentials(
  spec: McpServerSpec,
  resolve: ((name: string) => Promise<string | undefined>) | undefined,
): Promise<{ spec: McpServerSpec; missing: string[] }> {
  const names = credentialNames(spec)
  if (names.length === 0) return { spec, missing: [] }
  if (resolve === undefined) return { spec, missing: names }
  const values = new Map<string, string>()
  const missing: string[] = []
  for (const name of names) {
    const value = await resolve(name)
    if (value === undefined || value === '') missing.push(name)
    else values.set(name, value)
  }
  if (missing.length > 0) return { spec, missing }
  const swap = (value: string): string =>
    value.replace(CREDENTIAL_PATTERN, (_whole, name: string) => values.get(name) ?? '')
  const swapRecord = (record: Record<string, string> | undefined): Record<string, string> | undefined => {
    if (record === undefined) return undefined
    const next: Record<string, string> = {}
    for (const [key, value] of Object.entries(record)) next[key] = swap(value)
    return next
  }
  const next: McpServerSpec = { ...spec }
  if (spec.command !== undefined) next.command = swap(spec.command)
  if (spec.url !== undefined) next.url = swap(spec.url)
  if (spec.cwd !== undefined) next.cwd = swap(spec.cwd)
  if (spec.args !== undefined) next.args = spec.args.map(swap)
  if (spec.env !== undefined) next.env = swapRecord(spec.env)
  if (spec.headers !== undefined) next.headers = swapRecord(spec.headers)
  return { spec: next, missing: [] }
}

/** Which stage a connection or protocol failure belongs to, from what the failure says. */
function stageOf(error: unknown, fallback: ProbeStage): ProbeStage {
  const message = messageOf(error)
  if (/timed out|timeout/i.test(message)) return 'timeout'
  if (
    /ENOENT|EACCES|EPERM|spawn|not found|connection closed|fetch failed|ECONNREFUSED|ECONNRESET|401|403|404|5\d\d/i.test(
      message,
    )
  ) {
    return 'transport'
  }
  return fallback
}

/** Run one body against a freshly connected client and always close it. */
async function withClient<T>(
  spec: McpServerSpec,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  body: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({ name: 'dsh-mcp-workbench', version: PLUGIN_VERSION }, { capabilities: {} })
  const controller = new AbortController()
  const forward = (): void => controller.abort(signal?.reason)
  if (signal?.aborted === true) forward()
  signal?.addEventListener('abort', forward, { once: true })
  if (controller.signal.aborted) throw controller.signal.reason ?? new Error('MCP connection aborted')
  try {
    await client.connect(createTransport(spec), { signal: controller.signal, timeout: timeoutMs })
    return await body(client)
  } finally {
    signal?.removeEventListener('abort', forward)
    try {
      await client.close()
    } catch {
      // The result already reports what happened; a failed cleanup adds nothing.
    }
  }
}

/** Settle a body within its own budget instead of the transport's. */
async function withDeadline<T>(work: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs)
  })
  try {
    return await Promise.race([work, deadline])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** Every tool a server lists, bounded by pages, names and the schema budget. */
async function listTools(
  client: Client,
  maxSchemas: number,
): Promise<{ items: ProbeTool[]; total: number; truncated: boolean }> {
  const items: ProbeTool[] = []
  let total = 0
  let truncated = false
  let cursor: string | undefined
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const listed = await client.listTools(cursor === undefined ? undefined : { cursor })
    for (const tool of listed.tools ?? []) {
      total += 1
      const schemaOmitted = items.length >= maxSchemas
      if (schemaOmitted) truncated = true
      items.push({
        name: tool.name,
        ...(typeof tool.description === 'string' ? { description: tool.description } : {}),
        ...(schemaOmitted ? { schemaOmitted } : { inputSchema: tool.inputSchema }),
      })
      if (total >= MAX_TOOL_NAMES) return { items, total, truncated: true }
    }
    const next = listed.nextCursor
    if (next === undefined || next === '') return { items, total, truncated }
    cursor = next
  }
  return { items, total, truncated: true }
}

/** One protocol content block as the page receives it. */
function toContent(block: unknown): CallContent {
  if (typeof block !== 'object' || block === null) return { type: 'other', kind: typeof block }
  const record = block as Record<string, unknown>
  const kind = typeof record['type'] === 'string' ? record['type'] : 'unknown'
  switch (kind) {
    case 'text':
      return { type: 'text', text: typeof record['text'] === 'string' ? record['text'] : '' }
    case 'image': {
      const data = typeof record['data'] === 'string' ? record['data'] : ''
      return {
        type: 'image',
        mimeType: String(record['mimeType'] ?? 'application/octet-stream'),
        bytes: Math.floor((data.length * 3) / 4),
      }
    }
    case 'audio': {
      const data = typeof record['data'] === 'string' ? record['data'] : ''
      return {
        type: 'audio',
        mimeType: String(record['mimeType'] ?? 'application/octet-stream'),
        bytes: Math.floor((data.length * 3) / 4),
      }
    }
    case 'resource': {
      const resource =
        typeof record['resource'] === 'object' && record['resource'] !== null
          ? (record['resource'] as Record<string, unknown>)
          : {}
      const text = typeof resource['text'] === 'string' ? resource['text'] : undefined
      const blob = typeof resource['blob'] === 'string' ? resource['blob'] : undefined
      return {
        type: 'resource',
        uri: String(resource['uri'] ?? ''),
        ...(typeof resource['mimeType'] === 'string' ? { mimeType: resource['mimeType'] } : {}),
        ...(text === undefined ? {} : { text }),
        ...(blob === undefined ? {} : { bytes: Math.floor((blob.length * 3) / 4) }),
      }
    }
    case 'resource_link':
      return {
        type: 'resource-link',
        uri: String(record['uri'] ?? ''),
        ...(typeof record['name'] === 'string' ? { name: record['name'] } : {}),
      }
    default:
      return { type: 'other', kind }
  }
}

/** Normalize a tool result within the byte budget. */
function normalizeContent(
  blocks: readonly unknown[],
  maxBytes: number,
): { content: CallContent[]; truncated: boolean } {
  const content: CallContent[] = []
  let used = 0
  for (const block of blocks) {
    const item = toContent(block)
    const size = JSON.stringify(item).length
    if (used + size > maxBytes) return { content, truncated: true }
    used += size
    content.push(item)
  }
  return { content, truncated: false }
}

/** The raw result, kept whole while it fits the budget and otherwise cut down to it. */
function boundedRaw(value: unknown, maxBytes: number): unknown {
  let text: string
  try {
    text = JSON.stringify(value) ?? 'null'
  } catch {
    return { unavailable: 'the result could not be serialised' }
  }
  if (text.length <= maxBytes) return value
  return { truncated: true, bytes: text.length, text: text.slice(0, maxBytes) }
}

const failedProbe = (probedAt: string, durationMs: number, error: ProbeError): ProbeResult => ({
  ok: false,
  toolCount: 0,
  tools: [],
  truncated: false,
  durationMs,
  probedAt,
  error,
})

/** Connect, read the server identity, and list its tools without registering anything. */
export async function probeServer(
  spec: McpServerSpec,
  options: ProbeOptions,
  signal?: AbortSignal,
): Promise<ProbeResult> {
  const started = Date.now()
  const probedAt = new Date().toISOString()
  const expanded = await expandCredentials(spec, options.credentials)
  if (expanded.missing.length > 0) {
    return failedProbe(probedAt, 0, {
      stage: 'credential',
      message: `unresolved credential reference: ${expanded.missing.join(', ')}`,
    })
  }
  try {
    return await withClient(expanded.spec, options.probeTimeoutMs, signal, async (client) => {
      const listed = await withDeadline(
        listTools(client, options.maxToolSchemas),
        options.probeTimeoutMs,
        'MCP tools/list timed out',
      )
      const info = client.getServerVersion()
      return {
        ok: true,
        ...(info === undefined
          ? {}
          : {
              serverInfo: {
                ...(typeof info.name === 'string' ? { name: info.name } : {}),
                ...(typeof info.version === 'string' ? { version: info.version } : {}),
              },
            }),
        toolCount: listed.total,
        tools: listed.items,
        truncated: listed.truncated,
        durationMs: Date.now() - started,
        probedAt,
      }
    })
  } catch (error) {
    return failedProbe(probedAt, Date.now() - started, {
      stage: stageOf(error, 'initialize'),
      message: messageOf(error),
    })
  }
}

/** Connect and call one tool with the arguments the caller supplied. */
export async function callServerTool(
  spec: McpServerSpec,
  options: ProbeOptions,
  request: { tool: string; arguments?: Record<string, unknown> },
  signal?: AbortSignal,
): Promise<CallResult> {
  const started = Date.now()
  if (request.tool.trim() === '') {
    return {
      ok: false,
      content: [],
      isError: false,
      truncated: false,
      durationMs: 0,
      error: { stage: 'tools-call', message: 'tool name is required' },
    }
  }
  const expanded = await expandCredentials(spec, options.credentials)
  if (expanded.missing.length > 0) {
    return {
      ok: false,
      content: [],
      isError: false,
      truncated: false,
      durationMs: 0,
      error: { stage: 'credential', message: `unresolved credential reference: ${expanded.missing.join(', ')}` },
    }
  }
  try {
    return await withClient(expanded.spec, options.probeTimeoutMs, signal, async (client) => {
      const called = await withDeadline(
        client.callTool({ name: request.tool, arguments: request.arguments ?? {} }),
        options.toolCallTimeoutMs,
        'MCP tools/call timed out',
      )
      const blocks = Array.isArray(called.content) ? called.content : []
      const normalized = normalizeContent(blocks, options.resultMaxBytes)
      return {
        ok: true,
        content: normalized.content,
        isError: called.isError === true,
        truncated: normalized.truncated,
        durationMs: Date.now() - started,
        raw: boundedRaw(called, options.resultMaxBytes),
      }
    })
  } catch (error) {
    return {
      ok: false,
      content: [],
      isError: false,
      truncated: false,
      durationMs: Date.now() - started,
      error: { stage: stageOf(error, 'tools-call'), message: messageOf(error) },
    }
  }
}
