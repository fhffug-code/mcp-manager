import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CONFIG,
  SERVER_NAME_PATTERN,
  normalizeConfig,
  normalizeServerSpec,
  validateServerSpec,
} from '../src/config.js'

describe('SERVER_NAME_PATTERN', () => {
  it('accepts the names the MCP clients accept', () => {
    for (const name of ['a', 'github', 'deep_wiki-2', 'A'.repeat(32)]) {
      expect(SERVER_NAME_PATTERN.test(name)).toBe(true)
    }
  })

  it('refuses names with other characters or no bound', () => {
    for (const name of ['', 'two words', 'a.b', 'x'.repeat(33), '中文']) {
      expect(SERVER_NAME_PATTERN.test(name)).toBe(false)
    }
  })
})

describe('validateServerSpec', () => {
  it('requires an object with a known transport', () => {
    expect(validateServerSpec(undefined)).toEqual(['server must be an object'])
    expect(validateServerSpec([])).toEqual(['server must be an object'])
    expect(validateServerSpec({})).toEqual(['transport must be "stdio" or "streamable-http"'])
    expect(validateServerSpec({ transport: 'sse' })).toEqual(['transport must be "stdio" or "streamable-http"'])
  })

  it('requires a command for stdio and rejects the http fields', () => {
    expect(validateServerSpec({ transport: 'stdio' })).toEqual(['command is required'])
    expect(validateServerSpec({ transport: 'stdio', command: '   ' })).toEqual(['command is required'])
    expect(validateServerSpec({ transport: 'stdio', command: 'node', url: 'http://x' })).toEqual([
      'url is not used by a stdio server',
    ])
    expect(validateServerSpec({ transport: 'stdio', command: 'node', args: ['a', 2] })).toEqual([
      'args must be a list of strings',
    ])
    expect(validateServerSpec({ transport: 'stdio', command: 'node', args: ['--flag'] })).toEqual([])
  })

  it('requires an absolute http url for the http transport', () => {
    expect(validateServerSpec({ transport: 'streamable-http' })).toEqual(['url is required'])
    expect(validateServerSpec({ transport: 'streamable-http', url: 'not a url' })).toEqual([
      'url must be an absolute http(s) URL',
    ])
    expect(validateServerSpec({ transport: 'streamable-http', url: 'ftp://host/mcp' })).toEqual([
      'url must be http or https',
    ])
    expect(validateServerSpec({ transport: 'streamable-http', url: 'https://host/mcp', command: 'node' })).toEqual([
      'command is not used by a streamable-http server',
    ])
    expect(validateServerSpec({ transport: 'streamable-http', url: 'https://host/mcp' })).toEqual([])
  })

  it('bounds the timeouts and the maps', () => {
    expect(validateServerSpec({ transport: 'stdio', command: 'node', toolCallTimeoutMs: 0 })).toEqual([
      'toolCallTimeoutMs must be a positive integer',
    ])
    expect(validateServerSpec({ transport: 'stdio', command: 'node', startupTimeoutMs: 1.5 })).toEqual([
      'startupTimeoutMs must be a positive integer',
    ])
    expect(validateServerSpec({ transport: 'stdio', command: 'node', closeTimeoutMs: '100' })).toEqual([
      'closeTimeoutMs must be a positive integer',
    ])
    expect(validateServerSpec({ transport: 'stdio', command: 'node', env: { A: 1 } })).toEqual([
      'env must be a map of strings',
    ])
    expect(validateServerSpec({ transport: 'stdio', command: 'node', headers: [] })).toEqual([
      'headers must be a map of strings',
    ])
  })
})

describe('normalizeServerSpec', () => {
  it('keeps only the fields the transport uses', () => {
    expect(
      normalizeServerSpec({
        transport: 'stdio',
        command: 'node',
        args: ['server.mjs'],
        env: { A: 'b' },
        cwd: '/tmp',
        url: undefined,
        extra: true,
      }),
    ).toEqual({ transport: 'stdio', command: 'node', args: ['server.mjs'], env: { A: 'b' }, cwd: '/tmp' })
  })

  it('keeps the reconnect block, the enabled flag and the timeouts', () => {
    expect(
      normalizeServerSpec({
        transport: 'streamable-http',
        url: 'https://host/mcp',
        headers: { A: 'b' },
        toolCallTimeoutMs: 1000,
        startupTimeoutMs: 2000,
        closeTimeoutMs: 3000,
        reconnect: { enabled: false },
        enabled: false,
      }),
    ).toEqual({
      transport: 'streamable-http',
      url: 'https://host/mcp',
      headers: { A: 'b' },
      toolCallTimeoutMs: 1000,
      startupTimeoutMs: 2000,
      closeTimeoutMs: 3000,
      reconnect: { enabled: false },
      enabled: false,
    })
  })

  it('returns nothing for an invalid spec', () => {
    expect(normalizeServerSpec({ transport: 'stdio' })).toBeUndefined()
    expect(normalizeServerSpec(null)).toBeUndefined()
  })
})

describe('normalizeConfig', () => {
  it('falls back to the defaults for an empty config', () => {
    expect(normalizeConfig(undefined)).toEqual({ config: { ...DEFAULT_CONFIG }, warnings: [] })
    expect(normalizeConfig({})).toEqual({ config: { ...DEFAULT_CONFIG }, warnings: [] })
  })

  it('reports a config that is not an object', () => {
    expect(normalizeConfig('nope')).toEqual({ config: { ...DEFAULT_CONFIG }, warnings: ['config must be an object'] })
  })

  it('warns that a server map in the bundle config is ignored', () => {
    const { config, warnings } = normalizeConfig({
      servers: {
        good: { transport: 'stdio', command: 'node' },
      },
    })
    expect(config).toEqual({ ...DEFAULT_CONFIG })
    expect(warnings).toEqual([
      "config.servers is ignored; servers live in the profile's @deepseek-ai/dsh-mcp-manager row",
    ])
  })

  it('keeps the budgets it can read and replaces the rest', () => {
    const { config } = normalizeConfig({
      probeTimeoutMs: 5_000,
      toolCallTimeoutMs: 0,
      probeCacheTtlMs: -1,
      resultMaxBytes: 1024,
      maxToolSchemas: '8',
    })
    expect(config.probeTimeoutMs).toBe(5_000)
    expect(config.toolCallTimeoutMs).toBe(DEFAULT_CONFIG.toolCallTimeoutMs)
    expect(config.probeCacheTtlMs).toBe(DEFAULT_CONFIG.probeCacheTtlMs)
    expect(config.resultMaxBytes).toBe(1024)
    expect(config.maxToolSchemas).toBe(DEFAULT_CONFIG.maxToolSchemas)
  })
})
