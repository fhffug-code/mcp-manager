import { describe, expect, it } from 'vitest'
import { Workbench } from '../src/service.js'
import { WorkbenchFailure } from '../src/failures.js'
import { DEFAULT_CONFIG } from '../src/config.js'
import { MCP_CLIENT_PLUGIN, MCP_MANAGER_PLUGIN } from '../src/inventory.js'
import { entry, fakeContext, fakeCredentials, fakeEditor, fakeManager } from './helpers/fakes.js'
import type { ConnectionPool } from '../src/connection.js'
import type { DshConfigLayer } from '../src/types/dsh.js'

/** A pool that records what the service asked it to close, without opening anything. */
function fakeConnections(): { pool: ConnectionPool; closed: string[] } {
  const closed: string[] = []
  const pool = {
    size: (): number => 0,
    has: (): boolean => false,
    use: async (): Promise<never> => {
      throw new Error('these tests never open a session')
    },
    close: async (name: string): Promise<void> => {
      closed.push(name)
    },
    closeAll: async (): Promise<void> => {
      closed.push('*')
    },
  }
  return { pool: pool as unknown as ConnectionPool, closed }
}

const clientLayer = (id: string, name: string, config: Record<string, unknown>) => ({
  entry: entry({ id, name: MCP_CLIENT_PLUGIN, config }),
  inherited: {},
  override: config,
})

const managedLayer = (servers: Record<string, unknown>) => ({
  entry: entry({ id: 'mcp-manager', name: MCP_MANAGER_PLUGIN, config: { servers } }),
  inherited: {},
})

/** The manager map a layer holds right now, after whichever edit the service made. */
const recordsOf = (layer: ReturnType<typeof managedLayer>): Record<string, unknown> => {
  const stored = layer.entry.options.config?.['servers']
  return typeof stored === 'object' && stored !== null && !Array.isArray(stored)
    ? (stored as Record<string, unknown>)
    : {}
}

/** The failure code an operation refused with, so each test asserts the reason rather than the wording. */
async function failureCode(run: () => Promise<unknown>): Promise<string> {
  try {
    await run()
  } catch (error) {
    if (error instanceof WorkbenchFailure) return error.code
    throw error
  }
  throw new Error('expected a WorkbenchFailure')
}

interface Harness {
  workbench: Workbench
  editor: ReturnType<typeof fakeEditor>
  manager: ReturnType<typeof fakeManager>
}

function harness(
  options: {
    layers?: DshConfigLayer[]
    manager?: ReturnType<typeof fakeManager>
    editor?: boolean
    managerService?: boolean
    credentials?: ReturnType<typeof fakeCredentials>
    connections?: ConnectionPool
  } = {},
): Harness {
  const layers = options.layers ?? []
  const editor = fakeEditor(layers)
  const manager = options.manager ?? fakeManager()
  const ctx = fakeContext({
    ...(options.editor === false ? {} : { editor }),
    ...(options.managerService === false ? {} : { manager }),
    ...(options.credentials === undefined ? {} : { credentials: options.credentials }),
  })
  const workbench = new Workbench({
    ctx,
    config: () => ({ ...DEFAULT_CONFIG }),
    connections: options.connections ?? fakeConnections().pool,
  })
  return { workbench, editor, manager }
}

const profileRow = {
  serverName: 'a',
  transport: 'stdio',
  command: 'node',
}

describe('reads', () => {
  it('lists the servers and reports an unknown one', () => {
    const { workbench } = harness({ layers: [clientLayer('mcp-a', 'a', profileRow)] })
    expect(workbench.list().map((view) => view.name)).toEqual(['a'])
    expect(() => workbench.detail('nope')).toThrow(WorkbenchFailure)
    expect(() => workbench.detail('nope')).toThrow('no MCP server named "nope"')
  })

  it('reports a cached probe beside the server', async () => {
    const { workbench } = harness({
      layers: [managedLayer({ creds: { transport: 'stdio', command: 'node', args: ['${credential:NOPE}'] } })],
    })
    const result = await workbench.probe('creds')
    expect(result.ok).toBe(false)
    expect(workbench.detail('creds').probe).toEqual(result)
  })
})

