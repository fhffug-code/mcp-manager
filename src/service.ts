/** Every operation, implemented once; the settings page and the model tool both call this. */
import { applyPatch, validatePatched } from './edit.js'
import { WorkbenchFailure } from './failures.js'
import { readInventory, type InventorySource, type ResolvedServer } from './inventory.js'
import { callServerTool, probeServer } from './probe.js'
import {
  SERVER_NAME_PATTERN,
  normalizeServerSpec,
  validateServerSpec,
  type McpServerSpec,
  type WorkbenchConfig,
} from './config.js'
import { PLUGIN_NAME } from './version.js'
import type {
  DshConfigEditor,
  DshHostContext,
  DshLoaderEntry,
  DshMcpManager,
  DshPluginManagerFace,
} from './types/dsh.js'
import type { CallResult, ProbeResult, ProbeSummary, ServerPatch, ServerView } from './types/index.js'

export interface WorkbenchOptions {
  ctx: DshHostContext
  config(): WorkbenchConfig
  /** Called after the stored server map changed, so the caller's view of the config stays current. */
  applyServers?(servers: Record<string, McpServerSpec>): void
}

export interface ServerDetail {
  server: ServerView
  /** The last probe, when one ran and its result is still cached. */
  probe?: ProbeResult
}

export interface AddRequest {
  name: string
  spec: unknown
}

/** The three places that mount servers, behind the four operations the surfaces need. */
export class Workbench {
  private readonly probes = new Map<string, { result: ProbeResult; expiresAt: number }>()
  private readonly inflight = new Map<string, Promise<ProbeResult>>()
  private readonly registered = new Map<string, () => void>()

  constructor(private readonly options: WorkbenchOptions) {}

  // -- sources -----------------------------------------------------------------

  private manager(): DshMcpManager | undefined {
    return this.options.ctx.get<DshMcpManager>('mcpManager')
  }

  private editor(): DshConfigEditor | undefined {
    return this.options.ctx.get<DshConfigEditor>('configEditor')
  }

  private requireEditor(): DshConfigEditor {
    const editor = this.editor()
    if (editor === undefined) {
      throw new WorkbenchFailure(
        'config-editor-unavailable',
        'the config editor service is not available in this profile',
      )
    }
    return editor
  }

  private source(): InventorySource {
    return {
      configEditor: () => this.editor(),
      mcpManager: () => this.manager(),
      config: () => this.options.config(),
      probeSummary: (name) => this.cachedSummary(name),
    }
  }

  private cachedSummary(name: string): ProbeSummary | undefined {
    const entry = this.probes.get(name)
    if (entry === undefined || entry.expiresAt < Date.now()) return undefined
    const { result } = entry
    return {
      ok: result.ok,
      toolCount: result.toolCount,
      probedAt: result.probedAt,
      durationMs: result.durationMs,
      ...(result.error === undefined ? {} : { error: result.error }),
    }
  }

  /** The server with this name, or a refusal naming it. */
  private require(name: string): ResolvedServer {
    const server = readInventory(this.source()).find((candidate) => candidate.name === name)
    if (server === undefined) throw new WorkbenchFailure('unknown-server', `no MCP server named "${name}"`)
    return server
  }

  // -- reads -------------------------------------------------------------------

  list(): ServerView[] {
    return readInventory(this.source()).map((server) => server.view)
  }

  detail(name: string): ServerDetail {
    const server = this.require(name)
    const cached = this.probes.get(name)
    const fresh = cached !== undefined && cached.expiresAt >= Date.now()
    return { server: server.view, ...(fresh ? { probe: cached.result } : {}) }
  }

  // -- probes and calls --------------------------------------------------------

  async probe(name: string, options: { force?: boolean } = {}, signal?: AbortSignal): Promise<ProbeResult> {
    const server = this.require(name)
    if (server.spec === undefined) {
      throw new WorkbenchFailure('invalid-config', `server "${name}" has no usable transport configuration`)
    }
    const config = this.options.config()
    if (options.force !== true) {
      const cached = this.probes.get(name)
      if (cached !== undefined && cached.expiresAt >= Date.now()) return cached.result
      const running = this.inflight.get(name)
      if (running !== undefined) return running
    }
    const budgets = {
      probeTimeoutMs: config.probeTimeoutMs,
      toolCallTimeoutMs: config.toolCallTimeoutMs,
      maxToolSchemas: config.maxToolSchemas,
      resultMaxBytes: config.resultMaxBytes,
    }
    const spec = server.spec
    const work = probeServer(spec, budgets, signal).then((result) => {
      this.probes.set(name, { result, expiresAt: Date.now() + config.probeCacheTtlMs })
      this.inflight.delete(name)
      return result
    })
    if (options.force !== true) this.inflight.set(name, work)
    return work
  }

