// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { McpPanel } from '../src/client/McpPanel.js'
import { STYLES } from '../src/client/styles.js'
import type { ServerView } from '../src/types/index.js'

const t = (key: string): string => key

const view = (over: Partial<ServerView> = {}): ServerView => ({
  name: 'clion',
  source: 'managed',
  transport: 'streamable-http',
  endpoint: 'http://127.0.0.1:64362/stream',
  url: 'http://127.0.0.1:64362/stream',
  enabled: true,
  editable: true,
  entryId: 'mcp-manager',
  env: {},
  headers: {},
  timeouts: {},
  ...over,
})

interface Call {
  action: string
  name?: string
  enabled?: boolean
  patch?: Record<string, unknown>
}

interface Answer {
  status: number
  body: unknown
}

/** A fetch double that records the action of every request and answers from one callback. */
function stubFetch(answer: (call: Call) => Answer): Call[] {
  const calls: Call[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_path: string, init?: { body?: string }) => {
      const call = JSON.parse(String(init?.body ?? '{}')) as Call
      calls.push(call)
      const result = answer(call)
      return { status: result.status, json: async () => result.body } as unknown as Response
    }),
  )
  return calls
}

const listed = (server: ServerView): Answer => ({ status: 200, body: { ok: true, value: { servers: [server] } } })

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('the MCP page switch', () => {
  it('shows the new state as soon as it is switched, before the profile answers', async () => {
    const calls = stubFetch((call) => {
      if (call.action === 'list') return listed(view())
      if (call.action === 'setEnabled')
        return { status: 200, body: { ok: true, value: view({ enabled: call.enabled }) } }
      return { status: 200, body: { ok: true, value: { server: view() } } }
    })

    render(<McpPanel t={t} />)
    await screen.findByText('clion')
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true')

    fireEvent.click(screen.getByRole('switch'))

    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false')
    await waitFor(() => expect(calls.some((call) => call.action === 'setEnabled')).toBe(true))
    expect(calls.find((call) => call.action === 'setEnabled')).toMatchObject({ name: 'clion', enabled: false })
  })

  it('keeps the switched state once the list agrees', async () => {
    let switched = false
    const calls = stubFetch((call) => {
      if (call.action === 'list') return listed(view({ enabled: !switched }))
      if (call.action === 'setEnabled') {
        switched = call.enabled === true
        return { status: 200, body: { ok: true, value: view({ enabled: switched }) } }
      }
      return { status: 200, body: { ok: true, value: { server: view({ enabled: switched }) } } }
    })

    render(<McpPanel t={t} />)
    await screen.findByText('clion')
    fireEvent.click(screen.getByRole('switch'))
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false')

    await waitFor(() => expect(calls.filter((call) => call.action === 'list').length).toBeGreaterThan(1), {
      timeout: 5_000,
    })
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false')
    await waitFor(() => expect(screen.getByRole('switch').getAttribute('aria-busy')).toBe('false'), {
      timeout: 5_000,
    })
  })

  it('says why a switch failed and puts the row back', async () => {
    stubFetch((call) => {
      if (call.action === 'list') return listed(view())
      return {
        status: 405,
        body: { ok: false, error: { code: 'unsupported', message: 'the plugin manager service is not available' } },
      }
    })

    render(<McpPanel t={t} />)
    await screen.findByText('clion')
    fireEvent.click(screen.getByRole('switch'))

    await waitFor(() => expect(screen.getByText('the plugin manager service is not available')).toBeTruthy())
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true')
  })
})

describe('the MCP page layout', () => {
  it('nests the bands the page is built from', async () => {
    stubFetch((call) => {
      if (call.action === 'list') return listed(view())
      return { status: 200, body: { ok: true, value: { server: view() } } }
    })

    render(<McpPanel t={t} />)
    await screen.findByText('clion')

    for (const id of ['split-servers', 'bar-tools', 'split-tools', 'cell-description', 'cell-call']) {
      expect(screen.getByTestId(id)).toBeTruthy()
    }
  })

  it('splits 3/7 and separates the bands with a hairline', () => {
    expect(STYLES).toContain('grid-template-columns: minmax(0, 3fr) minmax(0, 7fr)')
    expect(STYLES).toContain('grid-template-rows: minmax(0, 3fr) minmax(0, 7fr)')
    expect(STYLES).toContain('.mcpw-divide-right { border-right: 1px solid')
  })
})

describe('a server the page cannot change', () => {
  it('offers no switch and no gear, and still takes a test connection', async () => {
    stubFetch((call) => {
      if (call.action === 'list')
        return listed(view({ source: 'profile', editable: false, entryId: 'mcp-clion', readOnlyReason: 'profile' }))
      return { status: 200, body: { ok: true, value: { server: view() } } }
    })

    render(<McpPanel t={t} />)
    await screen.findByText('clion')

    expect((screen.getByRole('switch') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByLabelText('editServer') as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(screen.getByText('clion'))
    const test = (await screen.findByRole('button', { name: 'testConnection' })) as HTMLButtonElement
    expect(test.disabled).toBe(false)
  })
})

describe('the server form', () => {
  it('keeps both transports while it is open and saves the one it shows', async () => {
    const calls = stubFetch((call) => {
      if (call.action === 'list') return listed(view())
      if (call.action === 'save') return { status: 200, body: { ok: true, value: view({ transport: 'stdio' }) } }
      return { status: 200, body: { ok: true, value: { server: view() } } }
    })

    render(<McpPanel t={t} />)
    await screen.findByText('clion')
    fireEvent.click(screen.getByLabelText('editServer'))

    const dialog = await screen.findByRole('dialog')
    const url = screen.getByLabelText('url') as HTMLInputElement
    expect(url.value).toBe('http://127.0.0.1:64362/stream')

    fireEvent.change(screen.getByLabelText('transport'), { target: { value: 'stdio' } })
    fireEvent.change(screen.getByLabelText('command'), { target: { value: 'node' } })
    fireEvent.change(screen.getByLabelText('transport'), { target: { value: 'streamable-http' } })

    expect((screen.getByLabelText('url') as HTMLInputElement).value).toBe('http://127.0.0.1:64362/stream')
    fireEvent.click(within(dialog).getByRole('button', { name: 'save' }))

    await waitFor(() => expect(calls.some((call) => call.action === 'save')).toBe(true))
    expect(calls.find((call) => call.action === 'save')?.patch).toMatchObject({
      transport: 'streamable-http',
      url: 'http://127.0.0.1:64362/stream',
    })
    expect(calls.find((call) => call.action === 'save')?.patch).not.toHaveProperty('command')
  })

  it('asks once more before it deletes the server', async () => {
    const calls = stubFetch((call) => {
      if (call.action === 'list') return listed(view())
      if (call.action === 'remove') return { status: 200, body: { ok: true, value: { servers: [] } } }
      return { status: 200, body: { ok: true, value: { server: view() } } }
    })

    render(<McpPanel t={t} />)
    await screen.findByText('clion')
    fireEvent.click(screen.getByLabelText('editServer'))

    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'deleteServer' }))
    expect(calls.some((call) => call.action === 'remove')).toBe(false)

    fireEvent.click(within(dialog).getByRole('button', { name: 'delete' }))
    await waitFor(() => expect(calls.some((call) => call.action === 'remove')).toBe(true))
    expect(calls.find((call) => call.action === 'remove')).toMatchObject({ name: 'clion' })
  })
})
