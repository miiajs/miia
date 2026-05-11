import { describe, it, expect } from 'bun:test'
import { resolveSchematic, isResourceSchematic, listSchematics } from '../src/generate/schematics.js'

describe('resolveSchematic', () => {
  it('resolves by full name', () => {
    const result = resolveSchematic('controller')
    expect(result).not.toBeUndefined()
    expect(result).not.toBe('resource')
    if (result && result !== 'resource') {
      expect(result.name).toBe('controller')
    }
  })

  it('resolves module by alias "m"', () => {
    const result = resolveSchematic('m')
    expect(result).not.toBeUndefined()
    if (result && result !== 'resource') {
      expect(result.name).toBe('module')
    }
  })

  it('resolves controller by alias "c"', () => {
    const result = resolveSchematic('c')
    expect(result).not.toBeUndefined()
    if (result && result !== 'resource') {
      expect(result.name).toBe('controller')
    }
  })

  it('resolves service by alias "s"', () => {
    const result = resolveSchematic('s')
    expect(result).not.toBeUndefined()
    if (result && result !== 'resource') {
      expect(result.name).toBe('service')
    }
  })

  it('resolves resource by name', () => {
    expect(resolveSchematic('resource')).toBe('resource')
  })

  it('resolves resource by alias "r"', () => {
    expect(resolveSchematic('r')).toBe('resource')
  })

  it('middleware has no short alias', () => {
    expect(resolveSchematic('mw')).toBeUndefined()
    const result = resolveSchematic('middleware')
    expect(result).not.toBeUndefined()
  })

  it('guard has no short alias', () => {
    expect(resolveSchematic('gu')).toBeUndefined()
    const result = resolveSchematic('guard')
    expect(result).not.toBeUndefined()
  })

  it('returns undefined for unknown', () => {
    expect(resolveSchematic('xyz')).toBeUndefined()
  })
})

describe('isResourceSchematic', () => {
  it('returns true for resource', () => {
    expect(isResourceSchematic('resource')).toBe(true)
  })

  it('returns false for a SchematicDefinition', () => {
    const result = resolveSchematic('module')
    expect(isResourceSchematic(result)).toBe(false)
  })
})

describe('listSchematics', () => {
  it('includes all 6 schematics', () => {
    const list = listSchematics()
    const names = list.map((s) => s.name)
    expect(names).toContain('module')
    expect(names).toContain('controller')
    expect(names).toContain('service')
    expect(names).toContain('middleware')
    expect(names).toContain('guard')
    expect(names).toContain('resource')
  })

  it('resource has alias "r"', () => {
    const list = listSchematics()
    const resource = list.find((s) => s.name === 'resource')
    expect(resource?.aliases).toEqual(['r'])
  })
})