describe('probe and call', () => {
  it('reports an unresolved credential without connecting', async () => {
    const { workbench } = harness({
      layers: [managedLayer({ creds: { transport: 'stdio', command: 'node', env: { A: '${credential:A}' } } })],
    })
    const result = await workbench.probe('creds')
    expect(result).toMatchObject({ ok: false, toolCount: 0, error: { stage: 'credential' } })
  })

  it('serves the cached probe until it asks for a fresh one', async () => {
    const { workbench } = harness({
      layers: [managedLayer({ creds: { transport: 'stdio', command: 'node', env: { A: '${credential:A}' } } })],
    })
    const first = await workbench.probe('creds')
    expect(await workbench.probe('creds')).toBe(first)
    const forced = await workbench.probe('creds', { force: true })
    expect(forced).not.toBe(first)
  })

  it('shares one probe while it is running', async () => {
    const { workbench } = harness({
      layers: [managedLayer({ creds: { transport: 'stdio', command: 'node', env: { A: '${credential:A}' } } })],
    })
    const [first, second] = await Promise.all([workbench.probe('creds'), workbench.probe('creds')])
    expect(second).toBe(first)
  })

  it('refuses to probe a server with no transport', async () => {
    const { workbench } = harness({ layers: [managedLayer({ broken: { serverName: 'broken' } })] })
    expect(await failureCode(() => workbench.probe('broken'))).toBe('invalid-config')
  })

  it('reports an unresolved credential on a call', async () => {
    const { workbench } = harness({
      layers: [managedLayer({ creds: { transport: 'streamable-http', url: 'https://x/${credential:A}' } })],
    })
    const result = await workbench.call('creds', { tool: 'echo' })
    expect(result).toMatchObject({ ok: false, content: [], error: { stage: 'credential' } })
  })

  it('asks the credential store before it connects', async () => {
    const credentials = fakeCredentials({ A: 'stored-secret' })
    const { workbench } = harness({
      layers: [
        managedLayer({
          creds: { transport: 'stdio', command: 'dsh-no-such-command-xyz', env: { A: '${credential:A}' } },
        }),
      ],
      credentials,
    })
    const result = await workbench.probe('creds')
    expect(credentials.asked).toEqual(['A'])
    expect(result.error?.stage).not.toBe('credential')
  })

  it('reports a credential the store does not hold', async () => {
    const credentials = fakeCredentials()
    const { workbench } = harness({
      layers: [
        managedLayer({
          creds: { transport: 'stdio', command: 'dsh-no-such-command-xyz', env: { A: '${credential:A}' } },
        }),
      ],
      credentials,
    })
    const result = await workbench.probe('creds')
    expect(result).toMatchObject({ ok: false, durationMs: 0, error: { stage: 'credential' } })
    expect(credentials.asked).toEqual(['A'])
  })

  it('refuses a call to a server with no transport', async () => {
    const { workbench } = harness({ layers: [managedLayer({ broken: { serverName: 'broken' } })] })
    expect(await failureCode(() => workbench.call('broken', { tool: 'echo' }))).toBe('invalid-config')
  })
})

