/** The model-facing tool: the same operations, reported as text. */
import { failureOf } from './failures.js'
import type { Workbench } from './service.js'
import type { DshHostContext, DshToolRegistry } from './types/dsh.js'
import type { ServerPatch } from './types/index.js'

export const TOOL_NAME = 'mcp_workbench'

/** Answers are bounded: a long tool list is summarized, and the page holds the full detail. */
const MAX_TEXT = 8_000

const MUTATIONS = new Set(['save', 'add', 'remove', 'setEnabled', 'restart'])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)

const summarize = (value: unknown): string => {
  const text = typeof value === 'string' ? value : JSON.stringify(value, undefined, 2)
  if (text.length <= MAX_TEXT) return text
  return `${text.slice(0, MAX_TEXT)}\n… truncated; open Settings → Plugins → MCP Workbench for the rest.`
}

/** A short table of the fleet, so a list answer stays readable. */
function listText(servers: readonly { name: string; source: string; transport: string; enabled: boolean; endpoint: string; probe?: { ok: boolean; toolCount: number } }[]): string {
  if (servers.length === 0) return 'No MCP servers are mounted in this profile.'
  return servers
    .map((server) => {
      const probe = server.probe === undefined ? 'not probed' : server.probe.ok ? `${server.probe.toolCount} tools` : 'probe failed'
      return `- ${server.name} [${server.source}, ${server.transport}, ${server.enabled ? 'enabled' : 'disabled'}] ${server.endpoint} — ${probe}`
    })
    .join('\n')
}

/** The tool definition this bundle registers. */
export function definition(workbench: Workbench) {
  return {
    name: TOOL_NAME,
    description:
      'Inspect, edit, probe and test the MCP servers this profile mounts. Actions: list (all servers and their sources), detail (one server with its last probe), probe (connect once and read the full tool list with input schemas), call (invoke one tool with arguments), save (patch one server), add (create a server this plugin owns), remove (delete a plugin-owned server), setEnabled (enable or disable a plugin-owned server), restart (restart a manager-governed server). Only probe connects to a server; only call, save, add, remove, setEnabled and restart change anything, and each of those needs confirm=true. Settings → Plugins → MCP Workbench offers the same operations.',
    parameters: {
      action: {
        type: 'string' as const,
        required: true,
        description: 'list | detail | probe | call | save | add | remove | setEnabled | restart',
      },
      name: { type: 'string' as const, description: 'Server name, required by every action except list and add.' },
      tool: { type: 'string' as const, description: 'Tool name for call, exactly as probe reported it.' },
      arguments: { type: 'json' as const, description: 'JSON object of arguments for call; defaults to {}.', },
      spec: { type: 'json' as const, description: 'Server spec for add: {transport, command?, args?, env?, cwd?, url?, headers?}.' },
      patch: {
        type: 'json' as const,
        description: 'Fields to change for save; an omitted field keeps its value and null removes it. env/headers merge by key.',
      },
      enabled: { type: 'boolean' as const, description: 'New state for setEnabled.' },
      force: { type: 'boolean' as const, description: 'For probe: ignore the cached result.' },
      confirm: {
        type: 'boolean' as const,
        description: 'Required true for call, save, add, remove, setEnabled and restart; without it the tool changes nothing.',
      },
    },
    output: {
      schema: { type: 'string' as const },
      render: (_args: unknown, value: string) => [{ type: 'text' as const, text: value }],
    },
    async execute(args: Record<string, unknown>): Promise<string> {
      const action = str(args['action']) ?? ''
      const name = str(args['name'])
      if (MUTATIONS.has(action) && args['confirm'] !== true) {
        return `Refusing ${action}: pass confirm=true to change the profile. Nothing was changed.`
      }
      try {
        switch (action) {
          case 'list': {
            const servers = workbench.list()
            return `${listText(servers)}\n\nUse action=detail with a name for its configuration and last probe.`
          }
          case 'detail': {
            if (name === undefined) return 'name is required for detail'
            const detail = workbench.detail(name)
            return summarize(detail)
          }
          case 'probe': {
            if (name === undefined) return 'name is required for probe'
            return summarize(await workbench.probe(name, { force: args['force'] === true }))
          }
          case 'call': {
            const tool = str(args['tool'])
            if (name === undefined || tool === undefined) return 'name and tool are required for call'
            const result = await workbench.call(name, {
              tool,
              arguments: isRecord(args['arguments']) ? args['arguments'] : {},
            })
            return summarize(result)
          }
          case 'save': {
            if (name === undefined || !isRecord(args['patch'])) return 'name and patch are required for save'
            return summarize(await workbench.save(name, args['patch'] as ServerPatch))
          }
          case 'add': {
            if (name === undefined || args['spec'] === undefined) return 'name and spec are required for add'
            return summarize(await workbench.add({ name, spec: args['spec'] }))
          }
          case 'remove': {
            if (name === undefined) return 'name is required for remove'
            await workbench.remove(name)
            return `Removed ${name}.`
          }
          case 'setEnabled': {
            if (name === undefined || typeof args['enabled'] !== 'boolean') {
              return 'name and enabled are required for setEnabled'
            }
            return summarize(await workbench.setEnabled(name, args['enabled']))
          }
          case 'restart': {
            if (name === undefined) return 'name is required for restart'
            return summarize(await workbench.restart(name))
          }
          default:
            return `Unknown action "${action}". Use one of: list, detail, probe, call, save, add, remove, setEnabled, restart.`
        }
      } catch (error) {
        const failure = failureOf(error)
        return `${failure.code}: ${failure.message}`
      }
    },
  }
}

/** Register the tool, if this profile has a tool registry. */
export function registerTool(ctx: DshHostContext, workbench: Workbench): void {
  const tools = ctx.get<DshToolRegistry>('tools')
  if (tools === undefined) {
    ctx.logger.info('mcp-workbench: no tool registry in this profile; the settings page still works')
    return
  }
  ctx.effect(() => {
    const dispose: unknown = tools.register(definition(workbench))
    return typeof dispose === 'function' ? (dispose as () => void) : undefined
  }, 'mcp-workbench/tool')
}
