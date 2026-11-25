import { describe, expect, it } from 'vitest'
import {
  SECRET_KEY_PATTERN,
  applyPatch,
  encodeFieldValue,
  expressionPath,
  fieldsOf,
  validatePatched,
} from '../src/edit.js'

describe('SECRET_KEY_PATTERN', () => {
  it('matches the names a credential hides behind', () => {
    for (const name of ['GITHUB_TOKEN', 'apiKey', 'CLIENT_SECRET', 'PASSWORD', 'AUTH_HEADER', 'AWS_CREDENTIAL']) {
      expect(SECRET_KEY_PATTERN.test(name)).toBe(true)
    }
    for (const name of ['PATH', 'base_url', 'Accept']) {
      expect(SECRET_KEY_PATTERN.test(name)).toBe(false)
    }
  })
})

describe('fieldsOf', () => {
  it('returns nothing for a value that is not a map', () => {
    expect(fieldsOf(undefined)).toEqual({})
    expect(fieldsOf([])).toEqual({})
    expect(fieldsOf('x')).toEqual({})
  })

  it('shows literals and masks secrets by name', () => {
    expect(fieldsOf({ BASE: 'https://host', GITHUB_TOKEN: 'ghp_secret', COUNT: 2 })).toEqual({
      BASE: { value: 'https://host', secret: false },
      GITHUB_TOKEN: { value: null, secret: true },
    })
  })

  it('surfaces a !!js value as the expression behind it', () => {
    expect(fieldsOf({ GITHUB_TOKEN: { __jsExpr: 'process.env.GITHUB_TOKEN' }, PATH: { other: 1 } })).toEqual({
      GITHUB_TOKEN: { value: null, secret: true, expression: 'process.env.GITHUB_TOKEN' },
    })
  })
})

describe('encodeFieldValue', () => {
  it('keeps a literal as typed', () => {
    expect(encodeFieldValue('literal value')).toBe('literal value')
  })

  it('turns the !!js prefix into the stored expression form', () => {
    expect(encodeFieldValue('!!js process.env.HOME')).toEqual({ __jsExpr: 'process.env.HOME' })
    expect(encodeFieldValue('!!js   spaced   ')).toEqual({ __jsExpr: 'spaced   ' })
    expect(encodeFieldValue('!!js line one\nline two')).toEqual({ __jsExpr: 'line one\nline two' })
    expect(encodeFieldValue('not!!js value')).toBe('not!!js value')
  })
})

describe('applyPatch', () => {
  it('keeps every omitted field', () => {
    const raw = { transport: 'stdio', command: 'node', args: ['server.mjs'], env: { A: 'b' } }
    expect(applyPatch(raw, {})).toEqual(raw)
  })

  it('removes a field the patch sets to null', () => {
    const raw = { transport: 'stdio', command: 'node', args: ['server.mjs'], toolCallTimeoutMs: 1000 }
    expect(applyPatch(raw, { args: null, toolCallTimeoutMs: null })).toEqual({
      transport: 'stdio',
      command: 'node',
    })
  })

  it('drops the fields the new transport does not use', () => {
    const raw = {
      transport: 'stdio',
      command: 'node',
      args: ['server.mjs'],
      cwd: '/tmp',
      env: { A: 'b' },
      headers: { H: 'v' },
    }
    expect(applyPatch(raw, { transport: 'streamable-http', url: 'https://host/mcp' })).toEqual({
      transport: 'streamable-http',
      headers: { H: 'v' },
      url: 'https://host/mcp',
    })
  })

  it('drops the url and the headers when the row becomes stdio', () => {
    expect(
      applyPatch(
        { transport: 'streamable-http', url: 'https://host/mcp', headers: { H: 'v' } },
        { transport: 'stdio', command: 'node' },
      ),
    ).toEqual({ transport: 'stdio', command: 'node' })
  })

  it('merges env and headers by key, keeping expressions and deleting null entries', () => {
    const raw = { transport: 'stdio', command: 'node', env: { A: 'a', B: { __jsExpr: 'process.env.B' } } }
    expect(applyPatch(raw, { env: { B: null, C: 'c', D: '!!js process.env.D' } })).toEqual({
      transport: 'stdio',
      command: 'node',
      env: { A: 'a', C: 'c', D: { __jsExpr: 'process.env.D' } },
    })
  })

  it('removes a map once its last entry is gone', () => {
    expect(applyPatch({ transport: 'stdio', command: 'node', env: { A: 'a' } }, { env: { A: null } })).toEqual({
      transport: 'stdio',
      command: 'node',
    })
  })

  it('sets the timeouts it receives', () => {
    expect(
      applyPatch(
        { transport: 'streamable-http', url: 'https://host/mcp' },
        { toolCallTimeoutMs: 1000, startupTimeoutMs: 2000, closeTimeoutMs: 3000 },
      ),
    ).toEqual({
      transport: 'streamable-http',
      url: 'https://host/mcp',
      toolCallTimeoutMs: 1000,
      startupTimeoutMs: 2000,
      closeTimeoutMs: 3000,
    })
  })
})

describe('validatePatched', () => {
  it('reports the same problems the spec validator does', () => {
    expect(validatePatched({ transport: 'stdio' })).toEqual(['command is required'])
    expect(validatePatched({ transport: 'stdio', command: 'node' })).toEqual([])
  })
})

describe('expressionPath', () => {
  it('names where a !!js expression sits', () => {
    expect(expressionPath({ env: { TOKEN: { __jsExpr: 'process.env.TOKEN' } } })).toBe('env.TOKEN')
    expect(expressionPath({ github: { args: ['x', { __jsExpr: 'y' }] } }, 'servers')).toBe('servers.github.args[1]')
    expect(expressionPath({ __jsExpr: 'x' })).toBe('the value')
  })

  it('stays quiet for values the profile can store as data', () => {
    expect(expressionPath({ env: { TOKEN: 'plain' }, args: ['a'] })).toBeUndefined()
    expect(expressionPath({ env: { COMBINED: { __jsExpr: 'a', extra: true } } })).toBeUndefined()
    expect(expressionPath('not a record')).toBeUndefined()
  })
})