  async call(
    name: string,
    request: { tool: string; arguments?: Record<string, unknown> },
    signal?: AbortSignal,
  ): Promise<CallResult> {
    const server = this.require(name)
    if (server.spec === undefined) {
      throw new WorkbenchFailure('invalid-config', `server "${name}" has no usable transport configuration`)
    }
    const config = this.options.config()
    const result = await callServerTool(
      server.spec,
      {
        probeTimeoutMs: config.probeTimeoutMs,
        toolCallTimeoutMs: config.toolCallTimeoutMs,
        maxToolSchemas: config.maxToolSchemas,
        resultMaxBytes: config.resultMaxBytes,
      },
      request,
      signal,
    )
    return result
  }

  // -- writes ------------------------------------------------------------------

  async save(name: string, patch: ServerPatch): Promise<ServerDetail> {
    const server = this.require(name)
    if (server.source === 'profile') return this.saveProfile(server, patch)
    if (server.source === 'plugin') return this.savePlugin(server, patch)
    throw new WorkbenchFailure('not-editable', `server "${name}" is owned by the MCP manager and is read-only here`)
  }

  private async saveProfile(server: ResolvedServer, patch: ServerPatch): Promise<ServerDetail> {
    const entry = server.entry
    if (entry === undefined) throw new WorkbenchFailure('not-editable', `server "${server.name}" has no profile row`)
    const next = applyPatch({ ...(server.raw ?? {}) }, patch)
    const problems = validatePatched(next)
    if (problems.length > 0) {
      throw new WorkbenchFailure('invalid-config', problems.join('; '), problems)
    }
    const editor = this.requireEditor()
    await editor.edit(entry, () => next)
    return this.detail(server.name)
  }

  private async savePlugin(server: ResolvedServer, patch: ServerPatch): Promise<ServerDetail> {
    const merged = applyPatch({ ...((server.spec ?? {}) as Record<string, unknown>) }, patch)
    const spec = normalizeServerSpec(merged)
    if (spec === undefined) {
      const problems = validateServerSpec(merged)
      throw new WorkbenchFailure(
        'invalid-config',
        problems.join('; ') || 'the server configuration is invalid',
        problems,
      )
    }
    await this.writeServers({ ...this.options.config().servers, [server.name]: spec })
    return this.detail(server.name)
  }

  async add(request: AddRequest): Promise<ServerView> {
    const name = request.name.trim()
    if (!SERVER_NAME_PATTERN.test(name)) {
      throw new WorkbenchFailure(
        'invalid-request',
        'name must be 1-32 characters of letters, digits, underscore or hyphen',
      )
    }
    if (readInventory(this.source()).some((server) => server.name === name)) {
      throw new WorkbenchFailure('name-conflict', `a server named "${name}" is already mounted`)
    }
    const spec = normalizeServerSpec(request.spec)
    if (spec === undefined) {
      const problems = validateServerSpec(request.spec)
      throw new WorkbenchFailure(
        'invalid-config',
        problems.join('; ') || 'the server configuration is invalid',
        problems,
      )
    }
    await this.writeServers({ ...this.options.config().servers, [name]: spec })
    return this.require(name).view
  }

  async remove(name: string): Promise<void> {
    const server = this.require(name)
    if (server.source !== 'plugin') {
      throw new WorkbenchFailure(
        'not-editable',
        `server "${name}" belongs to ${server.source === 'profile' ? 'the profile' : 'the MCP manager'} and cannot be removed here`,
      )
    }
    const servers = { ...this.options.config().servers }
    delete servers[name]
    await this.writeServers(servers)
  }

