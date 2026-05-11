import { describe, it, expect } from 'bun:test'
import { resolveRuntime } from '../src/runtime/detect.js'

describe('resolveRuntime', () => {
  it('accepts valid runtime flag', () => {
    expect(resolveRuntime(process.cwd(), 'bun').runtime).toBe('bun')
    expect(resolveRuntime(process.cwd(), 'deno').runtime).toBe('deno')
    expect(resolveRuntime(process.cwd(), 'node').runtime).toBe('node')
  })

  it('throws on invalid runtime flag', () => {
    expect(() => resolveRuntime(process.cwd(), 'foo')).toThrow(/Invalid runtime "foo"/)
  })

  it('lists valid options in error message', () => {
    expect(() => resolveRuntime(process.cwd(), 'xyz')).toThrow(/bun, deno, node/)
  })

  it('falls back to auto-detect when flag omitted', () => {
    const result = resolveRuntime(process.cwd())
    expect(['bun', 'deno', 'node']).toContain(result.runtime)
  })
})
