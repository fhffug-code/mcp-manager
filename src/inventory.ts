/** Every MCP server this profile mounts, from the three places that mount them. */
import type { McpServerSpec } from './config.js'
import { fieldsOf } from './edit.js'
import type { DshConfigEditor, DshConfigLayer, DshLoaderEntry, DshMcpManager } from './types/dsh.js'
import type { ProbeSummary, ReadOnlyReason, ServerSource, ServerTimeouts, ServerView } from './types/index.js'

/** The plugin whose rows the profile mounts as static MCP clients. */
export const MCP_CLIENT_PLUGIN = '@deepseek-ai/dsh-mcp-client'

/** The fleet plugin whose `servers` map the profile may override. */
export const MCP_MANAGER_PLUGIN = '@deepseek-ai/dsh-mcp-manager'

/** One server with the place it came from and the effective spec used to connect. */
export interface ResolvedServer {
  name: string
  source: ServerSource
  view: ServerView
  /** Present when the server can be connected: its effective, fully resolved spec. */
  spec?: McpServerSpec
  /** The profile row, for servers the profile mounts. */
  entry?: DshLoaderEntry
  /** The raw profile config (override or inherited), so edits start from what the file says. */
  raw?: Record<string, unknown>
}

/** What the inventory needs from the running Host. */
export interface InventorySource {
  configEditor(): DshConfigEditor | undefined
  mcpManager(): DshMcpManager | undefined
  probeSummary(name: string): ProbeSummary | undefined
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const stringOf = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined)

const numberField = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined

const readStringMap = (value: unknown): Record<string, string> | undefined => {
  if (!isRecord(value)) return undefined
  const map: Record<string, string> = {}
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string') map[key] = item
  }
  return Object.keys(map).length === 0 ? undefined : map
}

/** Pick the connection fields out of any config record, ignoring the rest. */
export function specFromRecord(record: Record<string, unknown>): McpServerSpec | undefined {
  const transport = record['transport']
  if (transport !== 'stdio' && transport !== 'streamable-http') return undefined
  const candidate: McpServerSpec = { transport }
  const command = stringOf(record['command'])
  if (command !== undefined) candidate.command = command
  if (Array.isArray(record['args']))
    candidate.args = record['args'].filter((arg): arg is string => typeof arg === 'string')
  const cwd = stringOf(record['cwd'])
  if (cwd !== undefined) candidate.cwd = cwd
  const url = stringOf(record['url'])
  if (url !== undefined) candidate.url = url
  const env = readStringMap(record['env'])
  if (env !== undefined) candidate.env = env
  const headers = readStringMap(record['headers'])
  if (headers !== undefined) candidate.headers = headers
  for (const key of ['toolCallTimeoutMs', 'startupTimeoutMs', 'closeTimeoutMs'] as const) {
    const value = numberField(record[key])
    if (value !== undefined) candidate[key] = value
  }
  return candidate
}

/** The row that describes a server, preferring the name the client actually uses. */
function nameOfRow(entry: DshLoaderEntry, raw: Record<string, unknown>, evaluated: Record<string, unknown>): string {
  return stringOf(evaluated['serverName']) ?? stringOf(raw['serverName']) ?? entry.options.id
}

function endpointOf(spec: McpServerSpec | undefined): string {
  if (spec === undefined) return ''
  if (spec.transport === 'stdio') return [spec.command ?? '', ...(spec.args ?? [])].join(' ').trim()
  return spec.url ?? ''
}

function timeoutsOf(spec: McpServerSpec | undefined): ServerTimeouts {
  const timeouts: ServerTimeouts = {}
  if (spec?.toolCallTimeoutMs !== undefined) timeouts.toolCallTimeoutMs = spec.toolCallTimeoutMs
  if (spec?.startupTimeoutMs !== undefined) timeouts.startupTimeoutMs = spec.startupTimeoutMs
  if (spec?.closeTimeoutMs !== undefined) timeouts.closeTimeoutMs = spec.closeTimeoutMs
  return timeouts
}

interface ViewInput {
  name: string
  source: ServerSource
  spec?: McpServerSpec
  raw?: Record<string, unknown>
  enabled: boolean
  editable: boolean
  entryId?: string
  readOnlyReason?: ReadOnlyReason
  live?: string
  probe?: ProbeSummary
}

/** Assemble the view, masking every credential the page must not receive. */
function buildView(input: ViewInput): ServerView {
  const spec = input.spec
  const raw = input.raw
  const view: ServerView = {
    name: input.name,
    source: input.source,
    transport: spec?.transport ?? (raw?.['transport'] === 'stdio' ? 'stdio' : 'streamable-http'),
    endpoint: endpointOf(spec),
    enabled: input.enabled,
    editable: input.editable,
    env: fieldsOf(raw?.['env'] === undefined ? spec?.env : raw['env']),
    headers: fieldsOf(raw?.['headers'] === undefined ? spec?.headers : raw['headers']),
    timeouts: timeoutsOf(spec),
  }
  if (input.readOnlyReason !== undefined) view.readOnlyReason = input.readOnlyReason
  if (input.entryId !== undefined) view.entryId = input.entryId
  const command = spec?.transport === 'stdio' ? spec.command : stringOf(raw?.['command'])
  if (command !== undefined) view.command = command
  if (spec?.transport === 'stdio' && spec.args !== undefined) view.args = spec.args
  else if (Array.isArray(raw?.['args'])) view.args = raw['args'].filter((arg): arg is string => typeof arg === 'string')
  if (spec?.cwd !== undefined) view.cwd = spec.cwd
  const url = spec?.transport === 'streamable-http' ? spec.url : stringOf(raw?.['url'])
  if (url !== undefined) view.url = url
  if (input.live !== undefined) view.live = input.live
  if (input.probe !== undefined) view.probe = input.probe
  return view
}

