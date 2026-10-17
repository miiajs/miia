import { describe, expect, it } from 'bun:test'
import { mergeDependencies, mergeScripts, type PackageJson, updateJson } from '../src/codemod/json.js'
import { CliError } from '../src/utils/errors.js'

describe('updateJson', () => {
  it('returns the same text when nothing changes', () => {
    const fourSpaces = '{\r\n    "name": "app",\r\n    "dependencies": { "a": "1" }\r\n}'
    expect(
      updateJson<PackageJson>(fourSpaces, 'package.json', (pkg) => mergeDependencies(pkg, 'dependencies', { a: '2' })),
    ).toBe(fourSpaces)
  })

  it('keeps indent, EOL and the final newline', () => {
    const text = '{\r\n    "name": "app"\r\n}\r\n'
    expect(updateJson<PackageJson>(text, 'package.json', (pkg) => (pkg.private = true))).toBe(
      '{\r\n    "name": "app",\r\n    "private": true\r\n}\r\n',
    )
    expect(updateJson<PackageJson>('{\n\t"a": 1\n}', 'x.json', (v) => (v.b = 2))).toBe('{\n\t"a": 1,\n\t"b": 2\n}')
  })

  it('refuses JSONC', () => {
    const text = '{\n  // comment\n  "a": 1\n}\n'
    expect(() => updateJson(text, 'tsconfig.json', () => {})).toThrow(CliError)
    expect(() => updateJson(text, 'tsconfig.json', () => {})).toThrow('Cannot update tsconfig.json: not plain JSON')
  })
})

describe('mergeDependencies', () => {
  it('lets the user version win', () => {
    const pkg: PackageJson = { dependencies: { zod: '^3.0.0' } }
    mergeDependencies(pkg, 'dependencies', { zod: '^4.3.6' })
    expect(pkg.dependencies).toEqual({ zod: '^3.0.0' })
  })

  it('sorts keys only when something was added', () => {
    const untouched: PackageJson = { dependencies: { b: '1', a: '1' } }
    mergeDependencies(untouched, 'dependencies', { b: '2' })
    expect(Object.keys(untouched.dependencies ?? {})).toEqual(['b', 'a'])

    const pkg: PackageJson = { dependencies: { b: '1', a: '1' } }
    mergeDependencies(pkg, 'dependencies', { c: '1' })
    expect(Object.keys(pkg.dependencies ?? {})).toEqual(['a', 'b', 'c'])
  })

  it('creates the section', () => {
    const pkg: PackageJson = { name: 'x' }
    mergeDependencies(pkg, 'devDependencies', { typescript: '^6.0.2' })
    expect(pkg).toEqual({ name: 'x', devDependencies: { typescript: '^6.0.2' } })
  })

  it('does not duplicate a package that is in another section', () => {
    const pkg: PackageJson = { devDependencies: { 'better-sqlite3': '^12.0.0' } }
    mergeDependencies(pkg, 'dependencies', { 'better-sqlite3': '^12.4.0' })
    expect(pkg).toEqual({ devDependencies: { 'better-sqlite3': '^12.0.0' } })
  })

  it('moves it with move: true', () => {
    const pkg: PackageJson = { devDependencies: { 'better-sqlite3': '^12.0.0' }, dependencies: { a: '1' } }
    mergeDependencies(pkg, 'dependencies', { 'better-sqlite3': '^12.4.0' }, { move: true })
    expect(pkg).toEqual({ dependencies: { a: '1', 'better-sqlite3': '^12.0.0' } })
  })
})

describe('mergeScripts', () => {
  it('adds missing scripts and reports conflicting ones', () => {
    const pkg: PackageJson = { scripts: { dev: 'vite', test: 'bun test' } }
    expect(mergeScripts(pkg, { dev: 'miia dev', test: 'bun test', check: 'miia check' })).toEqual(['dev'])
    expect(pkg.scripts).toEqual({ dev: 'vite', test: 'bun test', check: 'miia check' })
  })

  it('creates the section', () => {
    const pkg: PackageJson = {}
    expect(mergeScripts(pkg, { dev: 'miia dev' })).toEqual([])
    expect(pkg.scripts).toEqual({ dev: 'miia dev' })
  })
})
