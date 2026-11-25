import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/index.js'
import { MCP_MANAGER_PLUGIN } from '../src/inventory.js'
import { ROUTE_PATH } from '../src/route.js'
import { TOOL_NAME } from '../src/tool.js'
import type { DshConfigLayer, DshConnection, DshFetchRoute } from '../src/types/dsh.js'
import { entry, fakeContext, fakeEditor } from './helpers/fakes.js'

const connection = (register: (route: DshFetchRoute) => unknown): DshConnection =>
  ({ fetch: { register } }) as unknown as DshConnection

/** A registry that records the definition it was handed. */
const toolRegistry = () => vi.fn((_definition: unknown) => () => undefined)

describe('apply', () => {
  it('mounts the registrations, the route and the tool', () => {
    const register = vi.fn((_route: DshFetchRoute) => () => undefined)
    const tools = toolRegistry()
    const ctx = fakeContext({ tools: { register: tools }, connection: connection(register) })

    apply(ctx)

    expect(ctx.effects).toEqual(['mcp-workbench/registrations', 'mcp-workbench/route', 'mcp-workbench/tool'])
    expect((register.mock.calls[0]?.[0] as unknown as { path: string }).path).toBe(ROUTE_PATH)
    expect((tools.mock.calls[0]?.[0] as unknown as { name: string }).name).toBe(TOOL_NAME)
  })

  it('says what it ignores in the config it was given', () => {
    const ctx = fakeContext({ connection: connection(() => () => undefined) })

    apply(ctx, { servers: { broken: { transport: 'stdio' } } })

    expect(ctx.logger.warn).toHaveBeenCalledWith(
      "mcp-workbench: config.servers is ignored; servers live in the profile's @deepseek-ai/dsh-mcp-manager row",
    )
  })

  it('stores a server it adds on the manager row the route serves', async () => {
    const register = vi.fn((_route: DshFetchRoute) => () => undefined)
    const layers: DshConfigLayer[] = [
      { entry: entry({ id: 'mcp-manager', name: MCP_MANAGER_PLUGIN, config: { servers: {} } }), inherited: {} },
    ]
    const ctx = fakeContext({ editor: fakeEditor(layers), connection: connection(register) })
    apply(ctx)

    const route = register.mock.calls[0]?.[0] as unknown as { fetch(request: Request): Promise<Response> }
    const post = (body: unknown): Request =>
      new Request('http://127.0.0.1:8627/api/mcp-workbench', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
        body: JSON.stringify(body),
      })

    const added = await route.fetch(
      post({ action: 'add', name: 'fresh', spec: { transport: 'stdio', command: 'node' } }),
    )
    expect(added.status).toBe(200)
    expect(layers[0]?.entry.options.config).toEqual({
      servers: { fresh: { transport: 'stdio', command: 'node' } },
    })

    const listed = (await (await route.fetch(post({ action: 'list' }))).json()) as {
      ok: boolean
      value: { servers: { name: string }[] }
    }
    expect(listed.value.servers.map((server) => server.name)).toEqual(['fresh'])
  })

  it('says so when the profile has no connection service', () => {
    const ctx = fakeContext()
    apply(ctx)
    expect(ctx.logger.warn).toHaveBeenCalledWith(
      'mcp-workbench: the connection service is not available; the settings page cannot reach the Host',
    )
    expect(ctx.effects).toEqual(['mcp-workbench/registrations'])
  })

  it('accepts a config that is not an object', () => {
    const ctx = fakeContext()
    apply(ctx, 'nonsense')
    expect(ctx.logger.warn).toHaveBeenCalledWith('mcp-workbench: config must be an object')
  })
})
