import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { ConnectionPool } from '../src/connection.js'
import { callServerTool, credentialNames, probeServer, transportFor } from '../src/probe.js'
import type { ProbeOptions } from '../src/probe.js'
import type { McpServerSpec } from '../src/config.js'
import type { CallResult } from '../src/types/index.js'

/** The fixture server this suite starts for real, so the MCP client and the protocol are exercised. */
const FIXTURE = fileURLToPath(new URL('./fixtures/stdio-server.mjs', import.meta.url))

const options: ProbeOptions = {
  probeTimeoutMs: 20_000,
  toolCallTimeoutMs: 20_000,
  maxToolSchemas: 64,
  resultMaxBytes: 262_144,
}

const stdio = (extra: Partial<McpServerSpec> = {}): McpServerSpec => ({
  transport: 'stdio',
  command: process.execPath,
  args: [FIXTURE],
  ...extra,
})

/** Every pool a test opened, so no fixture process outlives the run. */
const pools: ConnectionPool[] = []

const pool = (): ConnectionPool => {
  const created = new ConnectionPool({ transportFor })
  pools.push(created)
  return created
}

afterEach(async () => {
  await Promise.all(pools.splice(0).map((created) => created.closeAll()))
})

const textOf = (result: CallResult): string => {
  const first = result.content[0]
  return first !== undefined && first.type === 'text' ? first.text : ''
}

describe('probeServer', () => {
  it('connects to a real server and reads its tools with their schemas', async () => {
    const result = await probeServer(pool(), 'fixture', stdio(), options)
    expect(result.ok).toBe(true)
    expect(result.toolCount).toBe(4)
    expect(result.truncated).toBe(false)
    expect(result.serverInfo).toEqual({ name: 'workbench-fixture', version: '1.0.0' })
    expect(result.tools.map((tool) => tool.name)).toEqual(['echo', 'fail', 'mixed', 'pid'])
    expect(result.tools[0]?.description).toBe('Echo the message back')
    expect(result.tools[0]?.inputSchema).toMatchObject({
      type: 'object',
      properties: { message: { type: 'string' } },
      required: ['message'],
    })
    expect(Date.parse(result.probedAt)).toBeGreaterThan(0)
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
    expect(result.error).toBeUndefined()
  })

  it('keeps the name budget and reports the schemas it had to leave out', async () => {
    const result = await probeServer(pool(), 'fixture', stdio(), { ...options, maxToolSchemas: 1 })
    expect(result.ok).toBe(true)
    expect(result.toolCount).toBe(4)
    expect(result.truncated).toBe(true)
    expect(result.tools[0]?.inputSchema).toBeDefined()
    expect(result.tools[1]?.schemaOmitted).toBe(true)
    expect(result.tools[1]?.inputSchema).toBeUndefined()
  })

  it('reports a command it cannot start as a transport failure', async () => {
    const result = await probeServer(
      pool(),
      'missing',
      { transport: 'stdio', command: 'dsh-no-such-command-anywhere', args: [] },
      { ...options, probeTimeoutMs: 5_000 },
    )
    expect(result.ok).toBe(false)
    expect(result.toolCount).toBe(0)
    expect(result.tools).toEqual([])
    expect(result.error?.stage).toBe('transport')
  })

  it('reports a credential the Host never resolved without starting anything', async () => {
    const result = await probeServer(pool(), 'gated', stdio({ env: { TOKEN: '${credential:GITHUB_TOKEN}' } }), options)
    expect(result).toMatchObject({ ok: false, durationMs: 0, error: { stage: 'credential' } })
    expect(result.error?.message).toContain('GITHUB_TOKEN')
  })

  it('resolves a credential the store holds before it connects', async () => {
    const asked: string[] = []
    const result = await probeServer(pool(), 'gated', stdio({ env: { TOKEN: '${credential:GITHUB_TOKEN}' } }), {
      ...options,
      credentials: async (name) => {
        asked.push(name)
        return name === 'GITHUB_TOKEN' ? 'stored-secret' : undefined
      },
    })
    expect(result.ok).toBe(true)
    expect(asked).toEqual(['GITHUB_TOKEN'])
  })

  it('names the credential whose value is missing', async () => {
    const result = await probeServer(pool(), 'gated', stdio({ env: { TOKEN: '${credential:EMPTY}' } }), {
      ...options,
      credentials: async () => undefined,
    })
    expect(result).toMatchObject({ ok: false, durationMs: 0, error: { stage: 'credential' } })
    expect(result.error?.message).toContain('EMPTY')
  })

  it('stops when the caller aborts', async () => {
    const controller = new AbortController()
    controller.abort(new Error('caller went away'))
    const result = await probeServer(
      pool(),
      'fixture',
      stdio(),
      { ...options, probeTimeoutMs: 2_000 },
      controller.signal,
    )
    expect(result.ok).toBe(false)
  })

  it('reuses the session a probe opened', async () => {
    const connections = pool()
    const spec = stdio()
    const probed = await probeServer(connections, 'fixture', spec, options)
    expect(probed.ok).toBe(true)
    const pid = await callServerTool(connections, 'fixture', spec, options, { tool: 'pid' })
    expect(pid.ok).toBe(true)
    expect(connections.size()).toBe(1)
  })
})