  async setEnabled(name: string, enabled: boolean): Promise<ServerView> {
    const server = this.require(name)
    if (server.source === 'profile') return this.setProfileEnabled(server, enabled)
    if (server.source !== 'plugin') {
      throw new WorkbenchFailure(
        'not-editable',
        `server "${name}" belongs to the MCP manager and cannot be switched here`,
      )
    }
    const current = this.options.config().servers[name]
    if (current === undefined) throw new WorkbenchFailure('unknown-server', `no server named "${name}" is stored here`)
    const next: McpServerSpec = { ...current }
    if (enabled) delete next.enabled
    else next.enabled = false
    await this.writeServers({ ...this.options.config().servers, [name]: next })
    return this.require(name).view
  }

  /**
   * Switch a profile row through the plugin manager, which owns `disabled`.
   * The row's own config stays where it is; only the entry's enablement changes.
   */
  private async setProfileEnabled(server: ResolvedServer, enabled: boolean): Promise<ServerView> {
    const entryId = server.view.entryId
    if (entryId === undefined) {
      throw new WorkbenchFailure('not-editable', `server "${server.name}" has no profile entry to switch`)
    }
    const manager = this.options.ctx.get<DshPluginManagerFace>('pluginManager')
    if (manager === undefined) {
      throw new WorkbenchFailure(
        'unsupported',
        'the plugin manager service is not available in this profile, so a profile server cannot be switched here',
      )
    }
    await manager.setPluginEnabled(entryId, enabled)
    // Switching a server changes the tool set, so the cached probe no longer describes it.
    this.probes.delete(server.name)
    return { ...server.view, enabled }
  }

  async restart(name: string): Promise<ServerView> {
    const server = this.require(name)
    if (server.source === 'profile') {
      throw new WorkbenchFailure(
        'unsupported',
        `server "${name}" is mounted by the profile; edit it and the row reloads`,
      )
    }
    const manager = this.manager()
    if (manager === undefined) throw new WorkbenchFailure('unsupported', 'the MCP manager service is not available')
    await manager.restart(name)
    return this.detail(name).server
  }

  // -- persistence -------------------------------------------------------------

  /** Write this bundle's own server map into its config row. */
  private async writeServers(servers: Record<string, McpServerSpec>): Promise<void> {
    const editor = this.requireEditor()
    const entry = this.ownEntry(editor)
    await editor.edit(entry, (current) => ({ ...current, servers }))
    this.options.applyServers?.(servers)
    this.releaseAll()
    this.syncRegistrations()
  }

  /** The config row this bundle owns. */
  private ownEntry(editor: DshConfigEditor): DshLoaderEntry {
    const entries = editor.entries()
    const own = entries.find((entry) => entry.options.name === PLUGIN_NAME)
    if (own === undefined) {
      throw new WorkbenchFailure(
        'not-editable',
        `the profile has no configurable row for ${PLUGIN_NAME}, so servers cannot be stored`,
      )
    }
    return own
  }

  // -- lifecycle ---------------------------------------------------------------

  /** Register every enabled server this bundle owns; returns the cleanup. */
  start(): () => void {
    this.syncRegistrations()
    return () => {
      this.releaseAll()
      this.inflight.clear()
      this.probes.clear()
    }
  }

  /** Drop every live registration, so the next sync starts from the stored map alone. */
  private releaseAll(): void {
    for (const [name, dispose] of [...this.registered]) {
      try {
        dispose()
      } catch (error) {
        this.options.ctx.logger.warn(`mcp-workbench: ${name} was not released:`, error)
      }
    }
    this.registered.clear()
  }

  /** Make the live fleet match the stored server map. */
  syncRegistrations(): void {
    const manager = this.manager()
    if (manager === undefined) return
    const servers = this.options.config().servers
    for (const [name, spec] of Object.entries(servers)) {
      if (spec.enabled === false || this.registered.has(name)) continue
      try {
        const disposer: unknown = manager.register(name, spec)
        this.registered.set(name, typeof disposer === 'function' ? (disposer as () => void) : () => undefined)
      } catch (error) {
        this.options.ctx.logger.warn(`mcp-workbench: ${name} was not registered:`, error)
      }
    }
    for (const [name, dispose] of [...this.registered]) {
      const spec = servers[name]
      if (spec !== undefined && spec.enabled !== false) continue
      try {
        dispose()
      } catch (error) {
        this.options.ctx.logger.warn(`mcp-workbench: ${name} was not released:`, error)
      }
      this.registered.delete(name)
    }
  }
}

/** Read the transport fields of a stored spec for display. */
export const transportOfSpec = (spec: McpServerSpec | undefined): ServerView['transport'] =>
  spec?.transport ?? 'streamable-http'
