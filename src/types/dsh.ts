/** The DeepSeek Harness contracts this bundle consumes. Type-only: nothing here is bundled. */

/** One Cordis loader row as the profile patch and the config editor expose it. */
export interface DshLoaderEntry {
  options: { id: string; name: string; config?: Record<string, unknown>; disabled?: boolean }
  parent: { tree: { ctx: { fiber: { entry?: { id: string } | undefined } } } }
}

/** A row's raw layer values, before `!!js` expressions are evaluated. */
export interface DshConfigLayer {
  entry: DshLoaderEntry
  inherited: Record<string, unknown>
  override?: Record<string, unknown>
}

export interface DshConfigEditor {
  documentPath: string
  entries(): DshLoaderEntry[]
  configuration(): DshConfigLayer[]
  edit(
    entry: DshLoaderEntry,
    change: (current: Record<string, unknown>, inherited: Record<string, unknown>) => Record<string, unknown>,
  ): Promise<void>
}

export interface DshManagedServerView {
  name: string
  configured: boolean
  status: { state: string } & Record<string, unknown>
}

export interface DshRegisteredServer {
  transport: 'stdio' | 'streamable-http'
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
}

export interface DshMcpManager {
  list(): DshManagedServerView[]
  register(name: string, server: DshRegisteredServer): unknown
  restart(name: string): unknown
}

/**
 * The profile manager. `setPluginEnabled` persists an entry's `disabled` in the profile patch and
 * applies it, which is the only supported way to switch a row off: the config editor cannot touch it.
 */
export interface DshPluginManagerFace {
  setPluginEnabled(id: string, enabled: boolean): Promise<unknown>
}

/**
 * The credential store a server's `${credential:NAME}` reference resolves against.
 *
 * The manager resolves those references itself before it connects; a probe this plugin opens has to
 * resolve them the same way, or it would send the literal template as the value.
 */
export interface DshCredentialsFace {
  resolve(ref: string): Promise<{ value: string } | undefined>
}

/** An exact Fetch route on the authenticated browser channel. */
export interface DshFetchRoute {
  path: string
  methods: readonly string[]
  requestBody: 'buffered' | 'streaming'
  fetch(request: Request): Promise<Response>
}

export interface DshConnection {
  fetch: { register(route: DshFetchRoute): unknown }
}

export interface DshLogger {
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
}

/** The Host context subset this plugin uses. */
export interface DshHostContext {
  get<T>(name: string): T | undefined
  inject(names: readonly string[], callback: (scope: DshHostContext) => void): void
  effect(callback: () => void | (() => void), label?: string): void
  logger: DshLogger
  fiber: { entry?: { id: string } | undefined }
}

export interface DshToolRegistry {
  register(definition: unknown): unknown
}
