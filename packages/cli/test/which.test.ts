import { afterEach, describe, expect, it } from 'bun:test'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findExecutable, findLocalBin } from '../src/utils/which.js'

const dirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'miia-which-'))
  dirs.push(dir)
  return dir
}

function file(path: string, mode = 0o755): string {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, '')
  chmodSync(path, mode)
  return path
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('findExecutable', () => {
  it('walks PATH in order', () => {
    const a = tempDir()
    const b = tempDir()
    const expected = file(join(b, 'bun'))
    file(join(tempDir(), 'bun'))
    expect(findExecutable('bun', { env: { PATH: `${a}:${b}` }, platform: 'linux' })).toBe(expected)
  })

  it('returns null when nothing matches', () => {
    expect(findExecutable('bun', { env: { PATH: tempDir() }, platform: 'linux' })).toBeNull()
    expect(findExecutable('bun', { env: {}, platform: 'linux' })).toBeNull()
  })

  it('skips files without the execute bit on posix', () => {
    const dir = tempDir()
    file(join(dir, 'deno'), 0o644)
    expect(findExecutable('deno', { env: { PATH: dir }, platform: 'linux' })).toBeNull()
  })

  it('skips directories', () => {
    const dir = tempDir()
    mkdirSync(join(dir, 'tsc'))
    expect(findExecutable('tsc', { env: { PATH: dir }, platform: 'linux' })).toBeNull()
  })

  it('resolves relative PATH entries against cwd', () => {
    const root = tempDir()
    const expected = file(join(root, 'bin', 'bun'))
    expect(findExecutable('bun', { env: { PATH: 'bin' }, platform: 'linux', cwd: root })).toBe(expected)
  })

  describe('win32', () => {
    it('splits PATH on ";" and tries PATHEXT', () => {
      const a = tempDir()
      const b = tempDir()
      const expected = file(join(b, 'bun.exe'), 0o644)
      expect(findExecutable('bun', { env: { Path: `${a};${b}`, PATHEXT: '.COM;.EXE;.CMD' }, platform: 'win32' })).toBe(
        expected,
      )
    })

    it('compares extensions case-insensitively', () => {
      const dir = tempDir()
      const expected = file(join(dir, 'tsc.cmd'), 0o644)
      expect(findExecutable('tsc', { env: { PATH: dir, PATHEXT: '.EXE;.CMD' }, platform: 'win32' })).toBe(expected)
    })

    it('ignores extensionless shell shims', () => {
      const dir = tempDir()
      file(join(dir, 'tsc'))
      expect(findExecutable('tsc', { env: { PATH: dir, PATHEXT: '.EXE;.CMD' }, platform: 'win32' })).toBeNull()
    })

    it('accepts a name that already carries an extension', () => {
      const dir = tempDir()
      const expected = file(join(dir, 'bun.exe'), 0o644)
      expect(findExecutable('bun.exe', { env: { PATH: dir, PATHEXT: '.EXE' }, platform: 'win32' })).toBe(expected)
    })
  })
})

describe('findLocalBin', () => {
  it('finds node_modules/.bin in a parent directory', () => {
    const root = tempDir()
    const expected = file(join(root, 'node_modules', '.bin', 'biome'))
    const nested = join(root, 'src', 'app')
    mkdirSync(nested, { recursive: true })
    expect(findLocalBin(nested, 'biome', 'linux')).toBe(expected)
  })

  it('prefers the nearest node_modules', () => {
    const root = tempDir()
    file(join(root, 'node_modules', '.bin', 'tsc'))
    const expected = file(join(root, 'app', 'node_modules', '.bin', 'tsc'))
    expect(findLocalBin(join(root, 'app'), 'tsc', 'linux')).toBe(expected)
  })

  it('requires the execute bit on posix', () => {
    const root = tempDir()
    file(join(root, 'node_modules', '.bin', 'tsc'), 0o644)
    expect(findLocalBin(root, 'tsc', 'linux')).toBeNull()
  })

  it('finds .cmd and .exe shims on win32', () => {
    const root = tempDir()
    const cmd = file(join(root, 'node_modules', '.bin', 'biome.cmd'), 0o644)
    expect(findLocalBin(root, 'biome', 'win32')).toBe(cmd)
    const exe = file(join(root, 'node_modules', '.bin', 'tsc.exe'), 0o644)
    expect(findLocalBin(root, 'tsc', 'win32')).toBe(exe)
  })
})
