/** Host stand-ins: the config editor, the MCP manager and the context the service consumes. */
import { vi } from 'vitest'
import type { Mock } from 'vitest'
import type {
  DshConfigEditor,
  DshConfigLayer,
  DshConnection,
  DshCredentialsFace,
  DshHostContext,
  DshLoaderEntry,
  DshLogger,
  DshManagedServerView,
  DshMcpManager,
  DshToolRegistry,
} from '../../src/types/dsh.js'

/** One profile row, addressed the way the real loader addresses it. */
export function entry(options: DshLoaderEntry['options']): DshLoaderEntry {
  return {
    options,
    parent: { tree: { ctx: { fiber: { entry: { id: 'include' } } } } },
  }
}

export interface RecordedEdit {
  entry: DshLoaderEntry
  next: Record<string, unknown>
}

export interface FakeEditor extends DshConfigEditor {
  edits: RecordedEdit[]
}

/** A config editor that records what the service asked it to write. */
export function fakeEditor(layers: DshConfigLayer[]): FakeEditor {
  const edits: RecordedEdit[] = []
  return {
    documentPath: 'C:/profile/cordis.patch.yml',
    edits,
    entries: () => layers.map((layer) => layer.entry),
    configuration: () => layers,
    async edit(layerEntry, change) {
      const layer = layers.find((candidate) => candidate.entry === layerEntry)
      const current = layer?.entry.options.config ?? {}
      const inherited = layer?.inherited ?? {}
      const next = change(current, inherited)
      edits.push({ entry: layerEntry, next })
      if (layer !== undefined) layer.entry.options.config = next
    },
  }
}

export interface FakeManager extends DshMcpManager {
  registered: Map<string, Record<string, unknown>>
  restarted: string[]
  views: DshManagedServerView[]
}

/** An MCP manager that records registrations and restarts. */
export function fakeManager(views: DshManagedServerView[] = []): FakeManager {
  const registered = new Map<string, Record<string, unknown>>()
  const restarted: string[] = []
  return {
    registered,
    restarted,
    views,
    list: () => views,
    register(name, server) {
      registered.set(name, server as unknown as Record<string, unknown>)
      return () => registered.delete(name)
    },
    restart(name) {
      restarted.push(name)
      return undefined
    },
  }
}

export interface FakeCredentials extends DshCredentialsFace {
  asked: string[]
}

/** The credential store, holding the values a test hands it. */
export function fakeCredentials(values: Record<string, string> = {}): FakeCredentials {
  const asked: string[] = []
  return {
    asked,
    async resolve(ref) {
      asked.push(ref)
      const value = values[ref]
      return value === undefined ? undefined : { value }
    },
  }
}

/** The logger, kept typed so a test can assert what the service reported. */
export interface FakeLogger {
  info: Mock<DshLogger['info']>
  warn: Mock<DshLogger['warn']>
  error: Mock<DshLogger['error']>
}

export interface FakeContext extends DshHostContext {
  logger: FakeLogger
  effects: string[]
}

export interface FakeContextOptions {
  editor?: DshConfigEditor
  manager?: DshMcpManager
  tools?: DshToolRegistry
  connection?: DshConnection
  credentials?: DshCredentialsFace
}

/** The host context, with only the services a test asked for. */
export function fakeContext(options: FakeContextOptions = {}): FakeContext {
  const services: Record<string, unknown> = {
    configEditor: options.editor,
    mcpManager: options.manager,
    credentials: options.credentials,
    tools: options.tools,
    connection: options.connection,
  }
  const effects: string[] = []
  const logger: FakeLogger = {
    info: vi.fn<DshLogger['info']>(),
    warn: vi.fn<DshLogger['warn']>(),
    error: vi.fn<DshLogger['error']>(),
  }
  const context: FakeContext = {
    logger,
    effects,
    fiber: { entry: { id: 'mcp-workbench' } },
    get<T>(name: string): T | undefined {
      return services[name] as T | undefined
    },
    inject(names, callback) {
      const found: Record<string, unknown> = {}
      for (const name of names) found[name] = services[name]
      callback({ ...context, get: <T>(name: string) => found[name] as T | undefined })
    },
    effect(callback, label) {
      effects.push(label ?? '')
      callback()
    },
  }
  return context
}
