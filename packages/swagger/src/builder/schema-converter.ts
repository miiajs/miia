import type { JsonSchema } from '../types.js'

export function convertSchema(schema: unknown): JsonSchema {
  if (!schema || typeof schema !== 'object') return { type: 'object' }

  // 1. Zod 4+ native toJsonSchema() (future-proof)
  if ('toJsonSchema' in schema && typeof (schema as any).toJsonSchema === 'function') {
    return (schema as any).toJsonSchema()
  }

  // 2. Already a JSON Schema object (has 'type' but no '_def')
  if ('type' in schema && !('_def' in schema)) {
    return schema as JsonSchema
  }

  // 3. Zod schema (has '_def')
  if ('_def' in schema) {
    const def = (schema as any)._def
    // Zod 4: _def.type is a string ("object", "string", etc.)
    if (def.type && typeof def.type === 'string') {
      return convertZod4(schema as any)
    }
    // Zod 3: _def.typeName is "ZodObject", "ZodString", etc.
    if (def.typeName) {
      return convertZod3Def(def)
    }
  }

  return { type: 'object' }
}

// ─── Zod 4 Converter ───────────────────────────────────────────

function convertZod4(schema: any): JsonSchema {
  const def = schema._def
  const result: JsonSchema = {}

  if (schema.description) result.description = schema.description

  switch (def.type) {
    case 'object':
      return convertZod4Object(def, result)
    case 'string':
      return convertZod4String(schema, result)
    case 'number':
      return convertZod4Number(schema, result)
    case 'boolean':
      return { ...result, type: 'boolean' }
    case 'array':
      return { ...result, type: 'array', items: def.element ? convertZod4(def.element) : {} }
    case 'enum':
      return { ...result, type: 'string', enum: Object.values(def.entries) }
    case 'literal':
      return { ...result, const: def.value }
    case 'optional':
      return def.innerType ? convertZod4(def.innerType) : { ...result, type: 'object' }
    case 'nullable': {
      const inner = def.innerType ? convertZod4(def.innerType) : { type: 'object' }
      return { ...inner, ...result, type: [(inner.type as string) ?? 'object', 'null'] }
    }
    case 'default': {
      const inner = def.innerType ? convertZod4(def.innerType) : { type: 'object' }
      return { ...inner, ...result, default: def.defaultValue }
    }
    case 'union':
      return {
        ...result,
        anyOf: (def.options ?? []).map((opt: any) => convertZod4(opt)),
      }
    default:
      return { ...result, type: 'object' }
  }
}

function convertZod4Object(def: any, base: JsonSchema): JsonSchema {
  const shape = def.shape ?? {}
  const properties: Record<string, JsonSchema> = {}
  const required: string[] = []

  for (const [key, value] of Object.entries(shape)) {
    const v = value as any
    properties[key] = convertZod4(v)
    if (v._def?.type !== 'optional' && v._def?.type !== 'default') {
      required.push(key)
    }
  }

  return {
    ...base,
    type: 'object',
    properties,
    ...(required.length > 0 && { required }),
  }
}

function convertZod4String(schema: any, base: JsonSchema): JsonSchema {
  const result: JsonSchema = { ...base, type: 'string' }
  if (schema.format) {
    const formatMap: Record<string, string> = {
      email: 'email',
      url: 'uri',
      uri: 'uri',
      uuid: 'uuid',
      datetime: 'date-time',
      date: 'date',
      time: 'time',
      ip: 'ip',
    }
    result.format = formatMap[schema.format] ?? schema.format
  }
  if (schema.minLength != null) result.minLength = schema.minLength
  if (schema.maxLength != null) result.maxLength = schema.maxLength
  return result
}

