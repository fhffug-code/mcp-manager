import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/index.js'
import { ROUTE_PATH } from '../src/route.js'
import { TOOL_NAME } from '../src/tool.js'
import { PLUGIN_NAME } from '../src/version.js'
import type { DshConnection } from '../src/types/dsh.js'
import { entry, fakeContext, fakeEditor, fakeManager } from './helpers/fakes.js'

const connection = (register: ReturnType<typeof vi.fn>): DshConnection =>
  ({ fetch: { register } }) as unknown as DshConnection

describe('apply', () => {
  it('mounts the registrations, the route and the tool', () => {
    const register = vi.fn(() => () => undefined)
    const tools = vi.fn(() => () => undefined)
    const manager = fakeManager()
    const editor = fakeEditor([
      { entry: entry({ id: 'mcp-workbench', name: PLUGIN_NAME, config: { servers: {} } }), inherited: {} },
    ])
    const ctx = fakeContext({ editor, manager, tools: { register: tools }, connection: connection(register) })

    apply(ctx, { servers: { live: { transport: 'stdio', command: 'node' } } })

    expect(ctx.effects).toEqual(['mcp-workbench/registrations', 'mcp-workbench/route', 'mcp-workbench/tool'])
    expect([...manager.registered.keys()]).toEqual(['live'])
    expect((register.mock.calls[0]?.[0] as unknown as { path: string }).path).toBe(ROUTE_PATH)
    expect((tools.mock.calls[0]?.[0] as unknown as { name: string }).name).toBe(TOOL_NAME)
  })

  it('reports the config it had to drop and keeps the rest', () => {
    const manager = fakeManager()
    const ctx = fakeContext({ manager, connection: connection(vi.fn(() => () => undefined)) })

    apply(ctx, { servers: { broken: { transport: 'stdio' } } })

    expect(ctx.logger.warn).toHaveBeenCalledWith('mcp-workbench: server "broken" is invalid: command is required')
    expect(manager.registered.size).toBe(0)
  })

  it('keeps the servers it stores in step with the route', async () => {
    const register = vi.fn(() => () => undefined)
    const manager = fakeManager()
    const editor = fakeEditor([
      { entry: entry({ id: 'mcp-workbench', name: PLUGIN_NAME, config: { servers: {} } }), inherited: {} },
    ])
    const ctx = fakeContext({ editor, manager, connection: connection(register) })
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
    expect(manager.registered.has('fresh')).toBe(true)

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
