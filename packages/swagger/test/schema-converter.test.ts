import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import { convertSchema } from '../src/index.js'

describe('convertSchema', () => {
  describe('Zod 3 (_def based)', () => {
    it('should convert ZodObject', () => {
      const schema = z.object({
        name: z.string(),
        age: z.number(),
      })
      const result = convertSchema(schema)
      expect(result).toEqual({
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
        required: ['name', 'age'],
      })
    })

    it('should handle optional fields', () => {
      const schema = z.object({
        name: z.string(),
        email: z.string().optional(),
      })
      const result = convertSchema(schema)
      expect(result.required).toEqual(['name'])
      expect(result.properties!.email).toEqual({ type: 'string' })
    })

    it('should handle default values', () => {
      const schema = z.object({
        role: z.string().default('user'),
      })
      const result = convertSchema(schema)
      expect(result.properties!.role).toEqual({ type: 'string', default: 'user' })
      expect(result.required).toBeUndefined()
    })

    it('should convert string with email format', () => {
      const schema = z.object({
        email: z.string().email(),
      })
      const result = convertSchema(schema)
      expect(result.properties!.email).toEqual({ type: 'string', format: 'email' })
    })

    it('should convert string with url format', () => {
      const schema = z.object({ url: z.string().url() })
      const result = convertSchema(schema)
      expect(result.properties!.url).toEqual({ type: 'string', format: 'uri' })
    })

    it('should convert string with uuid format', () => {
      const schema = z.object({ id: z.string().uuid() })
      const result = convertSchema(schema)
      expect(result.properties!.id).toEqual({ type: 'string', format: 'uuid' })
    })

    it('should convert string with min/max', () => {
      const schema = z.string().min(1).max(100)
      const result = convertSchema(schema)
      expect(result).toEqual({ type: 'string', minLength: 1, maxLength: 100 })
    })

    it('should convert integer', () => {
      const schema = z.number().int()
      const result = convertSchema(schema)
      expect(result.type).toBe('integer')
    })

    it('should convert number with min/max', () => {
      const schema = z.number().min(0).max(100)
      const result = convertSchema(schema)
      expect(result).toEqual({ type: 'number', minimum: 0, maximum: 100 })
    })

    it('should convert boolean', () => {
      const result = convertSchema(z.boolean())
      expect(result).toEqual({ type: 'boolean' })
    })

    it('should convert array', () => {
      const schema = z.array(z.string())
      const result = convertSchema(schema)
      expect(result).toEqual({ type: 'array', items: { type: 'string' } })
    })

    it('should convert enum', () => {
      const schema = z.enum(['admin', 'user', 'guest'])
      const result = convertSchema(schema)
      expect(result).toEqual({ type: 'string', enum: ['admin', 'user', 'guest'] })
    })

    it('should convert nullable', () => {
      const schema = z.string().nullable()
      const result = convertSchema(schema)
      expect(result.anyOf).toEqual([{ type: 'string' }, { type: 'null' }])
    })

    it('should extract .describe() descriptions', () => {
      const schema = z.object({
        email: z.string().email().describe('User email address'),
      })
      const result = convertSchema(schema)
      expect(result.properties!.email.description).toBe('User email address')
    })

    it('should convert union types', () => {
      const schema = z.union([z.string(), z.number()])
      const result = convertSchema(schema)
      expect(result.anyOf).toHaveLength(2)
      expect(result.anyOf![0].type).toBe('string')
      expect(result.anyOf![1].type).toBe('number')
    })

    it('should convert nested objects', () => {
      const schema = z.object({
        address: z.object({
          street: z.string(),
          city: z.string(),
        }),
      })
      const result = convertSchema(schema)
      expect(result.properties!.address).toEqual({
        type: 'object',
        properties: {
          street: { type: 'string' },
          city: { type: 'string' },
        },
        required: ['street', 'city'],
      })
    })
  })

  describe('native toJSONSchema', () => {
    it('should default to the input side', () => {
      const schema = z.object({ role: z.string().default('user') })
      expect(convertSchema(schema).required).toBeUndefined()
      expect(convertSchema(schema, { io: 'output' }).required).toEqual(['role'])
    })

    it('should convert the requested side of a pipe', () => {
      const schema = z
        .string()
        .transform((s) => s.length)
        .pipe(z.number())
      expect(convertSchema(schema)).toEqual({ type: 'string' })
      expect(convertSchema(schema, { io: 'output' })).toEqual({ type: 'number' })
    })

    it('should merge the output format onto the input schema', () => {
      const schema = z.object({ email: z.string().trim().pipe(z.email()) })
      expect(convertSchema(schema).properties!.email).toEqual({ type: 'string', format: 'email' })
    })

    it('should not merge format when the two sides differ in type', () => {
      const schema = z.object({ csv: z.string().transform((s) => s.split(',')) })
      expect(convertSchema(schema).properties!.csv).toEqual({ type: 'string' })
      expect(convertSchema(schema, { io: 'output' }).properties!.csv).toEqual({})
    })

    it('should convert literals and unions of literals', () => {
      expect(convertSchema(z.literal('a'))).toEqual({ type: 'string', const: 'a' })
      expect(convertSchema(z.union([z.literal('a'), z.literal('b')]))).toEqual({
        anyOf: [
          { type: 'string', const: 'a' },
          { type: 'string', const: 'b' },
        ],
      })
    })

    it('should render unrepresentable types as an open schema', () => {
      expect(convertSchema(z.object({ d: z.date() })).properties!.d).toEqual({})
    })

    it('should keep coerced defaults optional', () => {
      const result = convertSchema(z.object({ page: z.coerce.number().int().min(1).default(1) }))
      expect(result.properties!.page).toEqual({ type: 'integer', minimum: 1, default: 1 })
      expect(result.required).toBeUndefined()
    })

    it('should convert tuple, record, intersection and discriminated union', () => {
      expect(convertSchema(z.tuple([z.string(), z.number()]))).toEqual({
        type: 'array',
        prefixItems: [{ type: 'string' }, { type: 'number' }],
      })
      expect(convertSchema(z.record(z.string(), z.number()))).toEqual({
        type: 'object',
        propertyNames: { type: 'string' },
        additionalProperties: { type: 'number' },
      })
      expect(
        convertSchema(z.intersection(z.object({ a: z.string() }), z.object({ b: z.number() }))).allOf,
      ).toHaveLength(2)
      const union = z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('a') }),
        z.object({ kind: z.literal('b') }),
      ])
      expect(convertSchema(union).oneOf).toHaveLength(2)
    })

    it('should strip $schema and the safe-integer bounds of .int()', () => {
      const result = convertSchema(z.object({ n: z.number().int() }))
      expect(result.$schema).toBeUndefined()
      expect(result.properties!.n).toEqual({ type: 'integer' })
    })

    it('should drop additionalProperties: false on the output side only', () => {
      const schema = z.strictObject({ a: z.string() })
      expect(convertSchema(schema).additionalProperties).toBe(false)
      expect(convertSchema(schema, { io: 'output' }).additionalProperties).toBeUndefined()
    })

    it('should drop the pattern of a formatted string but keep a plain .regex()', () => {
      const result = convertSchema(z.object({ email: z.email(), slug: z.string().regex(/^[a-z]+$/) }))
      expect(result.properties!.email).toEqual({ type: 'string', format: 'email' })
      expect(result.properties!.slug).toEqual({ type: 'string', pattern: '^[a-z]+$' })
    })
  })

  describe('_def fallback', () => {
    it('should convert the requested side of a zod 4 pipe', () => {
      const schema = { _def: { type: 'pipe', in: { _def: { type: 'string' } }, out: { _def: { type: 'number' } } } }
      expect(convertSchema(schema)).toEqual({ type: 'string' })
      expect(convertSchema(schema, { io: 'output' })).toEqual({ type: 'number' })
    })

    it('should read zod 4 literals from def.values', () => {
      expect(convertSchema({ _def: { type: 'literal', values: ['a'] } })).toEqual({ const: 'a' })
      expect(convertSchema({ _def: { type: 'literal', values: ['a', 'b'] } })).toEqual({ enum: ['a', 'b'] })
    })

    it('should render a zod 4 transform as an open schema', () => {
      expect(convertSchema({ _def: { type: 'transform' } })).toEqual({})
    })

    it('should convert the requested side of a zod 3 ZodPipeline', () => {
      const schema = {
        _def: {
          typeName: 'ZodPipeline',
          in: { _def: { typeName: 'ZodString' } },
          out: { _def: { typeName: 'ZodNumber' } },
        },
      }
      expect(convertSchema(schema)).toEqual({ type: 'string' })
      expect(convertSchema(schema, { io: 'output' })).toEqual({ type: 'number' })
    })
  })

  describe('JSON Schema passthrough', () => {
    it('should pass through raw JSON Schema objects', () => {
      const raw = { type: 'object', properties: { id: { type: 'string' } } }
      expect(convertSchema(raw)).toEqual(raw)
    })
  })

  describe('fallback', () => {
    it('should return { type: object } for unknown', () => {
      expect(convertSchema(null)).toEqual({ type: 'object' })
      expect(convertSchema(undefined)).toEqual({ type: 'object' })
      expect(convertSchema(42)).toEqual({ type: 'object' })
    })
  })
})
