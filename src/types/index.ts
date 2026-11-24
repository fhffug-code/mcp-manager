/** Shapes shared by the Host service, the settings page and the model tool. */

export type TransportKind = 'stdio' | 'streamable-http'

export type ServerSource = 'profile' | 'plugin' | 'manager'

export type ReadOnlyReason = 'overridden' | 'unaddressable' | 'manager' | 'unsupported' | 'config-editor-unavailable'

/** One env or header entry; a secret keeps its value on the Host. */
export interface ServerField {
  /** The value, or null when it is a secret the page must not receive. */
  value: string | null
  secret: boolean
  /** The `!!js` expression behind the value, when the profile stores one instead of a literal. */
  expression?: string
}

export interface ServerTimeouts {
  toolCallTimeoutMs?: number
  startupTimeoutMs?: number
  closeTimeoutMs?: number
}

/** What the settings page shows for one server. */
export interface ServerView {
  name: string
  source: ServerSource
  transport: TransportKind
  endpoint: string
  enabled: boolean
  editable: boolean
  /** The profile entry id, so a switch can target the row the profile mounts. */
  entryId?: string
  readOnlyReason?: ReadOnlyReason
  command?: string
  args?: string[]
  cwd?: string
  url?: string
  env: Record<string, ServerField>
  headers: Record<string, ServerField>
  timeouts: ServerTimeouts
  /** Live state reported by the MCP manager, when it manages this server. */
  live?: string
  probe?: ProbeSummary
}

/** The probe headline kept beside a listed server. */
export interface ProbeSummary {
  ok: boolean
  toolCount: number
  probedAt: string
  durationMs: number
  error?: ProbeError
}

export type ProbeStage = 'transport' | 'initialize' | 'tools-list' | 'tools-call' | 'timeout' | 'credential'

export interface ProbeError {
  stage: ProbeStage
  message: string
}

export interface ProbeTool {
  name: string
  description?: string
  /** JSON Schema of the arguments, omitted when the tool list outgrew the schema budget. */
  inputSchema?: unknown
  schemaOmitted?: boolean
}

export interface ProbeResult {
  ok: boolean
  serverInfo?: { name?: string; version?: string }
  toolCount: number
  tools: ProbeTool[]
  truncated: boolean
  durationMs: number
  probedAt: string
  error?: ProbeError
}

export type CallContent =
  | { type: 'text'; text: string }
  | { type: 'image'; mimeType: string; bytes: number }
  | { type: 'audio'; mimeType: string; bytes: number }
  | { type: 'resource'; uri: string; mimeType?: string; text?: string; bytes?: number }
  | { type: 'resource-link'; uri: string; name?: string }
  | { type: 'other'; kind: string }

export interface CallResult {
  ok: boolean
  content: CallContent[]
  isError: boolean
  truncated: boolean
  durationMs: number
  /** The raw `tools/call` result as the server sent it, cut to the byte budget. */
  raw?: unknown
  error?: ProbeError
}

/** A field-wise edit; an omitted field keeps its value and null removes it. */
export interface ServerPatch {
  transport?: TransportKind
  url?: string | null
  command?: string | null
  args?: string[] | null
  cwd?: string | null
  env?: Record<string, string | null>
  headers?: Record<string, string | null>
  toolCallTimeoutMs?: number | null
  startupTimeoutMs?: number | null
  closeTimeoutMs?: number | null
}

export interface WorkbenchErrorBody {
  code: string
  message: string
  details?: unknown
}

export type WorkbenchResponse<T> = { ok: true; value: T } | { ok: false; error: WorkbenchErrorBody }
