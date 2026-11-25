import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LAYOUT,
  LAYOUT_KEY,
  LIMITS,
  clampLayout,
  fractionOf,
  readLayout,
  writeLayout,
} from '../src/client/layout.js'

/** The few parts of `Storage` the layout helpers touch. */
class Memory implements Storage {
  private readonly entries = new Map<string, string>()

  get length(): number {
    return this.entries.size
  }

  clear(): void {
    this.entries.clear()
  }

  getItem(key: string): string | null {
    return this.entries.get(key) ?? null
  }

  key(index: number): string | null {
    return [...this.entries.keys()][index] ?? null
  }

  removeItem(key: string): void {
    this.entries.delete(key)
  }

  setItem(key: string, value: string): void {
    this.entries.set(key, value)
  }
}

/** A storage that refuses every write, like a browser in a locked-down context. */
class Hostile extends Memory {
  override setItem(): void {
    throw new Error('denied')
  }

  override getItem(): string | null {
    throw new Error('denied')
  }
}

describe('clampLayout', () => {
  it('keeps a share inside its limits', () => {
    const layout = clampLayout({ servers: 0.9, tools: 0.01, detail: 0.4 })
    expect(layout.servers).toBe(LIMITS.servers[1])
    expect(layout.tools).toBe(LIMITS.tools[0])
    expect(layout.detail).toBe(0.4)
  })

  it('falls back for anything that is not a number', () => {
    expect(clampLayout({ servers: 'wide', tools: null })).toEqual(DEFAULT_LAYOUT)
    expect(clampLayout(undefined)).toEqual(DEFAULT_LAYOUT)
    expect(clampLayout({ servers: Number.NaN })).toEqual(DEFAULT_LAYOUT)
  })
})

describe('readLayout', () => {
  it('answers the defaults when nothing was stored', () => {
    expect(readLayout(new Memory())).toEqual(DEFAULT_LAYOUT)
    expect(readLayout(undefined)).toEqual(DEFAULT_LAYOUT)
  })

  it('reads back what it wrote', () => {
    const storage = new Memory()
    writeLayout(storage, { servers: 0.3, tools: 0.4, detail: 0.25 })
    expect(readLayout(storage)).toEqual({ servers: 0.3, tools: 0.4, detail: 0.25 })
    expect(storage.getItem(LAYOUT_KEY)).toContain('"servers":0.3')
  })

  it('ignores a damaged entry instead of throwing', () => {
    const storage = new Memory()
    storage.setItem(LAYOUT_KEY, 'not json')
    expect(readLayout(storage)).toEqual(DEFAULT_LAYOUT)
  })

  it('survives a storage that refuses to answer', () => {
    expect(readLayout(new Hostile())).toEqual(DEFAULT_LAYOUT)
    expect(() => writeLayout(new Hostile(), DEFAULT_LAYOUT)).not.toThrow()
  })
})

describe('fractionOf', () => {
  const rect = { left: 100, top: 50, width: 400, height: 200 } as DOMRect

  it('measures the pointer along the axis it was given', () => {
    expect(fractionOf(rect, { x: 300, y: 0 }, 'x')).toBeCloseTo(0.5)
    expect(fractionOf(rect, { x: 0, y: 150 }, 'y')).toBeCloseTo(0.5)
  })

  it('answers 0 for a box with no extent', () => {
    const flat = { left: 0, top: 0, width: 0, height: 0 } as DOMRect
    expect(fractionOf(flat, { x: 10, y: 10 }, 'x')).toBe(0)
  })
})
