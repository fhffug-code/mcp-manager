import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, ROUTE_PATH, createApi } from '../src/client/api.js'

const answer = (body: unknown, status = 200): Response =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

/** One fresh response per request: a Response body can only be read once. */
const stubFetch = (make: () => Response): ReturnType<typeof vi.fn> => {
  const fetch = vi.fn(async () => make())
  vi.stubGlobal('fetch', fetch)
  return fetch
}

const sentBody = (fetch: ReturnType<typeof vi.fn>, index = 0): Record<string, unknown> => {
  const call = fetch.mock.calls[index] as unknown as [string, { body: string }]
  return JSON.parse(call[1].body) as Record<string, unknown>
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createApi', () => {
  it('posts to the one route with the fields the action needs', async () => {
    const fetch = stubFetch(() => answer({ ok: true, value: { servers: [{ name: 'a' }] } }))
    const api = createApi()
    expect(await api.list()).toEqual([{ name: 'a' }])
    expect(fetch).toHaveBeenCalledWith(ROUTE_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'list' }),
      credentials: 'same-origin',
    })
  })

  it('sends the body every operation expects', async () => {
    const fetch = stubFetch(() => answer({ ok: true, value: {} }))
    const api = createApi()

    await api.detail('a')
    await api.probe('a')
    await api.probe('a', true)
    await api.call('a', 'echo', { message: 'hi' })
    await api.save('a', { command: 'node' })
    await api.add('b', { transport: 'stdio' })
    await api.remove('b')
    await api.setEnabled('b', false)
    await api.restart('b')

    expect([0, 1, 2, 3, 4, 5, 6, 7, 8].map((index) => sentBody(fetch, index))).toEqual([
      { action: 'detail', name: 'a' },
      { action: 'probe', name: 'a', force: false },
      { action: 'probe', name: 'a', force: true },
      { action: 'call', name: 'a', tool: 'echo', arguments: { message: 'hi' } },
      { action: 'save', name: 'a', patch: { command: 'node' } },
      { action: 'add', name: 'b', spec: { transport: 'stdio' } },
      { action: 'remove', name: 'b' },
      { action: 'setEnabled', name: 'b', enabled: false },
      { action: 'restart', name: 'b' },
    ])
  })

  it('unwraps the value of a list and of a detail', async () => {
    stubFetch(() => answer({ ok: true, value: { server: { name: 'a' }, probe: { ok: true } } }))
    expect(await createApi().detail('a')).toEqual({ server: { name: 'a' }, probe: { ok: true } })
  })

  it('resolves a removal without a value', async () => {
    stubFetch(() => answer({ ok: true, value: { removed: 'b' } }))
    await expect(createApi().remove('b')).resolves.toBeUndefined()
  })

  it('reports the refusal the Host sent', async () => {
    stubFetch(() => answer({ ok: false, error: { code: 'unknown-server', message: 'no MCP server named "x"' } }, 404))
    await expect(createApi().detail('x')).rejects.toThrow(ApiError)
    await expect(createApi().detail('x')).rejects.toMatchObject({
      code: 'unknown-server',
      message: 'no MCP server named "x"',
    })
  })

  it('reports an answer that is not a JSON envelope', async () => {
    stubFetch(() => new Response('<html>not found</html>', { status: 404 }))
    await expect(createApi().list()).rejects.toMatchObject({
      code: 'transport',
      message: 'the Harness answered 404 without a JSON body',
    })
  })
})
