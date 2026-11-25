import { describe, expect, it, vi } from 'vitest'
import { TOOL_NAME, definition, registerTool } from '../src/tool.js'
import { WorkbenchFailure } from '../src/failures.js'
import type { Workbench } from '../src/service.js'
import { fakeContext } from './helpers/fakes.js'

interface ToolUnderTest {
  execute(args: Record<string, unknown>): Promise<string>
}

const toolFor = (methods: Record<string, unknown> = {}): ToolUnderTest =>
  definition({ list: () => [], ...methods } as unknown as Workbench) as unknown as ToolUnderTest

describe('definition', () => {
  it('declares the tool the page and the model share', () => {
    const tool = definition({ list: () => [] } as unknown as Workbench) as unknown as {
      name: string
      description: string
      parameters: Record<string, { type: string; required?: boolean }>
      output: { schema: { type: string } }
    }
    expect(tool.name).toBe(TOOL_NAME)
    expect(tool.description).toContain('The MCP page in the sidebar')
    expect(tool.parameters['action']).toMatchObject({ type: 'string', required: true })
    expect(tool.parameters['confirm']).toMatchObject({ type: 'boolean' })
    expect(tool.output.schema).toEqual({ type: 'string' })
  })
})

describe('the confirm gate', () => {
  const mutations = ['save', 'add', 'remove', 'setEnabled', 'restart']

  it('refuses every change without confirm=true and changes nothing', async () => {
    const workbench = {
      list: () => [],
      save: vi.fn(),
      add: vi.fn(),
      remove: vi.fn(),
      setEnabled: vi.fn(),
      restart: vi.fn(),
    }
    const tool = toolFor(workbench)
    for (const action of mutations) {
      const answer = await tool.execute({ action, name: 'a', patch: {}, spec: {}, enabled: true })
      expect(answer).toBe(`Refusing ${action}: pass confirm=true to change the profile. Nothing was changed.`)
    }
    expect(workbench.save).not.toHaveBeenCalled()
    expect(workbench.add).not.toHaveBeenCalled()
    expect(workbench.remove).not.toHaveBeenCalled()
    expect(workbench.setEnabled).not.toHaveBeenCalled()
    expect(workbench.restart).not.toHaveBeenCalled()
  })

  it('lets a confirmed change through', async () => {
    const remove = vi.fn(async () => undefined)
    const answer = await toolFor({ list: () => [], remove }).execute({ action: 'remove', name: 'a', confirm: true })
    expect(remove).toHaveBeenCalledWith('a')
    expect(answer).toBe('Removed a.')
  })
})

describe('list', () => {
  it('says so when nothing is mounted', async () => {
    expect(await toolFor().execute({ action: 'list' })).toBe(
      'No MCP servers are mounted in this profile.\n\nUse action=detail with a name for its configuration and last probe.',
    )
  })

  it('prints one line per server with its probe headline', async () => {
    const answer = await toolFor({
      list: () => [
        {
          name: 'github',
          source: 'profile',
          transport: 'stdio',
          enabled: true,
          endpoint: 'gh.exe stdio',
          probe: { ok: true, toolCount: 4 },
        },
        { name: 'off', source: 'plugin', transport: 'streamable-http', enabled: false, endpoint: 'https://x/mcp' },
        {
          name: 'broken',
          source: 'manager',
          transport: 'stdio',
          enabled: true,
          endpoint: 'node',
          probe: { ok: false, toolCount: 0 },
        },
      ],
    }).execute({ action: 'list' })
    expect(answer).toBe(
      [
        '- github [profile, stdio, enabled] gh.exe stdio — 4 tools',
        '- off [plugin, streamable-http, disabled] https://x/mcp — not probed',
        '- broken [manager, stdio, enabled] node — probe failed',
        '',
        'Use action=detail with a name for its configuration and last probe.',
      ].join('\n'),
    )
  })
})

describe('the actions that need arguments', () => {
  it('asks for the fields each action needs', async () => {
    const tool = toolFor()
    expect(await tool.execute({ action: 'detail' })).toBe('name is required for detail')
    expect(await tool.execute({ action: 'probe' })).toBe('name is required for probe')
    expect(await tool.execute({ action: 'call', name: 'a' })).toBe('name and tool are required for call')
    expect(await tool.execute({ action: 'call', tool: 'echo' })).toBe('name and tool are required for call')
    expect(await tool.execute({ action: 'save', name: 'a', confirm: true })).toBe(
      'name and patch are required for save',
    )
    expect(await tool.execute({ action: 'add', name: 'a', confirm: true })).toBe('name and spec are required for add')
    expect(await tool.execute({ action: 'remove', confirm: true })).toBe('name is required for remove')
    expect(await tool.execute({ action: 'setEnabled', name: 'a', confirm: true })).toBe(
      'name and enabled are required for setEnabled',
    )
    expect(await tool.execute({ action: 'restart', confirm: true })).toBe('name is required for restart')
  })

  it('names the actions it knows', async () => {
    expect(await toolFor().execute({ action: 'explode' })).toBe(
      'Unknown action "explode". Use one of: list, detail, probe, call, save, add, remove, setEnabled, restart.',
    )
    expect(await toolFor().execute({})).toBe(
      'Unknown action "". Use one of: list, detail, probe, call, save, add, remove, setEnabled, restart.',
    )
  })
})

