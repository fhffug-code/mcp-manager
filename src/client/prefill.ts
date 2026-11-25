/** Prefill a tool call from its input schema, so the page can show a request that already makes sense. */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const MAX_DEPTH = 4

/** The first value a schema itself offers: a default, an example, an enum member or a const. */
function declaredValue(schema: Record<string, unknown>): { found: true; value: unknown } | { found: false } {
  if (Object.hasOwn(schema, 'default')) return { found: true, value: structuredClone(schema['default']) }
  const examples = schema['examples']
  if (Array.isArray(examples) && examples.length > 0) return { found: true, value: structuredClone(examples[0]) }
  const members = schema['enum']
  if (Array.isArray(members) && members.length > 0) return { found: true, value: structuredClone(members[0]) }
  if (Object.hasOwn(schema, 'const')) return { found: true, value: structuredClone(schema['const']) }
  for (const key of ['oneOf', 'anyOf'] as const) {
    const options = schema[key]
    if (Array.isArray(options) && options.length > 0 && isRecord(options[0])) {
      return { found: true, value: exampleFor(options[0], MAX_DEPTH) }
    }
  }
  return { found: false }
}

/** A value of the right shape for one schema node. */
export function exampleFor(schema: unknown, depth = MAX_DEPTH): unknown {
  if (!isRecord(schema)) return null
  const declared = declaredValue(schema)
  if (declared.found) return declared.value
  const type = schema['type']
  if (type === 'object' || isRecord(schema['properties'])) {
    if (depth <= 0) return {}
    return argumentsOf(schema, depth - 1)
  }
  if (type === 'array') {
    const items = schema['items']
    if (depth <= 0 || items === undefined) return []
    return [exampleFor(items, depth - 1)]
  }
  if (type === 'string') return ''
  if (type === 'number' || type === 'integer') return 0
  if (type === 'boolean') return false
  if (type === 'null') return null
  return null
}

/** Every declared property of an object schema, filled in. */
export function argumentsOf(schema: Record<string, unknown>, depth = MAX_DEPTH): Record<string, unknown> {
  const properties = schema['properties']
  if (!isRecord(properties)) return {}
  const values: Record<string, unknown> = {}
  for (const [name, property] of Object.entries(properties)) {
    values[name] = exampleFor(property, depth)
  }
  return values
}

/** The arguments to show for one tool: an object schema becomes an object, anything else an empty call. */
export function prefillArguments(schema: unknown): Record<string, unknown> {
  if (!isRecord(schema)) return {}
  const type = schema['type']
  if (type !== undefined && type !== 'object') return {}
  return argumentsOf(schema)
}
