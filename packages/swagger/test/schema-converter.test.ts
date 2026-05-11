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
      expect(result.type).toEqual(['string', 'null'])
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
