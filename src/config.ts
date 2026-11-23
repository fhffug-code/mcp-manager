/** Plugin configuration: the servers this bundle owns plus probe budgets. */
import type { TransportKind } from './types/index.js'

/** The MCP server name shape both dsh-mcp-client and dsh-mcp-manager require. */
export const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

/** Errors a `fetch` may call its own; every reported failure is one of these. */
export const TRANSPORTS: readonly TransportKind[] = ['stdio', 'streamable-http']

/** One server this bundle registers with the MCP manager. */
export interface McpServerSpec {
  transport: TransportKind
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  url?: string
  headers?: Record<string, string>
  toolCallTimeoutMs?: number
  startupTimeoutMs?: number
  closeTimeoutMs?: number
  reconnect?: { enabled?: boolean; initialDelayMs?: number; maxDelayMs?: number; maxAttempts?: number }
  enabled?: boolean
}

export interface WorkbenchConfig {
  /** Servers this bundle owns and registers; persisted in this plugin's own row. */
  servers: Record<string, McpServerSpec>
  /** How long one probe may take before it is reported as a timeout. */
  probeTimeoutMs: number
  /** How long one tool call may take before it is reported as a timeout. */
  toolCallTimeoutMs: number
  probeCacheTtlMs: number
  resultMaxBytes: number
  maxToolSchemas: number
}

export const DEFAULT_CONFIG: WorkbenchConfig = {
  servers: {},
  probeTimeoutMs: 10_000,
  toolCallTimeoutMs: 60_000,
  probeCacheTtlMs: 30_000,
  resultMaxBytes: 262_144,
  maxToolSchemas: 64,
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const readPositiveInt = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback

const readStringMap = (value: unknown): Record<string, string> | undefined => {
  if (!isRecord(value)) return undefined
  const entries: Record<string, string> = {}
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string') entries[key] = item
  }
  return entries
}

/** Problems with a server spec, in the words the caller shows; empty means valid. */
export function validateServerSpec(spec: unknown): string[] {
  if (!isRecord(spec)) return ['server must be an object']
  const problems: string[] = []
  const transport = spec['transport']
  if (transport !== 'stdio' && transport !== 'streamable-http') {
    return ['transport must be "stdio" or "streamable-http"']
  }
  if (transport === 'stdio') {
    if (typeof spec['command'] !== 'string' || spec['command'].trim() === '') problems.push('command is required')
    if (spec['url'] !== undefined) problems.push('url is not used by a stdio server')
    if (
      spec['args'] !== undefined &&
      (!Array.isArray(spec['args']) || spec['args'].some((a) => typeof a !== 'string'))
    ) {
      problems.push('args must be a list of strings')
    }
  } else {
    const url = spec['url']
    if (typeof url !== 'string' || url.trim() === '') {
      problems.push('url is required')
    } else {
      try {
        const parsed = new URL(url)
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') problems.push('url must be http or https')
      } catch {
        problems.push('url must be an absolute http(s) URL')
      }
    }
    if (spec['command'] !== undefined) problems.push('command is not used by a streamable-http server')
  }
  for (const key of ['toolCallTimeoutMs', 'startupTimeoutMs', 'closeTimeoutMs'] as const) {
    const value = spec[key]
    if (value !== undefined && (typeof value !== 'number' || !Number.isInteger(value) || value <= 0)) {
      problems.push(`${key} must be a positive integer`)
    }
  }
  for (const key of ['env', 'headers'] as const) {
    const value = spec[key]
    if (value === undefined) continue
    if (!isRecord(value) || Object.values(value).some((item) => typeof item !== 'string')) {
      problems.push(`${key} must be a map of strings`)
    }
  }
  return problems
}

/** One stored server entry, dropping fields the transport does not use. */
export function normalizeServerSpec(spec: unknown): McpServerSpec | undefined {
  if (validateServerSpec(spec).length > 0 || !isRecord(spec)) return undefined
  const transport = spec['transport'] as TransportKind
  const normalized: McpServerSpec = { transport }
  if (typeof spec['command'] === 'string') normalized.command = spec['command']
  if (Array.isArray(spec['args'])) normalized.args = spec['args'] as string[]
  if (typeof spec['cwd'] === 'string') normalized.cwd = spec['cwd']
  if (typeof spec['url'] === 'string') normalized.url = spec['url']
  const env = readStringMap(spec['env'])
  if (env !== undefined) normalized.env = env
  const headers = readStringMap(spec['headers'])
  if (headers !== undefined) normalized.headers = headers
  for (const key of ['toolCallTimeoutMs', 'startupTimeoutMs', 'closeTimeoutMs'] as const) {
    const value = spec[key]
    if (typeof value === 'number') normalized[key] = value
  }
  if (isRecord(spec['reconnect'])) normalized.reconnect = spec['reconnect'] as NonNullable<McpServerSpec['reconnect']>
  if (spec['enabled'] === false) normalized.enabled = false
  return normalized
}

/** Read the plugin config, keeping every valid server and reporting the dropped ones. */
export function normalizeConfig(raw: unknown): { config: WorkbenchConfig; warnings: string[] } {
  const warnings: string[] = []
  if (raw !== undefined && !isRecord(raw))
    return { config: { ...DEFAULT_CONFIG }, warnings: ['config must be an object'] }
  const source = isRecord(raw) ? raw : {}
  const servers: Record<string, McpServerSpec> = {}
  const rawServers = source['servers']
  if (rawServers !== undefined && !isRecord(rawServers)) {
    warnings.push('config.servers must be an object')
  } else if (isRecord(rawServers)) {
    for (const [name, spec] of Object.entries(rawServers)) {
      if (!SERVER_NAME_PATTERN.test(name)) {
        warnings.push(`server "${name}" is not a valid name`)
        continue
      }
      const problems = validateServerSpec(spec)
      if (problems.length > 0) {
        warnings.push(`server "${name}" is invalid: ${problems.join('; ')}`)
        continue
      }
      const normalized = normalizeServerSpec(spec)
      if (normalized !== undefined) servers[name] = normalized
    }
  }
  return {
    config: {
      servers,
      probeTimeoutMs: readPositiveInt(source['probeTimeoutMs'], DEFAULT_CONFIG.probeTimeoutMs),
      toolCallTimeoutMs: readPositiveInt(source['toolCallTimeoutMs'], DEFAULT_CONFIG.toolCallTimeoutMs),
      probeCacheTtlMs: readPositiveInt(source['probeCacheTtlMs'], DEFAULT_CONFIG.probeCacheTtlMs),
      resultMaxBytes: readPositiveInt(source['resultMaxBytes'], DEFAULT_CONFIG.resultMaxBytes),
      maxToolSchemas: readPositiveInt(source['maxToolSchemas'], DEFAULT_CONFIG.maxToolSchemas),
    },
    warnings,
  }
}
