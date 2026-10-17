import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveRuntime } from '../src/runtime/detect.js'
import { CliError } from '../src/utils/errors.js'

const dirs: string[] = []

function project(files: string[] = []): string {
  const root = mkdtempSync(join(tmpdir(), 'miia-detect-'))
  dirs.push(root)
  for (const f of files) {
    mkdirSync(join(root, f, '..'), { recursive: true })
    writeFileSync(join(root, f), '')
  }
  return root
}

const nothingInPath = () => null

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('resolveRuntime', () => {
  it('takes the --runtime flag first', () => {
    const root = project(['bun.lock'])
    expect(resolveRuntime(root, 'deno')).toEqual({ runtime: 'deno', source: '--runtime flag' })
    expect(resolveRuntime(root, 'node').runtime).toBe('node')
  })

  it('rejects an invalid flag with a CliError', () => {
    expect(() => resolveRuntime(project(), 'foo')).toThrow(CliError)
    expect(() => resolveRuntime(project(), 'xyz')).toThrow(/Invalid runtime "xyz". Valid: bun, deno, node/)
  })

  it('detects lockfiles', () => {
    const deps = { findExecutable: nothingInPath }
    expect(resolveRuntime(project(['bun.lock']), undefined, deps)).toEqual({ runtime: 'bun', source: 'bun.lock' })
    expect(resolveRuntime(project(['bun.lockb']), undefined, deps).runtime).toBe('bun')
    expect(resolveRuntime(project(['deno.lock']), undefined, deps).runtime).toBe('deno')
    expect(resolveRuntime(project(['package-lock.json']), undefined, deps).runtime).toBe('node')
    expect(resolveRuntime(project(['yarn.lock']), undefined, deps).runtime).toBe('node')
    expect(resolveRuntime(project(['pnpm-lock.yaml']), undefined, deps).runtime).toBe('node')
  })

  it('prefers deno.json over a pnpm lockfile', () => {
    const root = project(['deno.json', 'pnpm-lock.yaml'])
    expect(resolveRuntime(root, undefined, { findExecutable: nothingInPath })).toEqual({
      runtime: 'deno',
      source: 'deno.json',
    })
    expect(resolveRuntime(project(['deno.jsonc', 'package-lock.json'])).runtime).toBe('deno')
  })

  it('walks up to a lockfile in a parent directory', () => {
    const root = project(['bun.lock', 'apps/api/src/main.ts'])
    const result = resolveRuntime(join(root, 'apps', 'api'), undefined, { findExecutable: nothingInPath, stopAt: root })
    expect(result).toEqual({ runtime: 'bun', source: join('..', '..', 'bun.lock') })
  })

  it('stops at the nearest level with a match', () => {
    const root = project(['bun.lock', 'apps/api/deno.json'])
    expect(resolveRuntime(join(root, 'apps', 'api'), undefined, { stopAt: root }).runtime).toBe('deno')
  })

  it('falls back to executables in PATH', () => {
    const root = project()
    const onlyDeno = (name: string) => (name === 'deno' ? '/usr/bin/deno' : null)
    const both = (name: string) => `/usr/bin/${name}`
    expect(resolveRuntime(root, undefined, { findExecutable: onlyDeno, stopAt: root })).toEqual({
      runtime: 'deno',
      source: 'deno in PATH',
    })
    expect(resolveRuntime(root, undefined, { findExecutable: both, stopAt: root })).toEqual({
      runtime: 'bun',
      source: 'bun in PATH',
    })
  })

  it('defaults to node', () => {
    const root = project()
    expect(resolveRuntime(root, undefined, { findExecutable: nothingInPath, stopAt: root })).toEqual({
      runtime: 'node',
      source: 'default',
    })
  })
})
