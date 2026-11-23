import { describe, expect, it } from 'vitest'
import { MCP_CLIENT_PLUGIN, findServer, readInventory, specFromRecord } from '../src/inventory.js'
import type { DshConfigLayer } from '../src/types/dsh.js'
import type { ProbeSummary } from '../src/types/index.js'
import { DEFAULT_CONFIG, type WorkbenchConfig } from '../src/config.js'
import { entry, fakeEditor, fakeManager } from './helpers/fakes.js'

const layer = (
  id: string,
  config: Record<string, unknown> | undefined,
  override?: Record<string, unknown>,
  disabled?: boolean,
): DshConfigLayer => ({
  entry: entry({
    id,
    name: MCP_CLIENT_PLUGIN,
    ...(config === undefined ? {} : { config }),
    ...(disabled ? { disabled } : {}),
  }),
  inherited: { from: 'home' },
  ...(override === undefined ? {} : { override }),
})

const config = (servers: WorkbenchConfig['servers'] = {}): WorkbenchConfig => ({ ...DEFAULT_CONFIG, servers })

const source = (options: {
  layers?: DshConfigLayer[]
  servers?: WorkbenchConfig['servers']
  manager?: ReturnType<typeof fakeManager>
  probes?: Record<string, ProbeSummary>
}) => ({
  configEditor: () => (options.layers === undefined ? undefined : fakeEditor(options.layers)),
  mcpManager: () => options.manager,
  config: () => config(options.servers),
  probeSummary: (name: string) => options.probes?.[name],
})

describe('specFromRecord', () => {
  it('reads the connection fields and ignores the rest', () => {
    expect(
      specFromRecord({
        transport: 'stdio',
        command: 'node',
        args: ['server.mjs', 2],
        cwd: '/tmp',
        env: { A: 'b', B: 1 },
        toolCallTimeoutMs: 1000,
        startupTimeoutMs: 0,
        noise: true,
      }),
    ).toEqual({
      transport: 'stdio',
      command: 'node',
      args: ['server.mjs'],
      cwd: '/tmp',
      env: { A: 'b' },
      toolCallTimeoutMs: 1000,
    })
  })

  it('reads an http server', () => {
    expect(specFromRecord({ transport: 'streamable-http', url: 'https://host/mcp', headers: { H: 'v' } })).toEqual({
      transport: 'streamable-http',
      url: 'https://host/mcp',
      headers: { H: 'v' },
    })
  })

  it('refuses a record with no transport', () => {
    expect(specFromRecord({ url: 'https://host/mcp' })).toBeUndefined()
  })
})

describe('readInventory', () => {
  it('reads the profile rows and masks what the profile stores', () => {
    const servers = readInventory(
      source({
        layers: [
          layer(
            'mcp-github',
            {
              serverName: 'github',
              transport: 'stdio',
              command: 'gh.exe',
              args: ['stdio'],
              env: { GITHUB_TOKEN: 'evaluated' },
            },
            {
              serverName: 'github',
              transport: 'stdio',
              command: 'gh.exe',
              args: ['stdio'],
              env: { GITHUB_TOKEN: { __jsExpr: 'process.env.T' } },
            },
          ),
        ],
      }),
    )
    expect(servers).toHaveLength(1)
    const [github] = servers
    expect(github?.name).toBe('github')
    expect(github?.source).toBe('profile')
    expect(github?.view).toMatchObject({
      transport: 'stdio',
      endpoint: 'gh.exe stdio',
      enabled: true,
      editable: true,
      command: 'gh.exe',
      args: ['stdio'],
      env: { GITHUB_TOKEN: { value: null, secret: true, expression: 'process.env.T' } },
      headers: {},
    })
    expect(github?.entry?.options.id).toBe('mcp-github')
    expect(github?.raw).toEqual({
      serverName: 'github',
      transport: 'stdio',
      command: 'gh.exe',
      args: ['stdio'],
      env: { GITHUB_TOKEN: { __jsExpr: 'process.env.T' } },
    })
  })

  it('falls back to the inherited layer and the row id', () => {
    const servers = readInventory(
      source({
        layers: [layer('mcp-context7', { transport: 'streamable-http', url: 'https://mcp.context7.com/mcp' })],
      }),
    )
    expect(servers[0]?.name).toBe('mcp-context7')
    expect(servers[0]?.view.endpoint).toBe('https://mcp.context7.com/mcp')
    expect(servers[0]?.raw).toEqual({ from: 'home' })
  })

  it('reports a disabled row as disabled', () => {
    const servers = readInventory(
      source({
        layers: [layer('mcp-off', { serverName: 'off', transport: 'stdio', command: 'node' }, undefined, true)],
      }),
    )
    expect(servers[0]?.view.enabled).toBe(false)
  })

  it('ignores rows that belong to other plugins', () => {
    const other: DshConfigLayer = {
      entry: entry({ id: 'something-else', name: '@deepseek-ai/dsh-tools' }),
      inherited: {},
    }
    expect(readInventory(source({ layers: [other] }))).toEqual([])
  })

  it('reads the servers this bundle stores and their live state', () => {
    const manager = fakeManager([{ name: 'mine', configured: false, status: { state: 'ready' } }])
    const servers = readInventory(
      source({
        servers: {
          mine: { transport: 'stdio', command: 'node' },
          off: { transport: 'stdio', command: 'node', enabled: false },
        },
        manager,
      }),
    )
    expect(servers.map((server) => [server.name, server.source, server.view.live, server.view.enabled])).toEqual([
      ['mine', 'plugin', 'ready', true],
      ['off', 'plugin', undefined, false],
    ])
  })

  it('reads a manager-governed server as read-only', () => {
    const manager = fakeManager([
      {
        name: 'external',
        configured: true,
        status: { state: 'ready', transport: 'streamable-http', url: 'https://x/mcp' },
      },
      { name: 'resting', configured: true, status: { state: 'disabled' } },
    ])
    const servers = readInventory(source({ manager }))
    expect(servers[0]?.view).toMatchObject({
      source: 'manager',
      transport: 'streamable-http',
      url: 'https://x/mcp',
      editable: false,
      readOnlyReason: 'manager',
      live: 'ready',
      enabled: true,
    })
    expect(servers[1]?.view).toMatchObject({ source: 'manager', enabled: false, live: 'disabled', editable: false })
  })

  it('keeps the profile and plugin rows ahead of the manager', () => {
    const manager = fakeManager([{ name: 'dup', configured: true, status: { state: 'ready' } }])
    const servers = readInventory(
      source({
        layers: [layer('mcp-dup', { serverName: 'dup', transport: 'stdio', command: 'node' })],
        servers: { dup: { transport: 'stdio', command: 'node' } },
        manager,
      }),
    )
    expect(servers.map((server) => server.source)).toEqual(['profile'])
  })

  it('carries the last probe summary into the view', () => {
    const probe: ProbeSummary = { ok: true, toolCount: 3, probedAt: 'now', durationMs: 5 }
    const servers = readInventory(
      source({
        layers: [layer('mcp-github', { serverName: 'github', transport: 'stdio', command: 'node' })],
        probes: { github: probe },
      }),
    )
    expect(servers[0]?.view.probe).toEqual(probe)
  })

  it('reads only what is available when a service is missing', () => {
    expect(readInventory(source({ layers: [] }))).toEqual([])
    expect(findServer(source({ layers: [] }), 'nothing')).toBeUndefined()
  })

  it('finds a server by name', () => {
    const layers = [layer('mcp-a', { serverName: 'a', transport: 'stdio', command: 'node' })]
    expect(findServer(source({ layers }), 'a')?.name).toBe('a')
  })
})
