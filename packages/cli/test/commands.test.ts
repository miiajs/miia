import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getBuildCommand, getDevServerCommand, getStartCommand, resolveCommandEnv } from '../src/runtime/commands.js'

const dirs: string[] = []

function project(files: string[] = []): string {
  const root = mkdtempSync(join(tmpdir(), 'miia-commands-'))
  dirs.push(root)
  for (const f of files) writeFileSync(join(root, f), '')
  return root
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('getDevServerCommand', () => {
  it('runs the runtime watcher', () => {
    const root = project()
    expect(getDevServerCommand('bun', 'src/main.ts', root)).toEqual({
      command: 'bun',
      args: ['--watch', 'src/main.ts'],
      env: { NODE_ENV: 'development' },
    })
    expect(getDevServerCommand('deno', 'src/main.ts', root).args).toEqual([
      'run',
      '--allow-all',
      '--sloppy-imports',
      '--watch',
      'src/main.ts',
    ])
    expect(getDevServerCommand('node', 'src/main.ts', root).args).toEqual(['--import', 'tsx', '--watch', 'src/main.ts'])
  })

  it('passes .env when present and --env-file when given', () => {
    const root = project(['.env'])
    expect(getDevServerCommand('bun', 'src/main.ts', root).args).toEqual(['--env-file=.env', '--watch', 'src/main.ts'])
    expect(getDevServerCommand('node', 'src/main.ts', project(), '.env.dev').args[0]).toBe('--env-file=.env.dev')
  })
})

describe('getStartCommand', () => {
  it('runs sources on bun and deno with NODE_ENV=production', () => {
    const root = project()
    expect(getStartCommand('bun', 'src/main.ts', 'dist/main.js', root)).toEqual({
      command: 'bun',
      args: ['src/main.ts'],
      env: { NODE_ENV: 'production' },
    })
    expect(getStartCommand('deno', 'src/main.ts', 'dist/main.js', root)).toEqual({
      command: 'deno',
      args: ['run', '--allow-all', '--sloppy-imports', 'src/main.ts'],
      env: { NODE_ENV: 'production' },
    })
  })

  it('runs the compiled entry on node with source maps', () => {
    expect(getStartCommand('node', 'src/main.ts', 'dist/main.js', project(['.env']))).toEqual({
      command: 'node',
      args: ['--env-file=.env', '--enable-source-maps', 'dist/main.js'],
      env: { NODE_ENV: 'production' },
    })
  })
})

describe('getBuildCommand', () => {
  it('type-checks on bun and deno', () => {
    expect(getBuildCommand('bun', project(), '/bin/tsc')).toEqual({ command: '/bin/tsc', args: ['--noEmit'] })
    expect(getBuildCommand('deno', project()).args).toEqual(['--noEmit'])
  })

  it('compiles on node, with tsconfig.build.json when present', () => {
    expect(getBuildCommand('node', project()).args).toEqual([])
    expect(getBuildCommand('node', project(['tsconfig.build.json'])).args).toEqual(['-p', 'tsconfig.build.json'])
  })
})

describe('resolveCommandEnv', () => {
  it('fills in defaults the environment does not set', () => {
    const env = resolveCommandEnv({ command: 'bun', args: [], env: { NODE_ENV: 'production' } }, { PATH: '/bin' })
    expect(env).toEqual({ PATH: '/bin', NODE_ENV: 'production' })
  })

  it('never overrides a value the user set', () => {
    const env = resolveCommandEnv({ command: 'bun', args: [], env: { NODE_ENV: 'development' } }, { NODE_ENV: 'test' })
    expect(env.NODE_ENV).toBe('test')
  })

  it('does not mutate the source environment', () => {
    const source = { PATH: '/bin' }
    resolveCommandEnv({ command: 'bun', args: [], env: { NODE_ENV: 'production' } }, source)
    expect(source).toEqual({ PATH: '/bin' })
  })
})
