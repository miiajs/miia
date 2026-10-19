import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  addDevHint,
  execCommand,
  detectPackageManager,
  installArgs,
  packageManagerFromUserAgent,
  runScriptCommand,
} from '../src/runtime/package-manager.js'

const dirs: string[] = []

function project(files: string[] = []): string {
  const root = mkdtempSync(join(tmpdir(), 'miia-pm-'))
  dirs.push(root)
  for (const f of files) {
    mkdirSync(join(root, f, '..'), { recursive: true })
    writeFileSync(join(root, f), '')
  }
  return root
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('packageManagerFromUserAgent', () => {
  it('reads the first token of npm_config_user_agent', () => {
    expect(packageManagerFromUserAgent('bun/1.4.0 npm/? node/v24.3.0 darwin arm64')).toBe('bun')
    expect(packageManagerFromUserAgent('pnpm/9.15.0 npm/? node/v22.12.0 linux x64')).toBe('pnpm')
    expect(packageManagerFromUserAgent('yarn/1.22.22 npm/? node/v22.12.0 darwin arm64')).toBe('yarn')
    expect(packageManagerFromUserAgent('npm/11.0.0 node/v24.3.0 darwin arm64 workspaces/false')).toBe('npm')
    expect(packageManagerFromUserAgent('deno/2.7.12 npm/? deno/2.7.12 darwin aarch64')).toBe('deno')
  })

  it('returns null for unknown or missing agents', () => {
    expect(packageManagerFromUserAgent('')).toBeNull()
    expect(packageManagerFromUserAgent('cnpm/9.0.0 node/v22')).toBeNull()
  })
})

describe('detectPackageManager', () => {
  it('maps lockfiles', () => {
    expect(detectPackageManager(project(['bun.lock']))).toBe('bun')
    expect(detectPackageManager(project(['bun.lockb']))).toBe('bun')
    expect(detectPackageManager(project(['pnpm-lock.yaml']))).toBe('pnpm')
    expect(detectPackageManager(project(['yarn.lock']))).toBe('yarn')
    expect(detectPackageManager(project(['package-lock.json']))).toBe('npm')
    expect(detectPackageManager(project(['deno.lock']))).toBe('deno')
  })

  it('walks up from cwd', () => {
    const root = project(['pnpm-lock.yaml', 'packages/api/src/main.ts'])
    expect(detectPackageManager(join(root, 'packages', 'api', 'src'), { stopAt: root })).toBe('pnpm')
  })

  it('returns null without a lockfile', () => {
    const root = project()
    expect(detectPackageManager(root, { stopAt: root })).toBeNull()
  })
})

describe('commands', () => {
  it('installArgs', () => {
    expect(installArgs('bun')).toEqual(['bun', ['install']])
    expect(installArgs('deno')).toEqual(['deno', ['install']])
    expect(installArgs('npm')).toEqual(['npm', ['install']])
  })

  it('runScriptCommand', () => {
    expect(runScriptCommand('bun', 'dev')).toBe('bun run dev')
    expect(runScriptCommand('npm', 'dev')).toBe('npm run dev')
    expect(runScriptCommand('pnpm', 'dev')).toBe('pnpm dev')
    expect(runScriptCommand('yarn', 'test')).toBe('yarn test')
    expect(runScriptCommand('deno', 'check')).toBe('deno task check')
    expect(execCommand('deno')).toBe('deno task miia')
    expect(execCommand('pnpm')).toBe('pnpm exec miia')
  })

  it('addDevHint', () => {
    expect(addDevHint('bun', 'typescript')).toBe('bun add -d typescript')
    expect(addDevHint('npm', 'typescript')).toBe('npm install -D typescript')
    expect(addDevHint('pnpm', 'tsx')).toBe('pnpm add -D tsx')
    expect(addDevHint('yarn', 'tsx')).toBe('yarn add -D tsx')
    expect(addDevHint('deno', 'typescript')).toBe('deno add -D npm:typescript')
  })
})
