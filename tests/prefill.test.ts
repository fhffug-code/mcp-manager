import { describe, expect, it } from 'vitest'
import { argumentsOf, exampleFor, prefillArguments } from '../src/client/prefill.js'

describe('exampleFor', () => {
  it('prefers a default, then an example, then an enum member', () => {
    expect(exampleFor({ type: 'string', default: 'text' })).toBe('text')
    expect(exampleFor({ type: 'string', examples: ['first', 'second'] })).toBe('first')
    expect(exampleFor({ type: 'string', enum: ['a', 'b'] })).toBe('a')
    expect(exampleFor({ type: 'string', const: 'fixed' })).toBe('fixed')
  })

  it('falls back to an empty value of the right type', () => {
    expect(exampleFor({ type: 'string' })).toBe('')
    expect(exampleFor({ type: 'number' })).toBe(0)
    expect(exampleFor({ type: 'integer' })).toBe(0)
    expect(exampleFor({ type: 'boolean' })).toBe(false)
    expect(exampleFor({ type: 'array' })).toEqual([])
    expect(exampleFor({ type: 'object' })).toEqual({})
    expect(exampleFor({ type: 'null' })).toBeNull()
    expect(exampleFor(undefined)).toBeNull()
  })

  it('takes the first branch of a union', () => {
    expect(exampleFor({ oneOf: [{ type: 'string' }, { type: 'number' }] })).toBe('')
    expect(exampleFor({ anyOf: [{ type: 'boolean' }, { type: 'number' }] })).toBe(false)
  })

  it('fills an array with one example of its item', () => {
    expect(exampleFor({ type: 'array', items: { type: 'string', default: 'x' } })).toEqual(['x'])
  })

  it('stops recursing at the depth limit', () => {
    const deep = {
      type: 'object',
      properties: { inner: { type: 'object', properties: { value: { type: 'string' } } } },
    }
    expect(exampleFor(deep, 0)).toEqual({})
  })
})

describe('argumentsOf', () => {
  it('fills every declared property', () => {
    expect(
      argumentsOf({
        type: 'object',
        properties: { path: { type: 'string' }, limit: { type: 'number', default: 10 } },
        required: ['path'],
      }),
    ).toEqual({ path: '', limit: 10 })
  })

  it('returns nothing without properties', () => {
    expect(argumentsOf({ type: 'object' })).toEqual({})
  })
})

describe('prefillArguments', () => {
  it('prefills the object a tool declares', () => {
    expect(
      prefillArguments({
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute file path' },
          offset: { type: 'number' },
          limit: { type: 'number' },
        },
      }),
    ).toEqual({ path: '', offset: 0, limit: 0 })
  })

  it('prefills a schema that omits its type', () => {
    expect(prefillArguments({ properties: { message: { type: 'string' } } })).toEqual({ message: '' })
  })

  it('returns an empty call for a non-object schema or none at all', () => {
    expect(prefillArguments({ type: 'string' })).toEqual({})
    expect(prefillArguments(undefined)).toEqual({})
  })
})
