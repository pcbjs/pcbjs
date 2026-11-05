// Runtime validation uses the same schemas advertised by tools/list.
export function validateArguments(schema: Record<string, any>, value: unknown, path = 'arguments', depth = 0): void {
  const fail = (reason: string): never => {
    throw new Error(`${path.slice(0, 160)}: ${reason}`)
  }
  if (depth > 24) fail('nesting exceeds 24 levels')
  if (
    schema.anyOf &&
    !schema.anyOf.some((branch: Record<string, any>) => {
      try {
        validateArguments(branch, value, path, depth + 1)
        return true
      } catch {
        return false
      }
    })
  )
    fail('does not match an allowed shape')
  const types = schema.type ? (Array.isArray(schema.type) ? schema.type : [schema.type]) : []
  const matches = (t: string) =>
    t === 'null'
      ? value === null
      : t === 'object'
        ? !!value && typeof value === 'object' && !Array.isArray(value)
        : t === 'array'
          ? Array.isArray(value)
          : t === 'number'
            ? typeof value === 'number' && Number.isFinite(value)
            : typeof value === t
  if (types.length && !types.some(matches)) fail(`expected ${types.join(' or ')}`)
  if (schema.enum && !schema.enum.includes(value)) fail(`expected ${schema.enum.join(', ')}`)
  if (Array.isArray(value)) {
    if ((schema.minItems !== undefined && value.length < schema.minItems) || (schema.maxItems !== undefined && value.length > schema.maxItems))
      fail(`expected ${schema.minItems ?? 0} to ${schema.maxItems ?? 'unbounded'} items`)
    if (schema.items) value.forEach((v, i) => validateArguments(schema.items, v, `${path}[${i}]`, depth + 1))
  } else if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    for (const key of schema.required ?? []) if (!Object.hasOwn(record, key)) fail(`missing ${key}`)
    for (const [key, v] of Object.entries(record)) {
      const child = schema.properties && Object.hasOwn(schema.properties, key) ? schema.properties[key] : undefined
      if (child) validateArguments(child, v, `${path}.${key}`, depth + 1)
      else if (schema.additionalProperties === false) fail(`unknown field ${key.slice(0, 80)}`)
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') validateArguments(schema.additionalProperties, v, `${path}.${key}`, depth + 1)
    }
  }
}