describe('the actions that report a result', () => {
  it('summarizes a detail, a probe, a call and a change', async () => {
    const tool = toolFor({
      detail: (name: string) => ({ server: { name } }),
      probe: async (name: string, options: { force: boolean }) => ({ name, options }),
      call: async (name: string, request: unknown) => ({ name, request }),
      save: async (name: string, patch: unknown) => ({ name, patch }),
      add: async (request: unknown) => ({ request }),
      setEnabled: async (name: string, enabled: boolean) => ({ name, enabled }),
      restart: async (name: string) => ({ name }),
    })

    expect(await tool.execute({ action: 'detail', name: 'a' })).toBe(
      JSON.stringify({ server: { name: 'a' } }, undefined, 2),
    )
    expect(JSON.parse(await tool.execute({ action: 'probe', name: 'a', force: true }))).toEqual({
      name: 'a',
      options: { force: true },
    })
    expect(
      JSON.parse(await tool.execute({ action: 'call', name: 'a', tool: 'echo', arguments: { m: 1 }, confirm: true })),
    ).toEqual({ name: 'a', request: { tool: 'echo', arguments: { m: 1 } } })
    expect(JSON.parse(await tool.execute({ action: 'call', name: 'a', tool: 'echo', confirm: true }))).toEqual({
      name: 'a',
      request: { tool: 'echo', arguments: {} },
    })
    expect(
      JSON.parse(await tool.execute({ action: 'save', name: 'a', patch: { command: 'node' }, confirm: true })),
    ).toEqual({ name: 'a', patch: { command: 'node' } })
    expect(
      JSON.parse(await tool.execute({ action: 'add', name: 'b', spec: { transport: 'stdio' }, confirm: true })),
    ).toEqual({ request: { name: 'b', spec: { transport: 'stdio' } } })
    expect(JSON.parse(await tool.execute({ action: 'setEnabled', name: 'b', enabled: false, confirm: true }))).toEqual({
      name: 'b',
      enabled: false,
    })
    expect(JSON.parse(await tool.execute({ action: 'restart', name: 'b', confirm: true }))).toEqual({ name: 'b' })
  })

  it('reports a refusal with its code', async () => {
    const tool = toolFor({
      detail: () => {
        throw new WorkbenchFailure('unknown-server', 'no MCP server named "a"')
      },
      probe: async () => {
        throw new Error('the socket closed')
      },
    })
    expect(await tool.execute({ action: 'detail', name: 'a' })).toBe('unknown-server: no MCP server named "a"')
    expect(await tool.execute({ action: 'probe', name: 'a' })).toBe('invalid-request: the socket closed')
  })

  it('keeps a long answer bounded', async () => {
    const answer = await toolFor({ detail: () => ({ blob: 'x'.repeat(9_000) }) }).execute({
      action: 'detail',
      name: 'a',
    })
    expect(answer.length).toBeLessThan(8_100)
    expect(answer.endsWith('… truncated; open the MCP page in the sidebar for the rest.')).toBe(true)
  })
})

describe('registerTool', () => {
  it('registers the definition inside an effect', () => {
    const register = vi.fn((_definition: unknown) => () => undefined)
    const ctx = fakeContext({ tools: { register } })
    registerTool(ctx, { list: () => [] } as unknown as Workbench)
    expect(ctx.effects).toEqual(['mcp-workbench/tool'])
    expect(register).toHaveBeenCalledTimes(1)
    expect((register.mock.calls[0]?.[0] as unknown as { name: string }).name).toBe(TOOL_NAME)
  })

  it('says so when the profile has no tool registry', () => {
    const ctx = fakeContext()
    registerTool(ctx, { list: () => [] } as unknown as Workbench)
    expect(ctx.logger.info).toHaveBeenCalledWith(
      'mcp-workbench: no tool registry in this profile; the MCP page still works',
    )
    expect(ctx.effects).toEqual([])
  })
})
