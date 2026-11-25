/** The one HTTP route the settings page talks to: a JSON envelope in, a JSON envelope out. */
import { failureOf, WorkbenchFailure } from './failures.js'
import type { Workbench } from './service.js'
import type { DshConnection } from './types/dsh.js'
import type { ServerPatch, WorkbenchResponse } from './types/index.js'

/** Where the settings page posts, on the same origin as the rest of the Harness UI. */
export const ROUTE_PATH = '/api/mcp-workbench'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const STATUS: Record<string, number> = {
  'invalid-request': 400,
  'invalid-config': 422,
  'unknown-server': 404,
  'not-editable': 409,
  overridden: 409,
  'name-conflict': 409,
  'config-editor-unavailable': 503,
  unsupported: 405,
  'probe-failed': 502,
  'call-failed': 502,
}

const json = (body: WorkbenchResponse<unknown>, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })

/**
 * Refuse a request a browser page on another origin sent.
 * Browsers always send `Sec-Fetch-Site`, so a cross-site page cannot pass this check.
 */
function sameOrigin(request: Request): boolean {
  const site = request.headers.get('sec-fetch-site')
  if (site !== null && site !== 'same-origin') return false
  const origin = request.headers.get('origin')
  if (origin === null) return true
  try {
    return new URL(origin).host === new URL(request.url).host
  } catch {
    return false
  }
}

const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)

const record = (value: unknown): Record<string, unknown> | undefined => (isRecord(value) ? value : undefined)

/** Run one request body against the service. */
async function dispatch(workbench: Workbench, body: Record<string, unknown>): Promise<unknown> {
  const action = str(body['action'])
  switch (action) {
    case 'list':
      return { servers: workbench.list() }
    case 'detail': {
      const name = str(body['name'])
      if (name === undefined) throw new WorkbenchFailure('invalid-request', 'name is required')
      return workbench.detail(name)
    }
    case 'probe': {
      const name = str(body['name'])
      if (name === undefined) throw new WorkbenchFailure('invalid-request', 'name is required')
      return workbench.probe(name, { force: body['force'] === true })
    }
    case 'call': {
      const name = str(body['name'])
      const tool = str(body['tool'])
      if (name === undefined || tool === undefined) {
        throw new WorkbenchFailure('invalid-request', 'name and tool are required')
      }
      return workbench.call(name, { tool, arguments: record(body['arguments']) ?? {} })
    }
    case 'save': {
      const name = str(body['name'])
      const patch = record(body['patch'])
      if (name === undefined || patch === undefined) {
        throw new WorkbenchFailure('invalid-request', 'name and patch are required')
      }
      return workbench.save(name, patch as ServerPatch)
    }
    case 'add': {
      const name = str(body['name'])
      if (name === undefined || body['spec'] === undefined) {
        throw new WorkbenchFailure('invalid-request', 'name and spec are required')
      }
      return workbench.add({ name, spec: body['spec'] })
    }
    case 'remove': {
      const name = str(body['name'])
      if (name === undefined) throw new WorkbenchFailure('invalid-request', 'name is required')
      await workbench.remove(name)
      return { removed: name }
    }
    case 'setEnabled': {
      const name = str(body['name'])
      if (name === undefined || typeof body['enabled'] !== 'boolean') {
        throw new WorkbenchFailure('invalid-request', 'name and enabled are required')
      }
      return workbench.setEnabled(name, body['enabled'])
    }
    case 'restart': {
      const name = str(body['name'])
      if (name === undefined) throw new WorkbenchFailure('invalid-request', 'name is required')
      return workbench.restart(name)
    }
    default:
      throw new WorkbenchFailure('invalid-request', `unknown action "${action ?? ''}"`)
  }
}

/** Build the route handler the connection serves. */
export function createHandler(workbench: Workbench): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    if (!sameOrigin(request))
      return json({ ok: false, error: { code: 'invalid-request', message: 'cross-origin request refused' } }, 403)
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return json({ ok: false, error: { code: 'invalid-request', message: 'body must be JSON' } }, 400)
    }
    if (!isRecord(body)) {
      return json({ ok: false, error: { code: 'invalid-request', message: 'body must be a JSON object' } }, 400)
    }
    try {
      return json({ ok: true, value: await dispatch(workbench, body) })
    } catch (error) {
      const failure = failureOf(error)
      return json({ ok: false, error: failure }, STATUS[failure.code] ?? 500)
    }
  }
}

/** Register the route on the authenticated browser channel. */
export function registerRoute(scope: DshConnection, workbench: Workbench): () => void {
  const dispose: unknown = scope.fetch.register({
    path: ROUTE_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: createHandler(workbench),
  })
  return typeof dispose === 'function' ? (dispose as () => void) : () => undefined
}