describe('writes on the manager row', () => {
  it('stores a new server in the manager row', async () => {
    const layer = managedLayer({ clion: { transport: 'streamable-http', url: 'http://127.0.0.1/stream' } })
    const { workbench } = harness({ layers: [layer] })

    const view = await workbench.add({ name: 'added', spec: { transport: 'stdio', command: 'node', extra: 1 } })
    expect(view).toMatchObject({ name: 'added', source: 'managed', enabled: true, endpoint: 'node' })
    expect(recordsOf(layer)['added']).toEqual({ transport: 'stdio', command: 'node' })
    expect(recordsOf(layer)['clion']).toMatchObject({ url: 'http://127.0.0.1/stream' })
  })

  it('creates the map when the row holds none yet', async () => {
    const layer = { entry: entry({ id: 'mcp-manager', name: MCP_MANAGER_PLUGIN, config: {} }), inherited: {} }
    const { workbench } = harness({ layers: [layer] })
    await workbench.add({ name: 'fresh', spec: { transport: 'stdio', command: 'node' } })
    const stored = layer.entry.options.config?.['servers']
    expect(stored).toEqual({ fresh: { transport: 'stdio', command: 'node' } })
  })

  it('refuses the invalid names and specs of an add', async () => {
    const { workbench, editor } = harness({ layers: [managedLayer({})] })
    expect(await failureCode(() => workbench.add({ name: 'two words', spec: {} }))).toBe('invalid-request')
    expect(await failureCode(() => workbench.add({ name: 'bad', spec: { transport: 'stdio' } }))).toBe('invalid-config')
    expect(editor.edits).toEqual([])
  })

  it('refuses a name another source already uses', async () => {
    const { workbench } = harness({ layers: [clientLayer('mcp-a', 'a', profileRow), managedLayer({})] })
    expect(await failureCode(() => workbench.add({ name: 'a', spec: { transport: 'stdio', command: 'node' } }))).toBe(
      'name-conflict',
    )
  })

  it('refuses to add when the profile has no manager row', async () => {
    const { workbench } = harness({ layers: [] })
    expect(
      await failureCode(() => workbench.add({ name: 'fresh', spec: { transport: 'stdio', command: 'node' } })),
    ).toBe('not-editable')
  })

  it('refuses to add without a config editor', async () => {
    const { workbench } = harness({ editor: false })
    expect(
      await failureCode(() => workbench.add({ name: 'fresh', spec: { transport: 'stdio', command: 'node' } })),
    ).toBe('config-editor-unavailable')
  })

  it('patches a managed server and leaves its neighbours alone', async () => {
    const layer = managedLayer({
      clion: { transport: 'streamable-http', url: 'http://127.0.0.1/stream' },
      other: { transport: 'stdio', command: 'node' },
    })
    const { workbench } = harness({ layers: [layer] })
    await workbench.save('clion', { toolCallTimeoutMs: 5000 })
    expect(recordsOf(layer)['clion']).toMatchObject({ url: 'http://127.0.0.1/stream', toolCallTimeoutMs: 5000 })
    expect(recordsOf(layer)['other']).toEqual({ transport: 'stdio', command: 'node' })
  })

  it('refuses a patch that would make the record invalid', async () => {
    const layer = managedLayer({ clion: { transport: 'streamable-http', url: 'http://127.0.0.1/stream' } })
    const { workbench, editor } = harness({ layers: [layer] })
    expect(await failureCode(() => workbench.save('clion', { url: null }))).toBe('invalid-config')
    expect(editor.edits).toEqual([])
  })

  it('removes a managed server', async () => {
    const layer = managedLayer({
      clion: { transport: 'streamable-http', url: 'http://127.0.0.1/stream' },
      other: { transport: 'stdio', command: 'node' },
    })
    const { workbench } = harness({ layers: [layer] })
    await workbench.remove('clion')
    expect(Object.keys(recordsOf(layer))).toEqual(['other'])
  })

  it('enables and disables a managed server', async () => {
    const layer = managedLayer({ clion: { transport: 'streamable-http', url: 'http://127.0.0.1/stream' } })
    const { workbench } = harness({ layers: [layer] })

    const off = await workbench.setEnabled('clion', false)
    expect(off).toMatchObject({ name: 'clion', source: 'managed', enabled: false })
    expect(recordsOf(layer)['clion']).toMatchObject({ enabled: false, url: 'http://127.0.0.1/stream' })

    const on = await workbench.setEnabled('clion', true)
    expect(on.enabled).toBe(true)
    expect(recordsOf(layer)['clion']).not.toHaveProperty('enabled')
  })

  it('refuses to rewrite a manager row that keeps a !!js expression', async () => {
    const layer = managedLayer({
      clion: { transport: 'streamable-http', url: 'http://127.0.0.1/stream' },
      github: { transport: 'stdio', command: 'node', env: { TOKEN: { __jsExpr: 'process.env.TOKEN' } } },
    })
    const { workbench } = harness({ layers: [layer] })

    const error = await workbench.setEnabled('clion', false).catch((thrown: unknown) => thrown)
    expect(error).toBeInstanceOf(WorkbenchFailure)
    expect((error as WorkbenchFailure).code).toBe('invalid-config')
    expect((error as WorkbenchFailure).message).toContain('servers.github.env.TOKEN')
    expect(recordsOf(layer)['clion']).not.toHaveProperty('enabled')
    expect(recordsOf(layer)['github']).toMatchObject({ env: { TOKEN: { __jsExpr: 'process.env.TOKEN' } } })
  })
})

