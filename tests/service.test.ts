import { describe, expect, it, vi } from 'vitest'
import { Workbench, transportOfSpec } from '../src/service.js'
import { WorkbenchFailure } from '../src/failures.js'
import { DEFAULT_CONFIG, type WorkbenchConfig } from '../src/config.js'
import { PLUGIN_NAME } from '../src/version.js'
import { MCP_CLIENT_PLUGIN } from '../src/inventory.js'
import { entry, fakeContext, fakeEditor, fakeManager, fakePluginManager } from './helpers/fakes.js'

const clientLayer = (id: string, name: string, config: Record<string, unknown>) => ({
  entry: entry({ id, name: MCP_CLIENT_PLUGIN, config }),
  inherited: {},
  override: config,
})

const ownLayer = (servers: WorkbenchConfig['servers'] = {}) => ({
  entry: entry({ id: 'mcp-workbench', name: PLUGIN_NAME, config: { servers } }),
  inherited: {},
})

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
  pluginManager: ReturnType<typeof fakePluginManager>
  servers: () => WorkbenchConfig['servers']
}

function harness(
  options: {
    layers?: ReturnType<typeof clientLayer>[]
    servers?: WorkbenchConfig['servers']
    manager?: ReturnType<typeof fakeManager>
    editor?: boolean
    managerService?: boolean
    pluginManager?: ReturnType<typeof fakePluginManager>
    pluginService?: boolean
  } = {},
): Harness {
  let servers = options.servers ?? {}
  const layers = options.layers ?? []
  const editor = fakeEditor(layers)
  const manager = options.manager ?? fakeManager()
  const pluginManager = options.pluginManager ?? fakePluginManager()
  const ctx = fakeContext({
    ...(options.editor === false ? {} : { editor }),
    ...(options.managerService === false ? {} : { manager }),
    ...(options.pluginService === false ? {} : { pluginManager }),
  })
  const workbench = new Workbench({
    ctx,
    config: () => ({ ...DEFAULT_CONFIG, servers }),
    applyServers: (next) => {
      servers = next
    },
  })
  return { workbench, editor, manager, pluginManager, servers: () => servers }
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
      servers: { creds: { transport: 'stdio', command: 'node', args: ['${credential:NOPE}'] } },
    })
    const result = await workbench.probe('creds')
    expect(result.ok).toBe(false)
    expect(workbench.detail('creds').probe).toEqual(result)
  })
})

describe('probe and call', () => {
  it('reports an unresolved credential without connecting', async () => {
    const { workbench } = harness({
      servers: { creds: { transport: 'stdio', command: 'node', env: { A: '${credential:A}' } } },
    })
    const result = await workbench.probe('creds')
    expect(result).toMatchObject({ ok: false, toolCount: 0, error: { stage: 'credential' } })
  })

  it('serves the cached probe until it asks for a fresh one', async () => {
    const { workbench } = harness({
      servers: { creds: { transport: 'stdio', command: 'node', env: { A: '${credential:A}' } } },
    })
    const first = await workbench.probe('creds')
    expect(await workbench.probe('creds')).toBe(first)
    const forced = await workbench.probe('creds', { force: true })
    expect(forced).not.toBe(first)
  })

  it('shares one probe while it is running', async () => {
    const { workbench } = harness({
      servers: { creds: { transport: 'stdio', command: 'node', env: { A: '${credential:A}' } } },
    })
    const [first, second] = await Promise.all([workbench.probe('creds'), workbench.probe('creds')])
    expect(second).toBe(first)
  })

  it('refuses to probe a server with no transport', async () => {
    const { workbench } = harness({
      layers: [
        {
          entry: entry({ id: 'mcp-broken', name: MCP_CLIENT_PLUGIN, config: { serverName: 'broken' } }),
          inherited: {},
        },
      ],
    })
    expect(await failureCode(() => workbench.probe('broken'))).toBe('invalid-config')
  })

  it('reports an unresolved credential on a call', async () => {
    const { workbench } = harness({
      servers: { creds: { transport: 'streamable-http', url: 'https://x/${credential:A}' } },
    })
    const result = await workbench.call('creds', { tool: 'echo' })
    expect(result).toMatchObject({ ok: false, content: [], error: { stage: 'credential' } })
  })

  it('refuses a call to a server with no transport', async () => {
    const { workbench } = harness({
      layers: [
        {
          entry: entry({ id: 'mcp-broken', name: MCP_CLIENT_PLUGIN, config: { serverName: 'broken' } }),
          inherited: {},
        },
      ],
    })
    expect(await failureCode(() => workbench.call('broken', { tool: 'echo' }))).toBe('invalid-config')
  })
})

