import { describe, expect, it, vi } from 'vitest'
import { ROUTE_PATH, createHandler, registerRoute } from '../src/route.js'
import { WorkbenchFailure } from '../src/failures.js'
import type { Workbench } from '../src/service.js'
import type { DshConnection } from '../src/types/dsh.js'

const URL_BASE = 'http://127.0.0.1:8627/api/mcp-workbench'

const stub = (methods: Record<string, unknown> = {}): Workbench =>
  ({
    list: () => [],
    detail: () => ({ server: { name: 'a' } }),
    probe: async () => ({ ok: true }),
    call: async () => ({ ok: true }),
    save: async () => ({ server: { name: 'a' } }),
    add: async () => ({ name: 'added' }),
    remove: async () => undefined,
    setEnabled: async () => ({ name: 'a' }),
    restart: async () => ({ name: 'a' }),
    ...methods,
  }) as unknown as Workbench

const post = (body: unknown, headers: Record<string, string> = {}): Request =>
  new Request(URL_BASE, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

const envelope = async (response: Response): Promise<Record<string, unknown>> =>
  (await response.json()) as Record<string, unknown>

describe('createHandler', () => {
  it('refuses a request a page on another origin sent', async () => {
    const handler = createHandler(stub())
    const response = await handler(post({ action: 'list' }, { 'sec-fetch-site': 'cross-site' }))
    expect(response.status).toBe(403)
    expect(await envelope(response)).toEqual({
      ok: false,
      error: { code: 'invalid-request', message: 'cross-origin request refused' },
    })
  })

  it('refuses an origin whose host differs', async () => {
    const handler = createHandler(stub())
    const response = await handler(post({ action: 'list' }, { origin: 'http://evil.example' }))
    expect(response.status).toBe(403)
  })

  it('accepts a same-origin request', async () => {
    const handler = createHandler(stub())
    const response = await handler(post({ action: 'list' }, { 'sec-fetch-site': 'same-origin', origin: URL_BASE }))
    expect(response.status).toBe(200)
    expect(await envelope(response)).toEqual({ ok: true, value: { servers: [] } })
  })

  it('refuses a body that is not JSON or not an object', async () => {
    const handler = createHandler(stub())
    expect((await handler(post('not json'))).status).toBe(400)
    expect(await envelope(await handler(post('not json')))).toEqual({
      ok: false,
      error: { code: 'invalid-request', message: 'body must be JSON' },
    })
    expect((await handler(post([1, 2]))).status).toBe(400)
    expect((await handler(post(null))).status).toBe(400)
  })

  it('refuses an action it does not know', async () => {
    const handler = createHandler(stub())
    const response = await handler(post({ action: 'explode' }))
    expect(response.status).toBe(400)
    expect(await envelope(response)).toEqual({
      ok: false,
      error: { code: 'invalid-request', message: 'unknown action "explode"' },
    })
    expect((await handler(post({}))).status).toBe(400)
  })

  it('requires the fields each action needs', async () => {
    const handler = createHandler(stub())
    for (const body of [
      { action: 'detail' },
      { action: 'probe' },
      { action: 'call', name: 'a' },
      { action: 'save', name: 'a' },
      { action: 'add', name: 'a' },
      { action: 'remove' },
      { action: 'setEnabled', name: 'a' },
      { action: 'setEnabled', enabled: true },
      { action: 'restart' },
    ]) {
      expect((await handler(post(body))).status).toBe(400)
    }
  })

  it('passes the parsed fields to the service', async () => {
    const calls: unknown[] = []
    const handler = createHandler(
      stub({
        probe: async (name: string, options: unknown) => {
          calls.push(['probe', name, options])
          return { ok: true }
        },
        call: async (name: string, request: unknown) => {
          calls.push(['call', name, request])
          return { ok: true }
        },
        save: async (name: string, patch: unknown) => {
          calls.push(['save', name, patch])
          return { server: { name } }
        },
        add: async (request: unknown) => {
          calls.push(['add', request])
          return { name: 'added' }
        },
        remove: async (name: string) => {
          calls.push(['remove', name])
        },
        setEnabled: async (name: string, enabled: boolean) => {
          calls.push(['setEnabled', name, enabled])
          return { name }
        },
        restart: async (name: string) => {
          calls.push(['restart', name])
          return { name }
        },
      }),
    )

    await handler(post({ action: 'probe', name: 'a', force: true }))
    await handler(post({ action: 'call', name: 'a', tool: 'echo', arguments: { message: 'hi' } }))
    await handler(post({ action: 'call', name: 'a', tool: 'echo' }))
    await handler(post({ action: 'save', name: 'a', patch: { command: 'node' } }))
    await handler(post({ action: 'add', name: 'b', spec: { transport: 'stdio', command: 'node' } }))
    await handler(post({ action: 'remove', name: 'b' }))
    await handler(post({ action: 'setEnabled', name: 'b', enabled: false }))
    await handler(post({ action: 'restart', name: 'b' }))

    expect(calls).toEqual([
      ['probe', 'a', { force: true }],
      ['call', 'a', { tool: 'echo', arguments: { message: 'hi' } }],
      ['call', 'a', { tool: 'echo', arguments: {} }],
      ['save', 'a', { command: 'node' }],
      ['add', { name: 'b', spec: { transport: 'stdio', command: 'node' } }],
      ['remove', 'b'],
      ['setEnabled', 'b', false],
      ['restart', 'b'],
    ])
  })

  it('reports a removal as the name it removed', async () => {
    const handler = createHandler(stub())
    expect(await envelope(await handler(post({ action: 'remove', name: 'b' })))).toEqual({
      ok: true,
      value: { removed: 'b' },
    })
  })

  it('maps a refusal to its status and code', async () => {
    const cases: [string, number][] = [
      ['unknown-server', 404],
      ['not-editable', 409],
      ['overridden', 409],
      ['name-conflict', 409],
      ['invalid-config', 422],
      ['config-editor-unavailable', 503],
      ['unsupported', 405],
      ['probe-failed', 502],
      ['call-failed', 502],
    ]
    for (const [code, status] of cases) {
      const handler = createHandler(
        stub({
          detail: () => {
            throw new WorkbenchFailure(code, 'refused')
          },
        }),
      )
      const response = await handler(post({ action: 'detail', name: 'a' }))
      expect(response.status).toBe(status)
      expect(await envelope(response)).toEqual({ ok: false, error: { code, message: 'refused' } })
    }
  })

  it('reports an unexpected failure as a request error', async () => {
    const handler = createHandler(
      stub({
        list: () => {
          throw new Error('kaboom')
        },
      }),
    )
    const response = await handler(post({ action: 'list' }))
    expect(response.status).toBe(400)
    expect(await envelope(response)).toEqual({ ok: false, error: { code: 'invalid-request', message: 'kaboom' } })
  })

  it('reports a write the config editor refused as an overridden one', async () => {
    const handler = createHandler(
      stub({
        save: async () => {
          throw new Error('Configuration for "mcp-github" is overridden by a home patch')
        },
      }),
    )
    const response = await handler(post({ action: 'save', name: 'a', patch: {} }))
    expect(response.status).toBe(409)
    expect(await envelope(response)).toMatchObject({ ok: false, error: { code: 'overridden' } })
  })

  it('keeps the answer out of the browser cache', async () => {
    const handler = createHandler(stub())
    const response = await handler(post({ action: 'list' }))
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8')
  })
})

describe('registerRoute', () => {
  it('registers one POST route and returns its disposer', () => {
    const register = vi.fn(() => () => undefined)
    const dispose = registerRoute({ fetch: { register } } as unknown as DshConnection, stub())
    expect(register).toHaveBeenCalledTimes(1)
    const route = register.mock.calls[0]?.[0] as unknown as {
      path: string
      methods: string[]
      requestBody: string
      fetch: unknown
    }
    expect(route.path).toBe(ROUTE_PATH)
    expect(route.methods).toEqual(['POST'])
    expect(route.requestBody).toBe('buffered')
    expect(typeof route.fetch).toBe('function')
    expect(typeof dispose).toBe('function')
  })

  it('returns a disposer even when the connection has none', () => {
    const dispose = registerRoute({ fetch: { register: () => undefined } } as unknown as DshConnection, stub())
    expect(() => dispose()).not.toThrow()
  })
})