describe('read-only sources', () => {
  it('refuses to edit a static profile row', async () => {
    const { workbench, editor } = harness({ layers: [clientLayer('mcp-a', 'a', profileRow)] })
    expect(await failureCode(() => workbench.save('a', { toolCallTimeoutMs: 1000 }))).toBe('not-editable')
    expect(await failureCode(() => workbench.remove('a'))).toBe('not-editable')
    expect(await failureCode(() => workbench.setEnabled('a', false))).toBe('not-editable')
    expect(editor.edits).toEqual([])
  })

  it('refuses to edit a server another plugin registered', async () => {
    const manager = fakeManager([{ name: 'external', configured: true, status: { state: 'ready' } }])
    const { workbench, editor } = harness({ manager, layers: [managedLayer({})] })
    expect(await failureCode(() => workbench.save('external', { url: 'https://y/mcp' }))).toBe('not-editable')
    expect(await failureCode(() => workbench.setEnabled('external', false))).toBe('not-editable')
    expect(editor.edits).toEqual([])
  })

  it('still probes and calls a read-only server', async () => {
    const { workbench } = harness({
      layers: [
        clientLayer('mcp-a', 'a', {
          serverName: 'a',
          transport: 'stdio',
          command: 'node',
          env: { K: '${credential:K}' },
        }),
      ],
    })
    expect(await workbench.probe('a')).toMatchObject({ ok: false, error: { stage: 'credential' } })
  })
})

describe('restart', () => {
  it('restarts a managed server through the manager', async () => {
    const manager = fakeManager()
    const { workbench } = harness({
      manager,
      layers: [managedLayer({ clion: { transport: 'streamable-http', url: 'http://127.0.0.1/stream' } })],
    })
    expect((await workbench.restart('clion')).name).toBe('clion')
    expect(manager.restarted).toEqual(['clion'])
  })

  it('restarts a manager-governed server', async () => {
    const manager = fakeManager([{ name: 'external', configured: true, status: { state: 'ready' } }])
    const { workbench } = harness({ manager })
    expect((await workbench.restart('external')).name).toBe('external')
    expect(manager.restarted).toEqual(['external'])
  })

  it('refuses a profile row', async () => {
    const { workbench } = harness({ layers: [clientLayer('mcp-a', 'a', profileRow)] })
    expect(await failureCode(() => workbench.restart('a'))).toBe('unsupported')
  })

  it('reports a missing manager', async () => {
    const { workbench } = harness({
      managerService: false,
      layers: [managedLayer({ clion: { transport: 'streamable-http', url: 'http://127.0.0.1/stream' } })],
    })
    expect(await failureCode(() => workbench.restart('clion'))).toBe('unsupported')
  })
})

describe('lifecycle', () => {
  it('hands every live session back when it stops', () => {
    const connections = fakeConnections()
    const { workbench } = harness({ connections: connections.pool })
    const stop = workbench.start()
    stop()
    expect(connections.closed).toEqual(['*'])
  })

  it('keeps going when a session will not close', () => {
    const pool = {
      size: (): number => 0,
      has: (): boolean => false,
      use: async (): Promise<never> => {
        throw new Error('these tests never open a session')
      },
      close: async (): Promise<void> => undefined,
      closeAll: async (): Promise<void> => {
        throw new Error('cleanup failed')
      },
    } as unknown as ConnectionPool
    const { workbench } = harness({ connections: pool })
    const stop = workbench.start()
    expect(() => stop()).not.toThrow()
  })
})

describe('live sessions', () => {
  it('closes the session of a managed server it just wrote', async () => {
    const connections = fakeConnections()
    const { workbench } = harness({
      connections: connections.pool,
      layers: [managedLayer({ a: { transport: 'stdio', command: 'node' } })],
    })
    await workbench.save('a', { toolCallTimeoutMs: 9_000 })
    expect(connections.closed).toEqual(['a'])
  })

  it('closes the session of a managed server it just switched', async () => {
    const connections = fakeConnections()
    const { workbench } = harness({
      connections: connections.pool,
      layers: [managedLayer({ a: { transport: 'stdio', command: 'node' } })],
    })
    await workbench.setEnabled('a', false)
    expect(connections.closed).toEqual(['a'])
  })

  it('closes the session of a server it added', async () => {
    const connections = fakeConnections()
    const { workbench } = harness({ connections: connections.pool, layers: [managedLayer({})] })
    await workbench.add({ name: 'added', spec: { transport: 'stdio', command: 'node' } })
    expect(connections.closed).toEqual(['added'])
  })

  it('closes the session it restarted', async () => {
    const connections = fakeConnections()
    const manager = fakeManager([{ name: 'external', configured: true, status: { state: 'ready' } }])
    const { workbench } = harness({ connections: connections.pool, manager })
    await workbench.restart('external')
    expect(connections.closed).toEqual(['external'])
  })
})
