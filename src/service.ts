/** Every operation, implemented once; the sidebar page and the model tool both call this. */
import { ConnectionPool } from './connection.js'
import { applyPatch, expressionPath, validatePatched } from './edit.js'
import { WorkbenchFailure } from './failures.js'
import { MCP_MANAGER_PLUGIN, readInventory, type InventorySource, type ResolvedServer } from './inventory.js'
import { callServerTool, probeServer, transportFor } from './probe.js'
import { SERVER_NAME_PATTERN, normalizeServerSpec, validateServerSpec, type WorkbenchConfig } from './config.js'
import type { DshConfigEditor, DshCredentialsFace, DshHostContext, DshLoaderEntry, DshMcpManager } from './types/dsh.js'
import type { CallResult, ProbeResult, ProbeSummary, ServerPatch, ServerView } from './types/index.js'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export interface WorkbenchOptions {
  ctx: DshHostContext
  config(): WorkbenchConfig
  /** Replaced in tests; the plugin keeps one pool for its whole lifetime. */
  connections?: ConnectionPool
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

/**
 * The MCP servers a profile mounts, behind the operations the two surfaces need.
 *
 * The page is a window onto `@deepseek-ai/dsh-mcp-manager`: the servers it lists as `managed` live in
 * that row's `servers` map, which is the only place this plugin writes. Static `dsh-mcp-client` rows
 * and servers other plugins registered are shown read-only, but can still be probed and called.
 */
export class Workbench {
  private readonly probes = new Map<string, { result: ProbeResult; expiresAt: number }>()
  private readonly inflight = new Map<string, Promise<ProbeResult>>()
  private readonly connections: ConnectionPool

  constructor(private readonly options: WorkbenchOptions) {
    this.connections = options.connections ?? new ConnectionPool({ transportFor, logger: this.options.ctx.logger })
  }

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

  /** Refuse a write on a server this page only shows. */
  private readOnly(server: ResolvedServer, verb: string): WorkbenchFailure {
    if (server.source === 'profile') {
      return new WorkbenchFailure(
        'not-editable',
        `server "${server.name}" is a static row of the profile, so it is read-only here; move it into the ${MCP_MANAGER_PLUGIN} row to ${verb} it`,
      )
    }
    return new WorkbenchFailure(
      'not-editable',
      `server "${server.name}" is registered by another plugin and cannot be ${verb}d here`,
    )
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

  /**
   * The value behind a `${credential:NAME}` reference.
   *
   * The store layers its own keys over the launching environment, exactly as the manager does when it
   * connects; an absent service means every reference stays unresolved.
   */
  private async resolveCredential(name: string): Promise<string | undefined> {
    const credentials = this.options.ctx.get<DshCredentialsFace>('credentials')
    if (credentials === undefined) return undefined
    const hit = await credentials.resolve(name)
    return hit?.value
  }

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
      credentials: (credential: string) => this.resolveCredential(credential),
    }
    const spec = server.spec
    const work = probeServer(this.connections, name, spec, budgets, signal).then((result) => {
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
    return callServerTool(
      this.connections,
      name,
      server.spec,
      {
        probeTimeoutMs: config.probeTimeoutMs,
        toolCallTimeoutMs: config.toolCallTimeoutMs,
        maxToolSchemas: config.maxToolSchemas,
        resultMaxBytes: config.resultMaxBytes,
        credentials: (credential: string) => this.resolveCredential(credential),
      },
      request,
      signal,
    )
  }

  // -- writes ------------------------------------------------------------------

  async save(name: string, patch: ServerPatch): Promise<ServerDetail> {
    const server = this.require(name)
    if (server.source !== 'managed') throw this.readOnly(server, 'change')
    const base = server.raw ?? ((server.spec ?? {}) as unknown as Record<string, unknown>)
    const next = applyPatch({ ...base }, patch)
    const problems = validatePatched(next)
    if (problems.length > 0) {
      throw new WorkbenchFailure('invalid-config', problems.join('; '), problems)
    }
    await this.writeManagerRow(name, (servers) => ({ ...servers, [name]: next }))
    return this.detail(name)
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
    await this.writeManagerRow(name, (servers) => ({ ...servers, [name]: spec }))
    return this.detail(name).server
  }

  async remove(name: string): Promise<void> {
    const server = this.require(name)
    if (server.source !== 'managed') throw this.readOnly(server, 'remove')
    await this.writeManagerRow(name, (servers) => {
      const next = { ...servers }
      delete next[name]
      return next
    })
  }

  async setEnabled(name: string, enabled: boolean): Promise<ServerView> {
    const server = this.require(name)
    if (server.source !== 'managed') throw this.readOnly(server, 'switch')
    await this.writeManagerRow(name, (servers) => {
      const stored = servers[name]
      const next: Record<string, unknown> = isRecord(stored) ? { ...stored } : {}
      if (enabled) delete next['enabled']
      else next['enabled'] = false
      return { ...servers, [name]: next }
    })
    return this.detail(name).server
  }

  async restart(name: string): Promise<ServerView> {
    const server = this.require(name)
    if (server.source === 'profile') {
      throw new WorkbenchFailure(
        'unsupported',
        `server "${name}" is a static row of the profile; edit it and the row reloads`,
      )
    }
    const manager = this.manager()
    if (manager === undefined) throw new WorkbenchFailure('unsupported', 'the MCP manager service is not available')
    await manager.restart(name)
    await this.connections.close(name)
    return this.detail(name).server
  }

  // -- the manager row ---------------------------------------------------------

  /** The profile row this plugin edits: the one whose `servers` map the manager reads. */
  private managerEntry(): DshLoaderEntry {
    const editor = this.requireEditor()
    const layer = editor.configuration().find((candidate) => candidate.entry.options.name === MCP_MANAGER_PLUGIN)
    if (layer === undefined) {
      throw new WorkbenchFailure(
        'not-editable',
        `the profile has no ${MCP_MANAGER_PLUGIN} row, so servers cannot be stored here`,
      )
    }
    return layer.entry
  }

  /** Change one entry of that row's `servers` map, leaving the rest of it alone. */
  private async writeManagerRow(
    name: string,
    change: (servers: Record<string, unknown>) => Record<string, unknown>,
  ): Promise<void> {
    const entry = this.managerEntry()
    const editor = this.requireEditor()
    await editor.edit(entry, (current) => {
      const servers = isRecord(current['servers']) ? current['servers'] : {}
      const expression = expressionPath(servers, 'servers')
      if (expression !== undefined) {
        throw new WorkbenchFailure(
          'invalid-config',
          `the manager row keeps a "!!js" expression at ${expression}, and that row's schema only accepts a string there; store the value as a literal or as \${credential:NAME} and this server can be changed here`,
        )
      }
      return { ...current, servers: change(servers) }
    })
    // The fleet is rebuilt from the new map, so a cached probe and the live session no longer describe it.
    this.probes.delete(name)
    await this.connections.close(name)
  }

  // -- lifecycle ---------------------------------------------------------------

  /** Start serving; returns the cleanup the plugin calls when it unmounts. */
  start(): () => void {
    return () => {
      this.inflight.clear()
      this.probes.clear()
      // Sessions outlive a request, so the plugin has to hand them back when it stops.
      void this.connections.closeAll().catch((error: unknown) => {
        this.options.ctx.logger.warn('mcp-workbench: closing the live sessions failed:', error)
      })
    }
  }
}
