import { describe, expect, it } from 'vitest'
import {
  contentText,
  draftOf,
  durationText,
  joinArgs,
  parseArguments,
  patchOf,
  probeHeadline,
  rowsOf,
  splitArgs,
} from '../src/client/format.js'
import { en } from '../src/client/locales.js'
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

describe('joinArgs and splitArgs', () => {
  it('keeps an argument with a space in one piece', () => {
    expect(joinArgs(['--directory', 'C:\\Program Files\\x', 'run'])).toBe('--directory "C:\\Program Files\\x" run')
    expect(splitArgs('--directory "C:\\Program Files\\x" run')).toEqual(['--directory', 'C:\\Program Files\\x', 'run'])
  })

  it('repairs a list whose quoted path was split on its spaces', () => {
    const broken = ['--directory', '"E:\\Program', 'Files\\Blender', 'Foundation\\blender_mcp"', 'run', 'blender-mcp']
    expect(splitArgs(joinArgs(broken))).toEqual([
      '--directory',
      'E:\\Program Files\\Blender Foundation\\blender_mcp',
      'run',
      'blender-mcp',
    ])
  })

  it('leaves a plain list alone', () => {
    expect(splitArgs('  stdio   --flag  ')).toEqual(['stdio', '--flag'])
    expect(splitArgs('')).toEqual([])
    expect(joinArgs([])).toBe('')
  })
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
    expect(patchOf({ ...draft, command: ' gh.exe ', args: 'stdio  --flag ', cwd: ' ' }, 'stdio')).toEqual({
      transport: 'stdio',
      command: 'gh.exe',
      args: ['stdio', '--flag'],
      cwd: null,
      env: { BASE: 'https://host' },
      toolCallTimeoutMs: 1000,
      startupTimeoutMs: null,
      closeTimeoutMs: null,
    })
  })

  it('reads an http form', () => {
    const server = view({ transport: 'streamable-http', url: 'https://host/mcp' })
    expect(patchOf(draftOf(server), 'streamable-http')).toMatchObject({
      transport: 'streamable-http',
      url: 'https://host/mcp',
      headers: { Accept: 'application/json' },
    })
  })

  it('switches a stdio server to http without the stdio fields', () => {
    const patch = patchOf({ ...draftOf(view()), url: 'https://other/mcp' }, 'streamable-http')
    expect(patch).toMatchObject({ transport: 'streamable-http', url: 'https://other/mcp' })
    expect(patch).not.toHaveProperty('command')
    expect(patch).not.toHaveProperty('args')
    expect(patch).not.toHaveProperty('cwd')
    expect(patch).not.toHaveProperty('env')
  })

  it('switches an http server to stdio without the http fields', () => {
    const server = view({ transport: 'streamable-http', url: 'https://host/mcp' })
    const patch = patchOf({ ...draftOf(server), command: 'gh.exe' }, 'stdio')
    expect(patch).toMatchObject({ transport: 'stdio', command: 'gh.exe' })
    expect(patch).not.toHaveProperty('url')
    expect(patch).not.toHaveProperty('headers')
  })

  it('sends only the entries the user touched', () => {
    const draft = draftOf(view())
    draft.env = draft.env.map((row) => (row.key === 'BASE' ? { ...row, value: 'https://other' } : row))
    expect(patchOf(draft, 'stdio')).toMatchObject({ env: { BASE: 'https://other' } })
  })

  it('reads the timeouts and ignores one it cannot parse', () => {
    const draft = { ...draftOf(view()), toolCallTimeoutMs: '2000', startupTimeoutMs: ' abc', closeTimeoutMs: '0' }
    expect(patchOf(draft, 'stdio')).toMatchObject({ toolCallTimeoutMs: 2000 })
    expect(patchOf(draft, 'stdio')).not.toHaveProperty('startupTimeoutMs')
    expect(patchOf(draft, 'stdio')).not.toHaveProperty('closeTimeoutMs')
  })

  it('keeps an untouched secret unchanged', () => {
    expect(patchOf(draftOf(view()), 'stdio')).toEqual({
      transport: 'stdio',
      command: null,
      args: null,
      cwd: null,
      env: { BASE: 'https://host' },
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
    expect(parseArguments('[1]')).toEqual({ ok: false, reason: 'not-object' })
    expect(parseArguments('null')).toEqual({ ok: false, reason: 'not-object' })
    const broken = parseArguments('{oops}')
    expect(broken.ok).toBe(false)
    expect(broken.ok ? '' : broken.reason).toBe('invalid-json')
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
  // The real dictionary, so a missing word shows up here instead of as a raw key in the page.
  const words: Record<string, string> = en
  const t = (key: string): string => words[key] ?? key

  it('says when nothing has probed yet', () => {
    expect(probeHeadline(undefined, t)).toBe('Not probed yet')
  })

  it('reports a failure with its message', () => {
    expect(
      probeHeadline(
        { ok: false, toolCount: 0, probedAt: '', durationMs: 0, error: { stage: 'transport', message: 'nope' } },
        t,
      ),
    ).toBe('Probe failed: nope')
    expect(probeHeadline({ ok: false, toolCount: 0, probedAt: '', durationMs: 0 }, t)).toBe('Probe failed: ')
  })

  it('reports the tool count and whether the list was cut', () => {
    expect(probeHeadline({ ok: true, toolCount: 4, probedAt: '', durationMs: 0, tools: [], truncated: false }, t)).toBe(
      '4 tools',
    )
    expect(probeHeadline({ ok: true, toolCount: 4, probedAt: '', durationMs: 0, tools: [], truncated: true }, t)).toBe(
      '4 tools (truncated)',
    )
    expect(probeHeadline({ ok: true, toolCount: 4, probedAt: '', durationMs: 0 }, t)).toBe('4 tools')
  })
})
