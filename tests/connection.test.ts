import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { ConnectionPool, DEFAULT_CLOSE_TIMEOUT_MS, looksDisconnected } from '../src/connection.js'
import { transportFor } from '../src/probe.js'
import type { McpServerSpec } from '../src/config.js'

const FIXTURE = fileURLToPath(new URL('./fixtures/stdio-server.mjs', import.meta.url))

const stdio = (extra: Partial<McpServerSpec> = {}): McpServerSpec => ({
  transport: 'stdio',
  command: process.execPath,
  args: [FIXTURE],
  ...extra,
})

const settings = { connectTimeoutMs: 20_000 }

const pools: ConnectionPool[] = []

const pool = (): ConnectionPool => {
  const created = new ConnectionPool({ transportFor })
  pools.push(created)
  return created
}

afterEach(async () => {
  await Promise.all(pools.splice(0).map((created) => created.closeAll()))
})

/** Ask the fixture for its process id, which is how a session is told apart from a fresh one. */
const pidOf = (pooled: ConnectionPool, name = 'fixture', spec = stdio()): Promise<string> =>
  pooled.use(name, spec, settings, undefined, async (client) => {
    const result = await client.callTool({ name: 'pid' })
    const content = result.content as { type: string; text?: string }[]
    return content[0]?.text ?? ''
  })

describe('ConnectionPool', () => {
  it('opens a session on the first use and hands the same one back', async () => {
    const connections = pool()
    expect(connections.has('fixture')).toBe(false)
    const first = await pidOf(connections)
    expect(connections.size()).toBe(1)
    expect(connections.has('fixture')).toBe(true)
    const second = await pidOf(connections)
    expect(second).toBe(first)
    expect(connections.size()).toBe(1)
  })

  it('opens one session when two uses race', async () => {
    const connections = pool()
    const [first, second] = await Promise.all([pidOf(connections), pidOf(connections)])
    expect(connections.size()).toBe(1)
    expect(second).toBe(first)
  })

  it('opens a new session when the specification changes', async () => {
    const connections = pool()
    const first = await pidOf(connections)
    const second = await pidOf(connections, 'fixture', stdio({ closeTimeoutMs: 3_000 }))
    expect(second).not.toBe(first)
    expect(connections.size()).toBe(1)
  })

  it('closes one session and forgets it', async () => {
    const connections = pool()
    const first = await pidOf(connections)
    await connections.close('fixture')
    expect(connections.size()).toBe(0)
    expect(connections.has('fixture')).toBe(false)
    const second = await pidOf(connections)
    expect(second).not.toBe(first)
  })

  it('closes every session', async () => {
    const connections = pool()
    await pidOf(connections, 'a')
    await pidOf(connections, 'b')
    expect(connections.size()).toBe(2)
    await connections.closeAll()
    expect(connections.size()).toBe(0)
  })

  it('keeps the session when the work itself fails', async () => {
    const connections = pool()
    await pidOf(connections)
    await expect(
      connections.use('fixture', stdio(), settings, undefined, async () => {
        throw new Error('the tool refused')
      }),
    ).rejects.toThrow('the tool refused')
    expect(connections.size()).toBe(1)
  })

  it('replaces a session that died while it was used', async () => {
    const connections = pool()
    let attempt = 0
    const answer = await connections.use(
      'fixture',
      stdio(),
      settings,
      undefined,
      async () => {
        attempt += 1
        if (attempt === 1) {
          // The first attempt loses its session, exactly like a dropped HTTP session.
          await connections.close('fixture')
          throw new Error('connection closed')
        }
        return 'second try'
      },
      { retryOnDisconnect: true },
    )
    expect(answer).toBe('second try')
    expect(attempt).toBe(2)
  })

  it('reports a dead session instead of replaying it when the work is not safe to repeat', async () => {
    const connections = pool()
    await pidOf(connections)
    await expect(
      connections.use(
        'fixture',
        stdio(),
        settings,
        undefined,
        async () => {
          await connections.close('fixture')
          throw new Error('session not found')
        },
        { retryOnDisconnect: false },
      ),
    ).rejects.toThrow('session not found')
    expect(connections.size()).toBe(0)
  })

  it('stops before it starts when the caller already aborted', async () => {
    const connections = pool()
    const controller = new AbortController()
    controller.abort(new Error('gone'))
    await expect(
      connections.use('fixture', stdio(), settings, controller.signal, async () => 'never'),
    ).rejects.toThrow()
    expect(connections.size()).toBe(0)
  })

  it('reports a command it cannot start', async () => {
    const connections = pool()
    await expect(
      connections.use(
        'missing',
        { transport: 'stdio', command: 'dsh-no-such-command-anywhere' },
        settings,
        undefined,
        async () => 'never',
      ),
    ).rejects.toThrow()
    expect(connections.size()).toBe(0)
  })

  it('keeps a close budget shorter than the default, and never below zero', () => {
    expect(DEFAULT_CLOSE_TIMEOUT_MS).toBe(5_000)
    expect(looksDisconnected(new Error('connection closed'))).toBe(true)
    expect(looksDisconnected(new Error('session not found'))).toBe(true)
    expect(looksDisconnected(new Error('fetch failed'))).toBe(true)
    expect(looksDisconnected(new Error('ECONNRESET'))).toBe(true)
    expect(looksDisconnected(new Error('the tool refused'))).toBe(false)
    expect(looksDisconnected(undefined)).toBe(false)
    expect(looksDisconnected('transport closed')).toBe(true)
  })
})