describe('profile writes', () => {
  it('writes the raw layer with the patch applied', async () => {
    const { workbench, editor } = harness({
      layers: [
        clientLayer('mcp-github', 'github', {
          serverName: 'github',
          transport: 'stdio',
          command: 'gh.exe',
          env: { GITHUB_TOKEN: 'evaluated' },
        }),
      ],
    })
    await workbench.save('github', { env: { GITHUB_TOKEN: '!!js process.env.TOKEN' } })
    expect(editor.edits).toHaveLength(1)
    expect(editor.edits[0]?.next).toEqual({
      serverName: 'github',
      transport: 'stdio',
      command: 'gh.exe',
      env: { GITHUB_TOKEN: { __jsExpr: 'process.env.TOKEN' } },
    })
  })

  it('refuses a patch that would make the row invalid', async () => {
    const { workbench, editor } = harness({ layers: [clientLayer('mcp-a', 'a', profileRow)] })
    expect(await failureCode(() => workbench.save('a', { command: null }))).toBe('invalid-config')
    expect(editor.edits).toEqual([])
  })

  it('refuses to write a manager-governed server', async () => {
    const manager = fakeManager([{ name: 'external', configured: true, status: { state: 'ready' } }])
    const { workbench, editor } = harness({ manager })
    expect(await failureCode(() => workbench.save('external', { url: 'https://y/mcp' }))).toBe('not-editable')
    expect(editor.edits).toEqual([])
  })

  it('refuses to store servers without a config editor', async () => {
    const { workbench } = harness({ editor: false, layers: [] })
    expect(
      await failureCode(() => workbench.add({ name: 'fresh', spec: { transport: 'stdio', command: 'node' } })),
    ).toBe('config-editor-unavailable')
  })
})

describe('plugin writes', () => {
  it('stores a patched server in its own row and re-registers it', async () => {
    const { workbench, editor, manager, servers } = harness({
      layers: [ownLayer({ mine: { transport: 'stdio', command: 'node' } })],
      servers: { mine: { transport: 'stdio', command: 'node' } },
    })
    workbench.syncRegistrations()
    await workbench.save('mine', { args: ['server.mjs'], toolCallTimeoutMs: 1000 })
    expect(editor.edits.at(-1)?.next).toEqual({
      servers: { mine: { transport: 'stdio', command: 'node', args: ['server.mjs'], toolCallTimeoutMs: 1000 } },
    })
    expect(servers().mine).toMatchObject({ args: ['server.mjs'] })
    expect(manager.registered.get('mine')).toMatchObject({ args: ['server.mjs'] })
  })

  it('refuses a plugin patch that is invalid', async () => {
    const { workbench } = harness({
      layers: [ownLayer({ mine: { transport: 'stdio', command: 'node' } })],
      servers: { mine: { transport: 'stdio', command: 'node' } },
    })
    expect(await failureCode(() => workbench.save('mine', { command: null }))).toBe('invalid-config')
  })

  it('refuses to store servers when its own row is missing', async () => {
    const { workbench } = harness({ layers: [], servers: { mine: { transport: 'stdio', command: 'node' } } })
    expect(await failureCode(() => workbench.remove('mine'))).toBe('not-editable')
  })

  it('adds a valid server and refuses the invalid forms', async () => {
    const { workbench, editor, manager, servers } = harness({ layers: [ownLayer()] })
    expect(await failureCode(() => workbench.add({ name: 'two words', spec: {} }))).toBe('invalid-request')
    expect(await failureCode(() => workbench.add({ name: 'bad', spec: { transport: 'stdio' } }))).toBe('invalid-config')

    const view = await workbench.add({ name: 'added', spec: { transport: 'stdio', command: 'node', extra: 1 } })
    expect(view).toMatchObject({ name: 'added', source: 'plugin', enabled: true, endpoint: 'node' })
    expect(servers().added).toEqual({ transport: 'stdio', command: 'node' })
    expect(manager.registered.has('added')).toBe(true)
    expect(editor.edits).toHaveLength(1)
  })

  it('refuses a name another source already uses', async () => {
    const { workbench } = harness({ layers: [clientLayer('mcp-a', 'a', profileRow), ownLayer()] })
    expect(await failureCode(() => workbench.add({ name: 'a', spec: { transport: 'stdio', command: 'node' } }))).toBe(
      'name-conflict',
    )
  })

  it('removes a plugin server and refuses the others', async () => {
    const { workbench, manager, servers } = harness({
      layers: [clientLayer('mcp-a', 'a', profileRow), ownLayer({ mine: { transport: 'stdio', command: 'node' } })],
      servers: { mine: { transport: 'stdio', command: 'node' } },
    })
    workbench.syncRegistrations()
    expect(await failureCode(() => workbench.remove('a'))).toBe('not-editable')
    await workbench.remove('mine')
    expect(servers()).toEqual({})
    expect(manager.registered.has('mine')).toBe(false)
  })

  it('enables and disables a plugin server', async () => {
    const { workbench, manager, servers } = harness({
      layers: [ownLayer({ mine: { transport: 'stdio', command: 'node' } })],
      servers: { mine: { transport: 'stdio', command: 'node' } },
    })
    workbench.syncRegistrations()
    const off = await workbench.setEnabled('mine', false)
    expect(off.enabled).toBe(false)
    expect(servers().mine?.enabled).toBe(false)
    expect(manager.registered.has('mine')).toBe(false)

    const on = await workbench.setEnabled('mine', true)
    expect(on.enabled).toBe(true)
    expect(servers().mine?.enabled).toBeUndefined()
    expect(manager.registered.has('mine')).toBe(true)
  })

  it('switches a profile row through the plugin manager', async () => {
    const pluginManager = fakePluginManager()
    const { workbench } = harness({ pluginManager, layers: [clientLayer('mcp-a', 'a', profileRow)] })
    const off = await workbench.setEnabled('a', false)
    expect(off.enabled).toBe(false)
    expect(off.entryId).toBe('mcp-a')

    const on = await workbench.setEnabled('a', true)
    expect(on.enabled).toBe(true)
    expect(pluginManager.calls).toEqual([
      { id: 'mcp-a', enabled: false },
      { id: 'mcp-a', enabled: true },
    ])
  })

  it('drops the cached probe when a profile row is switched', async () => {
    const { workbench } = harness({
      layers: [
        clientLayer('mcp-a', 'a', {
          serverName: 'a',
          transport: 'stdio',
          command: 'node',
          env: { KEY: '${credential:KEY}' },
        }),
      ],
    })
    const before = await workbench.probe('a')
    expect(before).toMatchObject({ ok: false, error: { stage: 'credential' } })
    await workbench.setEnabled('a', false)
    expect(await workbench.probe('a')).not.toBe(before)
  })

  it('refuses to switch a profile row without a plugin manager', async () => {
    const { workbench } = harness({ layers: [clientLayer('mcp-a', 'a', profileRow)], pluginService: false })
    expect(await failureCode(() => workbench.setEnabled('a', false))).toBe('unsupported')
  })

  it('refuses to switch a server the manager owns', async () => {
    const manager = fakeManager([{ name: 'external', configured: true, status: { state: 'ready' } }])
    const { workbench } = harness({ manager, layers: [clientLayer('mcp-a', 'a', profileRow)] })
    expect(await failureCode(() => workbench.setEnabled('external', false))).toBe('not-editable')
  })
})

