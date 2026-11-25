/**
 * Live MCP sessions: one per server, kept for the lifetime of the plugin.
 *
 * The probe and the test call share a session, so a streamable-http server sees one `initialize`
 * instead of one per request; `dsh-mcp-client` keeps its connections the same way. A session is closed
 * when the server's configuration changes, when it is edited, removed, switched or restarted, and when
 * the plugin stops.
 *
 * @module
 */
import { Client } from '@modelcontextprotocol/client'
import type { Transport } from '@modelcontextprotocol/client'
import type { McpServerSpec } from './config.js'
import { withDeadline } from './deadline.js'
import { PLUGIN_VERSION } from './version.js'

/** How long a closing session may take when the server declares no budget of its own. */
export const DEFAULT_CLOSE_TIMEOUT_MS = 5_000

/** Failure text that means the session died, not that the request was wrong. */
const DISCONNECTED =
  /connection closed|not connected|session not found|fetch failed|ECONNRESET|ECONNREFUSED|EPIPE|socket hang up|transport (?:is )?closed/i

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** Whether this failure says the session is gone rather than the operation being rejected. */
export function looksDisconnected(error: unknown): boolean {
  return DISCONNECTED.test(messageOf(error))
}

/** What the pool needs from its owner. */
export interface ConnectionDeps {
  /** Build the transport a spec describes; the pool never reuses a transport. */
  transportFor(spec: McpServerSpec): Transport
  /** Where a failed cleanup is reported; the result already carries what the caller needs. */
  logger?: { warn(message: string, error?: unknown): void }
}

/** Budgets for one connect. */
export interface OpenSettings {
  connectTimeoutMs: number
}

/** What a caller may ask beyond the defaults. */
export interface UseOptions {
  /**
   * Reconnect once and rerun the body when the session turns out to be dead.
   *
   * Only safe for an idempotent operation: a listing may be replayed, a tool call may not.
   */
  retryOnDisconnect?: boolean
}

interface Live {
  client: Client
  transport: Transport
  /** The expanded spec this session was opened from; a different one means the session is stale. */
  fingerprint: string
  closeTimeoutMs: number
}

/** Sessions keyed by server name, shared by every probe and call this plugin makes. */
export class ConnectionPool {
  private readonly live = new Map<string, Live>()
  private readonly opening = new Map<string, { fingerprint: string; work: Promise<Live> }>()

  constructor(private readonly deps: ConnectionDeps) {}

  /** How many sessions the pool holds; used by the lifecycle tests and by the page later on. */
  size(): number {
    return this.live.size
  }

  /** Whether a session is currently held for this server. */
  has(name: string): boolean {
    return this.live.has(name)
  }

  /**
   * Run `body` against the session for `name`, opening it on first use.
   *
   * A spec whose expanded form differs from the one the session was opened from is a different server:
   * the old session is closed and a new one opened.
   */
  async use<T>(
    name: string,
    spec: McpServerSpec,
    settings: OpenSettings,
    signal: AbortSignal | undefined,
    body: (client: Client) => Promise<T>,
    options: UseOptions = {},
  ): Promise<T> {
    const fingerprint = JSON.stringify(spec)
    let live = await this.obtain(name, spec, fingerprint, settings, signal)
    try {
      return await body(live.client)
    } catch (error) {
      const disconnected = looksDisconnected(error)
      if (!disconnected) throw error
      await this.drop(name, live)
      if (options.retryOnDisconnect !== true || signal?.aborted === true) throw error
      live = await this.obtain(name, spec, fingerprint, settings, signal)
      return await body(live.client)
    }
  }

  /** Close the session for one server; a no-op when none is held. */
  async close(name: string): Promise<void> {
    const live = this.live.get(name)
    if (live === undefined) return
    this.live.delete(name)
    await this.closeLive(name, live)
  }

  /** Close every session; called when the plugin stops. */
  async closeAll(): Promise<void> {
    const names = [...this.live.keys()]
    await Promise.all(names.map((name) => this.close(name)))
  }

  private async obtain(
    name: string,
    spec: McpServerSpec,
    fingerprint: string,
    settings: OpenSettings,
    signal: AbortSignal | undefined,
  ): Promise<Live> {
    const current = this.live.get(name)
    if (current !== undefined) {
      if (current.fingerprint === fingerprint) return current
      await this.close(name)
    }
    const opening = this.opening.get(name)
    if (opening !== undefined) {
      const pending = await opening.work
      if (pending.fingerprint === fingerprint) return pending
      await this.close(name)
    }
    const work = this.open(name, spec, fingerprint, settings, signal)
    this.opening.set(name, { fingerprint, work })
    try {
      return await work
    } finally {
      this.opening.delete(name)
    }
  }

  private async open(
    name: string,
    spec: McpServerSpec,
    fingerprint: string,
    settings: OpenSettings,
    signal: AbortSignal | undefined,
  ): Promise<Live> {
    const transport = this.deps.transportFor(spec)
    const client = new Client({ name: 'dsh-mcp-workbench', version: PLUGIN_VERSION }, { capabilities: {} })
    let connected = false
    try {
      await client.connect(transport, {
        timeout: settings.connectTimeoutMs,
        ...(signal === undefined ? {} : { signal }),
      })
      connected = true
    } finally {
      if (!connected) {
        try {
          await transport.close()
        } catch (error) {
          this.warn(name, error)
        }
      }
    }
    if (signal?.aborted === true) {
      const live: Live = { client, transport, fingerprint, closeTimeoutMs: closeBudget(spec) }
      await this.closeLive(name, live)
      throw signal.reason instanceof Error ? signal.reason : new Error('MCP connection aborted')
    }
    const live: Live = { client, transport, fingerprint, closeTimeoutMs: closeBudget(spec) }
    this.live.set(name, live)
    const closed = transport.onclose
    transport.onclose = () => {
      closed?.()
      if (this.live.get(name) === live) this.live.delete(name)
    }
    return live
  }

  private async drop(name: string, live: Live): Promise<void> {
    if (this.live.get(name) === live) this.live.delete(name)
    await this.closeLive(name, live)
  }

  /** Close one client within its budget; a failure is reported, never thrown at the caller. */
  private async closeLive(name: string, live: Live): Promise<void> {
    try {
      await withDeadline(live.client.close(), live.closeTimeoutMs, 'MCP cleanup did not settle')
    } catch (error) {
      this.warn(name, error)
    }
  }

  private warn(name: string, error: unknown): void {
    this.deps.logger?.warn(`mcp-workbench: closing the session for ${name} failed:`, error)
  }
}

/** The close budget a spec asks for, or the pool default. */
function closeBudget(spec: McpServerSpec): number {
  return spec.closeTimeoutMs ?? DEFAULT_CLOSE_TIMEOUT_MS
}