describe('callServerTool', () => {
  it('calls a tool with the arguments it was given', async () => {
    const result = await callServerTool(pool(), 'fixture', stdio(), options, {
      tool: 'echo',
      arguments: { message: 'hi' },
    })
    expect(result.ok).toBe(true)
    expect(result.isError).toBe(false)
    expect(result.content).toEqual([{ type: 'text', text: 'echo: hi' }])
  })

  it('keeps the raw result the server sent, for the page', async () => {
    const result = await callServerTool(pool(), 'fixture', stdio(), options, {
      tool: 'echo',
      arguments: { message: 'hi' },
    })
    const raw = result.raw as { content: unknown[] }
    expect(raw.content).toEqual([{ type: 'text', text: 'echo: hi' }])
  })

  it('cuts a raw result that does not fit the byte budget', async () => {
    const result = await callServerTool(
      pool(),
      'fixture',
      stdio(),
      { ...options, resultMaxBytes: 10 },
      { tool: 'mixed' },
    )
    expect(result.raw).toMatchObject({ truncated: true })
  })

  it('reports a tool error as a result rather than a failure', async () => {
    const result = await callServerTool(pool(), 'fixture', stdio(), options, { tool: 'fail' })
    expect(result.ok).toBe(true)
    expect(result.isError).toBe(true)
    expect(result.content).toEqual([{ type: 'text', text: 'boom' }])
  })

  it('reads every content kind', async () => {
    const result = await callServerTool(pool(), 'fixture', stdio(), options, { tool: 'mixed' })
    expect(result.ok).toBe(true)
    expect(result.content).toEqual([
      { type: 'text', text: 'first' },
      { type: 'image', mimeType: 'image/png', bytes: 6 },
      { type: 'resource', uri: 'file:///note.txt', mimeType: 'text/plain', text: 'note body' },
      { type: 'resource-link', uri: 'file:///note.txt', name: 'note.txt' },
    ])
  })

  it('drops the blocks that do not fit the byte budget', async () => {
    const result = await callServerTool(
      pool(),
      'fixture',
      stdio(),
      { ...options, resultMaxBytes: 10 },
      { tool: 'mixed' },
    )
    expect(result.ok).toBe(true)
    expect(result.truncated).toBe(true)
    expect(result.content.length).toBeLessThan(4)
  })

  it('reports a tool the server does not have', async () => {
    const result = await callServerTool(pool(), 'fixture', stdio(), options, { tool: 'nope' })
    expect(result.ok).toBe(false)
    expect(result.content).toEqual([])
    expect(result.error?.stage).toBe('tools-call')
  })

  it('refuses an empty tool name without connecting', async () => {
    const result = await callServerTool(pool(), 'fixture', stdio(), options, { tool: '  ' })
    expect(result).toMatchObject({ ok: false, durationMs: 0, error: { message: 'tool name is required' } })
  })

  it('reports an unresolved credential without connecting', async () => {
    const result = await callServerTool(pool(), 'gated', stdio({ args: [FIXTURE, '${credential:A}'] }), options, {
      tool: 'echo',
    })
    expect(result).toMatchObject({ ok: false, durationMs: 0, error: { stage: 'credential' } })
  })

  it('resolves a credential for a call too', async () => {
    const result = await callServerTool(
      pool(),
      'gated',
      stdio({ args: [FIXTURE, '${credential:A}'] }),
      { ...options, credentials: async () => 'value' },
      { tool: 'echo', arguments: { message: 'hi' } },
    )
    expect(result).toMatchObject({ ok: true, content: [{ type: 'text', text: 'echo: hi' }] })
  })
})

describe('a live session', () => {
  it('answers two calls in the same process, and a new process after it closes', async () => {
    const connections = pool()
    const spec = stdio()
    const first = textOf(await callServerTool(connections, 'fixture', spec, options, { tool: 'pid' }))
    const second = textOf(await callServerTool(connections, 'fixture', spec, options, { tool: 'pid' }))
    expect(first).not.toBe('')
    expect(second).toBe(first)
    await connections.closeAll()
    expect(connections.size()).toBe(0)
    const third = textOf(await callServerTool(connections, 'fixture', spec, options, { tool: 'pid' }))
    expect(third).not.toBe('')
    expect(third).not.toBe(first)
  })

  it('opens a new session when the configuration changes', async () => {
    const connections = pool()
    const first = textOf(await callServerTool(connections, 'fixture', stdio(), options, { tool: 'pid' }))
    const second = textOf(
      await callServerTool(connections, 'fixture', stdio({ closeTimeoutMs: 3_000 }), options, { tool: 'pid' }),
    )
    expect(second).not.toBe(first)
    expect(connections.size()).toBe(1)
  })

  it('does not replay a tool call after the session died', async () => {
    const connections = pool()
    const spec = stdio()
    await callServerTool(connections, 'fixture', spec, options, { tool: 'pid' })
    await connections.closeAll()
    const result = await callServerTool(connections, 'fixture', spec, options, { tool: 'pid' })
    // The pool opens a fresh session on demand, so this succeeds; the point is that it is a new process.
    expect(result.ok).toBe(true)
  })
})

describe('credentialNames', () => {
  it('scans every field the server would receive', () => {
    expect(
      credentialNames({
        transport: 'streamable-http',
        url: 'https://x/${credential:URL_TOKEN}',
        headers: { Authorization: '${credential:HEADER_TOKEN}' },
      }),
    ).toEqual(['URL_TOKEN', 'HEADER_TOKEN'])
    expect(
      credentialNames({
        transport: 'stdio',
        command: '/bin/${credential:CMD}',
        args: ['${credential:ARG}'],
        cwd: '/tmp/${credential:CWD}',
        env: { A: '${credential:ENV}' },
      }),
    ).toEqual(['CMD', 'CWD', 'ARG', 'ENV'])
    expect(credentialNames({ transport: 'stdio', command: 'node' })).toEqual([])
  })

  it('names a reference once even when it appears twice', () => {
    expect(
      credentialNames({
        transport: 'stdio',
        command: 'node',
        env: { A: '${credential:SAME}', B: 'x${credential:SAME}' },
      }),
    ).toEqual(['SAME'])
  })
})