function convertZod4Number(schema: any, base: JsonSchema): JsonSchema {
  const result: JsonSchema = { ...base }
  result.type = schema.isInt ? 'integer' : 'number'
  if (
    schema.minValue !== null &&
    schema.minValue !== undefined &&
    isFinite(schema.minValue) &&
    schema.minValue !== -Number.MAX_SAFE_INTEGER &&
    schema.minValue !== Number.MIN_SAFE_INTEGER
  ) {
    result.minimum = schema.minValue
  }
  if (
    schema.maxValue !== null &&
    schema.maxValue !== undefined &&
    isFinite(schema.maxValue) &&
    schema.maxValue !== Number.MAX_SAFE_INTEGER
  ) {
    result.maximum = schema.maxValue
  }
  return result
}

// ─── Zod 3 Converter ───────────────────────────────────────────

function convertZod3Def(def: any): JsonSchema {
  if (!def || !def.typeName) return { type: 'object' }

  const result: JsonSchema = {}
  if (def.description) result.description = def.description

  switch (def.typeName) {
    case 'ZodObject':
      return convertZod3Object(def, result)
    case 'ZodString':
      return convertZod3String(def, result)
    case 'ZodNumber':
      return convertZod3Number(def, result)
    case 'ZodBoolean':
      return { ...result, type: 'boolean' }
    case 'ZodArray': {
      const itemsDef = def.type?._def ?? def.type
      return { ...result, type: 'array', items: itemsDef ? convertZod3Def(itemsDef) : {} }
    }
    case 'ZodEnum':
      return { ...result, type: 'string', enum: def.values }
    case 'ZodNativeEnum':
      return { ...result, enum: Object.values(def.values) }
    case 'ZodLiteral':
      return { ...result, const: def.value }
    case 'ZodOptional':
      return convertZod3Def(def.innerType?._def ?? def.innerType)
    case 'ZodNullable': {
      const inner = convertZod3Def(def.innerType?._def ?? def.innerType)
      return { ...inner, ...result, type: [(inner.type as string) ?? 'object', 'null'] }
    }
    case 'ZodDefault': {
      const inner = convertZod3Def(def.innerType?._def ?? def.innerType)
      return { ...inner, ...result, default: def.defaultValue() }
    }
    case 'ZodUnion':
    case 'ZodDiscriminatedUnion':
      return {
        ...result,
        anyOf: (def.options ?? []).map((opt: any) => convertZod3Def(opt._def ?? opt)),
      }
    case 'ZodEffects':
      return convertZod3Def(def.schema?._def ?? def.schema)
    default:
      return { ...result, type: 'object' }
  }
}

function convertZod3Object(def: any, base: JsonSchema): JsonSchema {
  const shape = typeof def.shape === 'function' ? def.shape() : (def.shape ?? {})
  const properties: Record<string, JsonSchema> = {}
  const required: string[] = []

  for (const [key, value] of Object.entries(shape)) {
    const fieldDef = (value as any)?._def
    properties[key] = convertZod3Def(fieldDef ?? value)
    if (fieldDef?.typeName !== 'ZodOptional' && fieldDef?.typeName !== 'ZodDefault') {
      required.push(key)
    }
  }

  return {
    ...base,
    type: 'object',
    properties,
    ...(required.length > 0 && { required }),
  }
}

function convertZod3String(def: any, base: JsonSchema): JsonSchema {
  const result: JsonSchema = { ...base, type: 'string' }
  for (const check of def.checks ?? []) {
    switch (check.kind) {
      case 'email':
        result.format = 'email'
        break
      case 'url':
        result.format = 'uri'
        break
      case 'uuid':
        result.format = 'uuid'
        break
      case 'datetime':
        result.format = 'date-time'
        break
      case 'min':
        result.minLength = check.value
        break
      case 'max':
        result.maxLength = check.value
        break
    }
  }
  return result
}

function convertZod3Number(def: any, base: JsonSchema): JsonSchema {
  const result: JsonSchema = { ...base }
  let isInteger = false
  for (const check of def.checks ?? []) {
    switch (check.kind) {
      case 'int':
        isInteger = true
        break
      case 'min':
        result.minimum = check.value
        break
      case 'max':
        result.maximum = check.value
        break
    }
  }
  result.type = isInteger ? 'integer' : 'number'
  return result
}
