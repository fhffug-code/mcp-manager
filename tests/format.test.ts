import { describe, expect, it } from 'vitest'
import {
  contentText,
  draftOf,
  durationText,
  parseArguments,
  patchOf,
  probeHeadline,
  rowsOf,
} from '../src/client/format.js'
import type { ServerView } from '../src/types/index.js'

const view = (overrides: Partial<ServerView> = {}): ServerView => ({
  name: 'github',
  source: 'profile',
  transport: 'stdio',
  endpoint: 'gh.exe stdio',
  enabled: true,
  editable: true,
  env: { BASE: { value: 'https://host', secret: false }, TOKEN: { value: null, secret: true } },
  headers: { Accept: { value: 'application/json', secret: false } },
  timeouts: { toolCallTimeoutMs: 1000 },
  ...overrides,
})

describe('rowsOf', () => {
  it('turns a field map into editable rows', () => {
    expect(rowsOf(view().env)).toEqual([
      { key: 'BASE', name: 'BASE', value: 'https://host', secret: false, original: true, remove: false },
      { key: 'TOKEN', name: 'TOKEN', value: '', secret: true, original: true, remove: false },
    ])
  })

  it('keeps the expression behind a value', () => {
    expect(rowsOf({ TOKEN: { value: null, secret: true, expression: 'process.env.T' } })).toEqual([
      {
        key: 'TOKEN',
        name: 'TOKEN',
        value: '',
        secret: true,
        expression: 'process.env.T',
        original: true,
        remove: false,
      },
    ])
  })
})

describe('draftOf', () => {
  it('fills the form from the server', () => {
    expect(draftOf(view({ args: ['stdio'], cwd: '/tmp' }))).toMatchObject({
      command: '',
      args: 'stdio',
      cwd: '/tmp',
      url: '',
      toolCallTimeoutMs: '1000',
      startupTimeoutMs: '',
      closeTimeoutMs: '',
    })
  })
})

describe('patchOf', () => {
  it('reads a stdio form', () => {
    const draft = draftOf(view())
    expect(patchOf(view(), { ...draft, command: ' gh.exe ', args: 'stdio  --flag ', cwd: ' ' })).toEqual({
      transport: 'stdio',
      command: 'gh.exe',
      args: ['stdio', '--flag'],
      cwd: null,
      env: { BASE: 'https://host' },
      headers: { Accept: 'application/json' },
      toolCallTimeoutMs: 1000,
      startupTimeoutMs: null,
      closeTimeoutMs: null,
    })
  })

  it('reads an http form', () => {
    const server = view({ transport: 'streamable-http', url: 'https://host/mcp' })
    expect(patchOf(server, { ...draftOf(server), url: 'https://host/mcp' })).toMatchObject({
      transport: 'streamable-http',
      url: 'https://host/mcp',
    })
  })

  it('sends only the fields the user touched', () => {
    const server = view()
    const draft = draftOf(server)
    draft.env = draft.env.map((row) => (row.key === 'BASE' ? { ...row, value: 'https://other' } : row))
    draft.headers = draft.headers.map((row) => ({ ...row, remove: true }))
    expect(patchOf(server, draft)).toMatchObject({
      env: { BASE: 'https://other' },
      headers: { Accept: null },
    })
  })

  it('reads the timeouts and ignores one it cannot parse', () => {
    const draft = { ...draftOf(view()), toolCallTimeoutMs: '2000', startupTimeoutMs: ' abc', closeTimeoutMs: '0' }
    expect(patchOf(view(), draft)).toMatchObject({ toolCallTimeoutMs: 2000 })
    expect(patchOf(view(), draft)).not.toHaveProperty('startupTimeoutMs')
    expect(patchOf(view(), draft)).not.toHaveProperty('closeTimeoutMs')
  })

  it('keeps an untouched secret unchanged', () => {
    expect(patchOf(view(), draftOf(view()))).toEqual({
      transport: 'stdio',
      command: null,
      args: null,
      cwd: null,
      env: { BASE: 'https://host' },
      headers: { Accept: 'application/json' },
      toolCallTimeoutMs: 1000,
      startupTimeoutMs: null,
      closeTimeoutMs: null,
    })
  })
})

describe('parseArguments', () => {
  it('reads an object and refuses anything else', () => {
    expect(parseArguments('')).toEqual({ ok: true, value: {} })
    expect(parseArguments('  ')).toEqual({ ok: true, value: {} })
    expect(parseArguments('{"a":1}')).toEqual({ ok: true, value: { a: 1 } })
    expect(parseArguments('[1]')).toEqual({ ok: false, message: 'arguments must be a JSON object' })
    expect(parseArguments('null')).toEqual({ ok: false, message: 'arguments must be a JSON object' })
    expect(parseArguments('{oops}').ok).toBe(false)
  })
})

describe('durationText', () => {
  it('uses milliseconds under a second', () => {
    expect(durationText(0)).toBe('0 ms')
    expect(durationText(999)).toBe('999 ms')
    expect(durationText(1000)).toBe('1.0 s')
    expect(durationText(12_340)).toBe('12.3 s')
  })
})

describe('contentText', () => {
  it('renders every content block as one line', () => {
    expect(contentText({ type: 'text', text: 'hello' })).toBe('hello')
    expect(contentText({ type: 'image', mimeType: 'image/png', bytes: 12 })).toBe('[image image/png, 12 bytes]')
    expect(contentText({ type: 'audio', mimeType: 'audio/wav', bytes: 3 })).toBe('[audio audio/wav, 3 bytes]')
    expect(contentText({ type: 'resource', uri: 'file:///a', text: 'body' })).toBe('body')
    expect(contentText({ type: 'resource', uri: 'file:///a' })).toBe('[resource file:///a]')
    expect(contentText({ type: 'resource-link', uri: 'file:///a', name: 'a.txt' })).toBe('[link a.txt]')
    expect(contentText({ type: 'resource-link', uri: 'file:///a' })).toBe('[link file:///a]')
    expect(contentText({ type: 'other', kind: 'mystery' })).toBe('[mystery]')
  })
})

describe('probeHeadline', () => {
  const t = (key: string): string => key

  it('says when nothing has probed yet', () => {
    expect(probeHeadline(undefined, t)).toBe('neverProbed')
  })

  it('reports a failure with its message', () => {
    expect(
      probeHeadline(
        { ok: false, toolCount: 0, probedAt: '', durationMs: 0, error: { stage: 'transport', message: 'nope' } },
        t,
      ),
    ).toBe('probeFailed: nope')
    expect(probeHeadline({ ok: false, toolCount: 0, probedAt: '', durationMs: 0 }, t)).toBe('probeFailed: ')
  })

  it('reports the tool count and whether the list was cut', () => {
    expect(probeHeadline({ ok: true, toolCount: 4, probedAt: '', durationMs: 0, tools: [], truncated: false }, t)).toBe(
      '4 toolsCount',
    )
    expect(probeHeadline({ ok: true, toolCount: 4, probedAt: '', durationMs: 0, tools: [], truncated: true }, t)).toBe(
      '4 toolsCount (truncated)',
    )
    expect(probeHeadline({ ok: true, toolCount: 4, probedAt: '', durationMs: 0 }, t)).toBe('4 toolsCount')
  })
})
