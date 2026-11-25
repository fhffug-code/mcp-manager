import { describe, expect, it } from 'vitest'
import { dictionaries, en, type LocaleId } from '../src/client/locales.js'

/** The languages the Harness settings offer, in the order it lists them. */
const IDS: LocaleId[] = ['zh', 'en', 'ja', 'es', 'fr', 'de', 'ru', 'pt']

describe('the dictionaries', () => {
  it('carries exactly the languages the settings offer', () => {
    expect(Object.keys(dictionaries).sort()).toEqual([...IDS].sort())
  })

  it('gives every language the same keys as the baseline', () => {
    const baseline = Object.keys(en).sort()
    for (const id of IDS) expect(Object.keys(dictionaries[id]).sort()).toEqual(baseline)
  })

  it('leaves no word empty', () => {
    for (const id of IDS) {
      for (const [key, value] of Object.entries(dictionaries[id])) {
        expect(value.trim(), `${id}.${key}`).not.toBe('')
      }
    }
  })

  it('labels the row MCP everywhere and titles the page per language', () => {
    for (const id of IDS) expect(dictionaries[id]['panel']).toBe('MCP')
    expect(dictionaries['zh']['title']).toBe('MCP 管理')
    expect(dictionaries['ja']['title']).toBe('MCP 管理')
    expect(dictionaries['de']['title']).toBe('MCP-Verwaltung')
    expect(dictionaries['ru']['title']).toBe('Управление MCP')
  })

  it('carries the words the formatter and the call box ask for', () => {
    for (const id of IDS) {
      for (const key of ['neverProbed', 'truncated', 'argumentsNotObject']) {
        expect(dictionaries[id][key]?.trim(), `${id}.${key}`).toBeTruthy()
      }
    }
  })
})
