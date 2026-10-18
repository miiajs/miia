import { describe, expect, it } from 'bun:test'
import { describeSchematics, listSchematics, resolveSchematic } from '../src/generate/schematics.js'

describe('schematics', () => {
  it('resolve by name and alias', () => {
    expect(resolveSchematic('module')?.name).toBe('module')
    expect(resolveSchematic('m')?.name).toBe('module')
    expect(resolveSchematic('c')?.name).toBe('controller')
    expect(resolveSchematic('s')?.name).toBe('service')
    expect(resolveSchematic('r')?.name).toBe('resource')
    expect(resolveSchematic('guard')?.name).toBe('guard')
    expect(resolveSchematic('middleware')?.name).toBe('middleware')
    expect(resolveSchematic('mw')).toBeUndefined()
    expect(resolveSchematic('xyz')).toBeUndefined()
  })

  it('register into the expected module keys', () => {
    const keys = Object.fromEntries(listSchematics().map((s) => [s.name, s.register?.key ?? null]))
    expect(keys).toEqual({
      module: 'imports',
      controller: 'controllers',
      service: 'providers',
      guard: null,
      middleware: null,
      resource: 'imports',
    })
  })

  it('allow --export for service only and nest resource always', () => {
    expect(
      listSchematics()
        .filter((s) => s.exportable)
        .map((s) => s.name),
    ).toEqual(['service'])
    expect(
      listSchematics()
        .filter((s) => s.alwaysNested)
        .map((s) => s.name),
    ).toEqual(['resource'])
  })

  it('describe themselves for usage messages', () => {
    expect(describeSchematics()).toBe('module (m), controller (c), service (s), guard, middleware, resource (r)')
  })
})
