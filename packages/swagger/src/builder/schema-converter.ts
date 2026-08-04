import type { JsonSchema } from '../types.js'

type Io = 'input' | 'output'

export function convertSchema(schema: unknown, options?: { io?: Io }): JsonSchema {
  // Never forwarded as undefined - zod's own default is 'output'
  const io: Io = options?.io ?? 'input'

  if (!schema || typeof schema !== 'object') return { type: 'object' }

  // 1. Native JSON Schema export (zod 4.3+ spells it toJSONSchema)
  const s = schema as any
  const toJson =
    typeof s.toJSONSchema === 'function' ? s.toJSONSchema : typeof s.toJsonSchema === 'function' ? s.toJsonSchema : null
  if (toJson) {
    const isZod = s['~standard']?.vendor === 'zod'
    try {
      const result = isZod ? toJson.call(s, { io, unrepresentable: 'any' }) : toJson.call(s)
      if (isZod && io === 'input') {
        try {
          mergeFormats(result, toJson.call(s, { io: 'output', unrepresentable: 'any' }))
        } catch {}
      }
      // zod pins a non-configurable `~standard` on its result - delete throws, spread drops it
      return { ...cleanup(result, io) }
    } catch {
      // fall through to the manual walk below
    }
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
      return convertZod4(schema as any, io)
    }
    // Zod 3: _def.typeName is "ZodObject", "ZodString", etc.
    if (def.typeName) {
      return convertZod3Def(def, io)
    }
  }

  return { type: 'object' }
}

// ─── Native output post-processing ─────────────────────────────

const MERGEABLE_TYPES = new Set(['string', 'number', 'integer', 'boolean'])

/** Copies `format` - and nothing else - from the output side, so a piped `z.email()` keeps it. */
function mergeFormats(inp: any, out: any): any {
  if (!inp || !out || typeof inp !== 'object' || typeof out !== 'object') return inp

  if (typeof inp.type === 'string' && inp.type === out.type && MERGEABLE_TYPES.has(inp.type)) {
    if (inp.format === undefined && out.format !== undefined) inp.format = out.format
    return inp
  }

  if (inp.properties && out.properties) {
    for (const key of Object.keys(inp.properties)) {
      if (out.properties[key]) inp.properties[key] = mergeFormats(inp.properties[key], out.properties[key])
    }
  }
  if (inp.items && out.items) inp.items = mergeFormats(inp.items, out.items)
  if (inp.additionalProperties && typeof inp.additionalProperties === 'object' && out.additionalProperties) {
    inp.additionalProperties = mergeFormats(inp.additionalProperties, out.additionalProperties)
  }
  for (const key of ['anyOf', 'allOf', 'oneOf', 'prefixItems']) {
    if (Array.isArray(inp[key]) && Array.isArray(out[key]) && inp[key].length === out[key].length) {
      inp[key] = inp[key].map((node: any, i: number) => mergeFormats(node, out[key][i]))
    }
  }
  if (inp.$defs && out.$defs) {
    for (const key of Object.keys(inp.$defs)) {
      if (out.$defs[key]) inp.$defs[key] = mergeFormats(inp.$defs[key], out.$defs[key])
    }
  }
  return inp
}

function cleanup(node: any, io: Io): any {
  if (Array.isArray(node)) return node.map((n) => cleanup(n, io))
  if (!node || typeof node !== 'object') return node

  delete node.$schema
  if (node.maximum === Number.MAX_SAFE_INTEGER) delete node.maximum
  if (node.minimum === -Number.MAX_SAFE_INTEGER) delete node.minimum
  // Swagger UI generates its example from `pattern` via RandExp; the format says the same thing
  if (node.format !== undefined && node.pattern !== undefined) delete node.pattern
  // Responses are never validated, and a closed schema breaks strict client generators
  if (io === 'output' && node.additionalProperties === false) delete node.additionalProperties

  for (const key of ['items', 'not', 'propertyNames', 'additionalProperties']) {
    if (node[key] && typeof node[key] === 'object') node[key] = cleanup(node[key], io)
  }
  for (const key of ['anyOf', 'allOf', 'oneOf', 'prefixItems']) {
    if (Array.isArray(node[key])) node[key] = node[key].map((n: any) => cleanup(n, io))
  }
  for (const key of ['properties', '$defs']) {
    if (node[key] && typeof node[key] === 'object') {
      for (const inner of Object.keys(node[key])) node[key][inner] = cleanup(node[key][inner], io)
    }
  }
  return node
}

