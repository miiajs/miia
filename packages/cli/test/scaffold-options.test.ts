import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Addon } from '../src/scaffold/addons.js'
import { resolveNewOptions, validateProjectName } from '../src/scaffold/options.js'
import { CliError } from '../src/utils/errors.js'

const dirs: string[] = []

function tempDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'miia-options-'))
  dirs.push(root)
  return root
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const batch = (cwd: string, extra: Partial<Parameters<typeof resolveNewOptions>[1]> = {}) => ({
  interactive: false,
  hasBun: true,
  cwd,
  ...extra,
})

const fakeAddon = (id: string, kind: Addon['kind']): Addon => ({
  id,
  label: id,
  hint: '',
  kind,
  isInstalled: () => false,
  apply: () => {},
})

describe('validateProjectName', () => {
  it('follows npm package name rules', () => {
    expect(validateProjectName('my-app')).toBeUndefined()
    expect(validateProjectName('@scope/app')).toBeUndefined()
    expect(validateProjectName('app.v2_~x')).toBeUndefined()
    expect(validateProjectName('My App')).toBe('Project name must be lower case')
    expect(validateProjectName('UPPER')).toBe('Project name must be lower case')
    expect(validateProjectName('my app')).toContain('may contain')
    expect(validateProjectName('.hidden')).toContain('may contain')
    expect(validateProjectName('_x')).toContain('may contain')
    expect(validateProjectName('a'.repeat(215))).toContain('214')
    expect(validateProjectName('')).toBe('Project name is required')
  })
})

describe('resolveNewOptions', () => {
  it('defaults to bun when Bun is installed, node otherwise', async () => {
    const cwd = tempDir()
    expect(await resolveNewOptions({ name: 'app' }, batch(cwd))).toEqual({
      name: 'app',
      dir: join(cwd, 'app'),
      runtime: 'bun',
      packageManager: 'bun',
      addons: [],
      install: true,
      dryRun: false,
    })
    const node = await resolveNewOptions({ name: 'app' }, batch(cwd, { hasBun: false }))
    expect([node?.runtime, node?.packageManager]).toEqual(['node', 'npm'])
  })

  it('takes the package manager from the user agent for node', async () => {
    const cwd = tempDir()
    const pnpm = await resolveNewOptions(
      { name: 'app', runtime: 'node' },
      batch(cwd, { userAgent: 'pnpm/9.15.0 npm/? node/v22' }),
    )
    expect(pnpm?.packageManager).toBe('pnpm')
    const deno = await resolveNewOptions(
      { name: 'app', runtime: 'node' },
      batch(cwd, { userAgent: 'deno/2.7.12 npm/?' }),
    )
    expect(deno?.packageManager).toBe('npm')
    const denoRuntime = await resolveNewOptions({ name: 'app', runtime: 'deno' }, batch(cwd))
    expect(denoRuntime?.packageManager).toBe('deno')
    const mixed = await resolveNewOptions({ name: 'app', runtime: 'deno', pm: 'pnpm' }, batch(cwd))
    expect(mixed?.packageManager).toBe('pnpm')
  })

  it('validates flags', async () => {
    const cwd = tempDir()
    await expect(resolveNewOptions({ name: 'app', runtime: 'java' }, batch(cwd))).rejects.toThrow(
      'Invalid runtime "java"',
    )
    await expect(resolveNewOptions({ name: 'app', pm: 'cargo' }, batch(cwd))).rejects.toThrow('Invalid package manager')
    await expect(resolveNewOptions({ name: 'App' }, batch(cwd))).rejects.toThrow(CliError)
  })

  it('reads --features and --db', async () => {
    const cwd = tempDir()
    const registry = [fakeAddon('swagger', 'feature'), fakeAddon('papr', 'database')]
    const options = await resolveNewOptions(
      { name: 'app', features: 'swagger, cors,', db: 'papr', 'skip-install': true, 'dry-run': true },
      batch(cwd, { registry }),
    )
    expect(options?.addons).toEqual(['swagger', 'cors', 'papr'])
    expect([options?.install, options?.dryRun]).toEqual([false, true])
    expect((await resolveNewOptions({ name: 'app', db: 'none' }, batch(cwd, { registry })))?.addons).toEqual([])
    await expect(resolveNewOptions({ name: 'app', db: 'swagger' }, batch(cwd, { registry }))).rejects.toThrow(
      'Unknown database "swagger". Available: none, papr',
    )
  })

  it('uses the last segment of a scoped name as the folder', async () => {
    const cwd = tempDir()
    const options = await resolveNewOptions({ name: '@acme/api' }, batch(cwd))
    expect([options?.name, options?.dir]).toEqual(['@acme/api', join(cwd, 'api')])
  })

  it('"." uses the current folder and its name', async () => {
    const cwd = join(tempDir(), 'my-service')
    mkdirSync(cwd)
    const options = await resolveNewOptions({ name: '.' }, batch(cwd))
    expect([options?.name, options?.dir]).toEqual(['my-service', cwd])

    const bad = join(tempDir(), 'Bad Name')
    mkdirSync(bad)
    await expect(resolveNewOptions({ name: '.' }, batch(bad))).rejects.toThrow('the current folder name is used')
  })

  it('refuses a folder that is not empty, accepts an empty one', async () => {
    const cwd = tempDir()
    mkdirSync(join(cwd, 'empty'))
    expect((await resolveNewOptions({ name: 'empty' }, batch(cwd)))?.dir).toBe(join(cwd, 'empty'))
    mkdirSync(join(cwd, 'taken'))
    writeFileSync(join(cwd, 'taken', 'x'), '')
    await expect(resolveNewOptions({ name: 'taken' }, batch(cwd))).rejects.toThrow('Folder "taken" is not empty')
  })

  it('needs a name without prompts', async () => {
    await expect(resolveNewOptions({}, batch(tempDir()))).rejects.toThrow('Project name is required')
    await expect(resolveNewOptions({ name: '  ' }, batch(tempDir()))).rejects.toThrow('Project name is required')
  })
})