describe('restart', () => {
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
    const { workbench } = harness({ managerService: false, layers: [clientLayer('mcp-a', 'a', profileRow)] })
    expect(await failureCode(() => workbench.restart('a'))).toBe('unsupported')
  })
})

describe('lifecycle', () => {
  it('registers the enabled servers and releases them on cleanup', () => {
    const manager = fakeManager()
    const { workbench } = harness({
      manager,
      servers: {
        on: { transport: 'stdio', command: 'node' },
        off: { transport: 'stdio', command: 'node', enabled: false },
      },
    })
    const stop = workbench.start()
    expect([...manager.registered.keys()]).toEqual(['on'])
    stop()
    expect(manager.registered.size).toBe(0)
  })

  it('keeps going when a registration throws', () => {
    const manager = fakeManager()
    manager.register = vi.fn(() => {
      throw new Error('duplicate name')
    })
    const { workbench } = harness({ manager, servers: { boom: { transport: 'stdio', command: 'node' } } })
    expect(() => workbench.syncRegistrations()).not.toThrow()
  })

  it('releases a registration that throws on dispose', () => {
    const manager = fakeManager()
    let calls = 0
    manager.register = () => () => {
      calls += 1
      throw new Error('already gone')
    }
    const { workbench } = harness({ manager, servers: { a: { transport: 'stdio', command: 'node' } } })
    const stop = workbench.start()
    expect(() => stop()).not.toThrow()
    expect(calls).toBe(1)
  })

  it('does nothing without a manager', () => {
    const { workbench } = harness({ managerService: false, servers: { a: { transport: 'stdio', command: 'node' } } })
    expect(() => workbench.syncRegistrations()).not.toThrow()
  })
})

describe('transportOfSpec', () => {
  it('reports the transport, defaulting to http', () => {
    expect(transportOfSpec({ transport: 'stdio' })).toBe('stdio')
    expect(transportOfSpec(undefined)).toBe('streamable-http')
  })
})