// ─── Zod 4 Converter ───────────────────────────────────────────

function convertZod4(schema: any, io: Io): JsonSchema {
  const def = schema._def
  const result: JsonSchema = {}

  if (schema.description) result.description = schema.description

  switch (def.type) {
    case 'object':
      return convertZod4Object(def, result, io)
    case 'string':
      return convertZod4String(schema, result)
    case 'number':
      return convertZod4Number(schema, result)
    case 'boolean':
      return { ...result, type: 'boolean' }
    case 'array':
      return { ...result, type: 'array', items: def.element ? convertZod4(def.element, io) : {} }
    case 'enum':
      return { ...result, type: 'string', enum: Object.values(def.entries) }
    case 'literal': {
      const values: any[] = def.values ?? [def.value]
      return values.length === 1 ? { ...result, const: values[0] } : { ...result, enum: values }
    }
    case 'pipe': {
      const side = io === 'output' ? def.out : def.in
      return side ? convertZod4(side, io) : { ...result, type: 'object' }
    }
    case 'transform':
      return result
    case 'optional':
      return def.innerType ? convertZod4(def.innerType, io) : { ...result, type: 'object' }
    case 'nullable': {
      const inner = def.innerType ? convertZod4(def.innerType, io) : { type: 'object' }
      return { ...inner, ...result, type: [(inner.type as string) ?? 'object', 'null'] }
    }
    case 'default': {
      const inner = def.innerType ? convertZod4(def.innerType, io) : { type: 'object' }
      return { ...inner, ...result, default: def.defaultValue }
    }
    case 'union':
      return {
        ...result,
        anyOf: (def.options ?? []).map((opt: any) => convertZod4(opt, io)),
      }
    default:
      return { ...result, type: 'object' }
  }
}

function convertZod4Object(def: any, base: JsonSchema, io: Io): JsonSchema {
  const shape = def.shape ?? {}
  const properties: Record<string, JsonSchema> = {}
  const required: string[] = []

  for (const [key, value] of Object.entries(shape)) {
    const v = value as any
    properties[key] = convertZod4(v, io)
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

function convertZod3Def(def: any, io: Io): JsonSchema {
  if (!def || !def.typeName) return { type: 'object' }

  const result: JsonSchema = {}
  if (def.description) result.description = def.description

  switch (def.typeName) {
    case 'ZodObject':
      return convertZod3Object(def, result, io)
    case 'ZodString':
      return convertZod3String(def, result)
    case 'ZodNumber':
      return convertZod3Number(def, result)
    case 'ZodBoolean':
      return { ...result, type: 'boolean' }
    case 'ZodArray': {
      const itemsDef = def.type?._def ?? def.type
      return { ...result, type: 'array', items: itemsDef ? convertZod3Def(itemsDef, io) : {} }
    }
    case 'ZodEnum':
      return { ...result, type: 'string', enum: def.values }
    case 'ZodNativeEnum':
      return { ...result, enum: Object.values(def.values) }
    case 'ZodLiteral':
      return { ...result, const: def.value }
    case 'ZodOptional':
      return convertZod3Def(def.innerType?._def ?? def.innerType, io)
    case 'ZodNullable': {
      const inner = convertZod3Def(def.innerType?._def ?? def.innerType, io)
      return { ...inner, ...result, type: [(inner.type as string) ?? 'object', 'null'] }
    }
    case 'ZodDefault': {
      const inner = convertZod3Def(def.innerType?._def ?? def.innerType, io)
      return { ...inner, ...result, default: def.defaultValue() }
    }
    case 'ZodUnion':
    case 'ZodDiscriminatedUnion':
      return {
        ...result,
        anyOf: (def.options ?? []).map((opt: any) => convertZod3Def(opt._def ?? opt, io)),
      }
    case 'ZodEffects':
      return convertZod3Def(def.schema?._def ?? def.schema, io)
    case 'ZodPipeline': {
      const side = io === 'output' ? def.out : def.in
      return side ? convertZod3Def(side._def ?? side, io) : { ...result, type: 'object' }
    }
    default:
      return { ...result, type: 'object' }
  }
}

function convertZod3Object(def: any, base: JsonSchema, io: Io): JsonSchema {
  const shape = typeof def.shape === 'function' ? def.shape() : (def.shape ?? {})
  const properties: Record<string, JsonSchema> = {}
  const required: string[] = []

  for (const [key, value] of Object.entries(shape)) {
    const fieldDef = (value as any)?._def
    properties[key] = convertZod3Def(fieldDef ?? value, io)
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