const stateOf = (status: unknown): string => {
  if (!isRecord(status)) return 'unknown'
  return typeof status['state'] === 'string' ? status['state'] : 'unknown'
}

/**
 * The layer one profile row's own config lives in.
 * A row the profile inserts through `insert:` has no top-level `id`, so the config editor reports its
 * `override` as an empty object and hands the real values back as `inherited`.
 */
function rawConfigOf(layer: DshConfigLayer): Record<string, unknown> {
  const override = isRecord(layer.override) ? layer.override : {}
  if (Object.keys(override).length > 0) return override
  return isRecord(layer.inherited) ? layer.inherited : {}
}

/** The servers belonging to the profile's static rows: readable and testable, not writable here. */
function profileServers(source: InventorySource): ResolvedServer[] {
  const editor = source.configEditor()
  if (editor === undefined) return []
  const manager = source.mcpManager()
  const live = new Map<string, string>()
  for (const view of manager?.list() ?? []) live.set(view.name, stateOf(view.status))
  const resolved: ResolvedServer[] = []
  for (const layer of editor.configuration()) {
    if (layer.entry.options.name !== MCP_CLIENT_PLUGIN) continue
    const raw = rawConfigOf(layer)
    const evaluated = layer.entry.options.config ?? {}
    const name = nameOfRow(layer.entry, raw, evaluated)
    const spec = specFromRecord(evaluated)
    const state = live.get(name)
    const probe = source.probeSummary(name)
    resolved.push({
      name,
      source: 'profile',
      ...(spec === undefined ? {} : { spec }),
      entry: layer.entry,
      raw,
      view: buildView({
        name,
        source: 'profile',
        ...(spec === undefined ? {} : { spec }),
        raw,
        enabled: layer.entry.options.disabled !== true,
        editable: false,
        entryId: layer.entry.options.id,
        readOnlyReason: 'profile',
        ...(state === undefined ? {} : { live: state }),
        ...(probe === undefined ? {} : { probe }),
      }),
    })
  }
  return resolved
}

/**
 * The servers a profile row gives to `@deepseek-ai/dsh-mcp-manager`.
 * That fleet reads `config.servers`, where `enabled` is an ordinary field, so unlike a row the patch
 * inserts these servers can be switched at runtime.
 */
function managedServers(source: InventorySource): ResolvedServer[] {
  const editor = source.configEditor()
  if (editor === undefined) return []
  const manager = source.mcpManager()
  const live = new Map<string, string>()
  for (const view of manager?.list() ?? []) live.set(view.name, stateOf(view.status))
  const resolved: ResolvedServer[] = []
  for (const layer of editor.configuration()) {
    if (layer.entry.options.name !== MCP_MANAGER_PLUGIN) continue
    const evaluated = layer.entry.options.config ?? {}
    const raw = rawConfigOf(layer)
    const records = isRecord(evaluated['servers']) ? evaluated['servers'] : {}
    const rawRecords = isRecord(raw['servers']) ? raw['servers'] : {}
    for (const [name, record] of Object.entries(records)) {
      if (!isRecord(record)) continue
      const spec = specFromRecord(record)
      const rawRecord = isRecord(rawRecords[name]) ? (rawRecords[name] as Record<string, unknown>) : undefined
      const state = live.get(name)
      const probe = source.probeSummary(name)
      resolved.push({
        name,
        source: 'managed',
        ...(spec === undefined ? {} : { spec }),
        entry: layer.entry,
        ...(rawRecord === undefined ? {} : { raw: rawRecord }),
        view: buildView({
          name,
          source: 'managed',
          ...(spec === undefined ? {} : { spec }),
          ...(rawRecord === undefined ? {} : { raw: rawRecord }),
          enabled: record['enabled'] !== false,
          editable: true,
          entryId: layer.entry.options.id,
          ...(state === undefined ? {} : { live: state }),
          ...(probe === undefined ? {} : { probe }),
        }),
      })
    }
  }
  return resolved
}

/** The servers the manager itself governs: readable, restartable, not writable here. */
function managerServers(source: InventorySource, known: ReadonlySet<string>): ResolvedServer[] {
  const manager = source.mcpManager()
  if (manager === undefined) return []
  const resolved: ResolvedServer[] = []
  for (const view of manager.list()) {
    if (known.has(view.name)) continue
    const probe = source.probeSummary(view.name)
    const record = isRecord(view.status) ? view.status : {}
    const spec = specFromRecord(record)
    resolved.push({
      name: view.name,
      source: 'manager',
      ...(spec === undefined ? {} : { spec }),
      view: buildView({
        name: view.name,
        source: 'manager',
        ...(spec === undefined ? {} : { spec }),
        enabled: stateOf(view.status) !== 'disabled',
        editable: false,
        readOnlyReason: 'manager',
        live: stateOf(view.status),
        ...(probe === undefined ? {} : { probe }),
      }),
    })
  }
  return resolved
}

/** One consistent picture of the fleet: static profile rows, the manager's map, then the rest. */
export function readInventory(source: InventorySource): ResolvedServer[] {
  const profile = profileServers(source)
  const managed = managedServers(source).filter((server) => !profile.some((known) => known.name === server.name))
  const known = new Set<string>([...profile, ...managed].map((server) => server.name))
  return [...profile, ...managed, ...managerServers(source, known)]
}

/** The server with this name, whenever any source mounts one. */
export function findServer(source: InventorySource, name: string): ResolvedServer | undefined {
  return readInventory(source).find((server) => server.name === name)
}
