/** The one route the page talks to. */
import type { CallResult, ProbeResult, ServerPatch, ServerView, WorkbenchResponse } from '../types/index.js'

export const ROUTE_PATH = '/api/mcp-workbench'

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export interface ServerDetail {
  server: ServerView
  probe?: ProbeResult
}

async function post<T>(body: Record<string, unknown>): Promise<T> {
  const response = await fetch(ROUTE_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    credentials: 'same-origin',
  })
  let payload: WorkbenchResponse<T>
  try {
    payload = (await response.json()) as WorkbenchResponse<T>
  } catch {
    throw new ApiError('transport', `the Harness answered ${response.status} without a JSON body`)
  }
  if (payload.ok !== true) throw new ApiError(payload.error.code, payload.error.message)
  return payload.value
}

export interface WorkbenchApi {
  list(): Promise<ServerView[]>
  detail(name: string): Promise<ServerDetail>
  probe(name: string, force?: boolean): Promise<ProbeResult>
  call(name: string, tool: string, args: Record<string, unknown>): Promise<CallResult>
  save(name: string, patch: ServerPatch): Promise<ServerDetail>
  add(name: string, spec: unknown): Promise<ServerView>
  remove(name: string): Promise<void>
  setEnabled(name: string, enabled: boolean): Promise<ServerView>
  restart(name: string): Promise<ServerView>
}

export const createApi = (): WorkbenchApi => ({
  list: async () => (await post<{ servers: ServerView[] }>({ action: 'list' })).servers,
  detail: (name) => post<ServerDetail>({ action: 'detail', name }),
  probe: (name, force = false) => post<ProbeResult>({ action: 'probe', name, force }),
  call: (name, tool, args) => post<CallResult>({ action: 'call', name, tool, arguments: args }),
  save: (name, patch) => post<ServerDetail>({ action: 'save', name, patch }),
  add: (name, spec) => post<ServerView>({ action: 'add', name, spec }),
  remove: async (name) => {
    await post<{ removed: string }>({ action: 'remove', name })
  },
  setEnabled: (name, enabled) => post<ServerView>({ action: 'setEnabled', name, enabled }),
  restart: (name) => post<ServerView>({ action: 'restart', name }),
})
