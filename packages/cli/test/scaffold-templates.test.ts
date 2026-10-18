import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ts from 'typescript'
import { ProjectTree } from '../src/codemod/tree.js'
import { type ApplyContext, applyTemplate } from '../src/scaffold/apply.js'
import {
  fillPlaceholders,
  outputPath,
  readLayers,
  readManifest,
  replaceIdentifiers,
} from '../src/scaffold/templates.js'
import { CliError } from '../src/utils/errors.js'

const dirs: string[] = []

function tempDir(files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'miia-templates-'))
  dirs.push(root)
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  return root
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function context(root: string, runtime: 'bun' | 'node' = 'bun'): ApplyContext {
  return {
    tree: new ProjectTree(root),
    ts,
    runtime,
    flavor: runtime === 'bun' ? 'bun' : 'node',
    projectName: 'demo',
    cliVersion: '0.0.0-test',
    random: () => 'r',
  }
}

describe('readLayers', () => {
  const templates = () =>
    tempDir({
      'base/files/a.ts': 'base a',
      'base/files/b.ts': 'base b',
      'base/files-bun/a.ts': 'bun a',
      'base/files-node/a.ts': 'node a',
      'rt/files/b.ts': 'runtime b',
      'rt/files-node/c.ts': 'node c',
    })

  it('layers files-<flavor> over files/ and later folders over earlier ones', () => {
    const root = templates()
    expect(readLayers(['base', 'rt'], 'bun', root)).toEqual([
      { path: 'a.ts', content: 'bun a' },
      { path: 'b.ts', content: 'runtime b' },
    ])
    expect(readLayers(['base', 'rt'], 'node', root)).toEqual([
      { path: 'a.ts', content: 'node a' },
      { path: 'b.ts', content: 'runtime b' },
      { path: 'c.ts', content: 'node c' },
    ])
  })

  it('lets the node runtime replace the base main.ts', () => {
    const main = readLayers(['base', 'runtimes/node'], 'node').find((f) => f.path === 'src/main.ts')
    expect(main?.content).toContain("import { serve } from '@miiajs/node-server'")
    const bunMain = readLayers(['base', 'runtimes/bun'], 'bun').find((f) => f.path === 'src/main.ts')
    expect(bunMain?.content).not.toContain('node-server')
  })

  it('throws on an unknown template folder', () => {
    expect(() => readLayers(['nope'], 'bun', templates())).toThrow('Unknown template: nope')
  })
})

describe('readManifest', () => {
  it('puts manifest-<flavor>.json on top, moving packages between sections', () => {
    const root = tempDir({
      'db/manifest.json': JSON.stringify({
        dependencies: { 'drizzle-orm': '^0.45.2' },
        devDependencies: { 'better-sqlite3': '^12.0.0', 'drizzle-kit': '^0.31.10' },
        scripts: { 'db:migrate': 'drizzle-kit migrate', 'db:generate': 'drizzle-kit generate' },
      }),
      'db/manifest-node.json': JSON.stringify({
        dependencies: { 'better-sqlite3': '^12.4.1' },
      }),
      'db/manifest-bun.json': JSON.stringify({ scripts: { 'db:migrate': 'bun src/db/migrate.ts' } }),
    })
    expect(readManifest('db', 'node', root)).toEqual({
      dependencies: { 'drizzle-orm': '^0.45.2', 'better-sqlite3': '^12.4.1' },
      devDependencies: { 'drizzle-kit': '^0.31.10' },
      scripts: { 'db:migrate': 'drizzle-kit migrate', 'db:generate': 'drizzle-kit generate' },
    })
    expect(readManifest('db', 'bun', root)?.scripts).toEqual({
      'db:migrate': 'bun src/db/migrate.ts',
      'db:generate': 'drizzle-kit generate',
    })
  })

  it('returns null without manifests and takes a lone flavor manifest', () => {
    const root = tempDir({ 'a/files/x.ts': '', 'b/manifest-bun.json': '{ "scripts": { "x": "y" } }' })
    expect(readManifest('a', 'bun', root)).toBeNull()
    expect(readManifest('b', 'bun', root)).toEqual({ scripts: { x: 'y' } })
    expect(readManifest('b', 'node', root)).toBeNull()
  })
})

describe('names and placeholders', () => {
  it('outputPath maps only the listed dotfile names', () => {
    expect(outputPath('_gitignore')).toBe('.gitignore')
    expect(outputPath('_env.example')).toBe('.env.example')
    expect(outputPath('public/_gitignore')).toBe('public/.gitignore')
    expect(outputPath('__file__.module.ts')).toBe('__file__.module.ts')
    expect(outputPath('_other')).toBe('_other')
  })

  it('replaceIdentifiers covers contents and paths', () => {
    const values = { __Name__: 'UserProfile', __name__: 'userProfile', __file__: 'user-profile' }
    expect(replaceIdentifiers('export class __Name__Service { __name__ = 1 } // __file__', values)).toBe(
      'export class UserProfileService { userProfile = 1 } // user-profile',
    )
    expect(replaceIdentifiers('__file__/__file__.module.ts', values)).toBe('user-profile/user-profile.module.ts')
  })

  it('fillPlaceholders touches only known {{key}}', () => {
    const text = '# {{name}} {{run:dev}} {{unknown}} ${name} __Name__'
    expect(fillPlaceholders(text, { name: 'app', 'run:dev': 'bun run dev' })).toBe(
      '# app bun run dev {{unknown}} ${name} __Name__',
    )
  })
})

describe('applyTemplate', () => {
  it('skips files with identical content and keeps package.json as it is', () => {
    const ctx = context(tempDir({ 'package.json': '{}\n' }), 'node')
    applyTemplate(ctx, 'runtimes/node')
    const before = ctx.tree.changes()
    expect(before.map((c) => c.path)).toEqual(['package.json', 'src/main.ts', 'tsconfig.build.json'])
    expect(applyTemplate(ctx, 'runtimes/node')).toEqual([])
    expect(ctx.tree.changes()).toEqual(before)
  })

  it('reports every conflicting file in one error and creates nothing', () => {
    const root = tempDir({ 'src/main.ts': 'mine', 'README.md': 'mine', 'package.json': '{}' })
    const ctx = context(root)
    let error: unknown
    try {
      applyTemplate(ctx, 'base')
    } catch (err) {
      error = err
    }
    expect(error).toBeInstanceOf(CliError)
    expect((error as Error).message).toBe(
      'These files already exist with different content:\n  README.md\n  package.json\n  src/main.ts',
    )
    expect(ctx.tree.changes()).toEqual([])
  })

  it('writes into a target folder with identifiers and turns tests into node:test for the node flavor', () => {
    const ctx = context(tempDir({ 'package.json': '{}' }), 'node')
    applyTemplate(ctx, 'base', { target: 'nested', identifiers: { Hello: 'Bye' } })
    expect(ctx.tree.read('nested/src/app/app.service.ts')).toContain("return 'Bye, Miia!'")
    const test = ctx.tree.read('nested/src/app/app.test.ts') ?? ''
    expect(test).toContain("import { describe, it } from 'node:test'\nimport { expect } from 'expect'")
    expect(test).not.toContain('bun:test')
  })

  it('merges the manifest with workspace:* turned into ^cliVersion and warns on script clashes', () => {
    const ctx = context(tempDir({ 'package.json': '{ "scripts": { "test": "vitest" } }\n' }))
    const warnings = applyTemplate(ctx, ['base', 'runtimes/bun'], { target: 'x' })
    expect(warnings).toEqual(['package.json already has a "test" script; kept it'])
    const pkg = JSON.parse(ctx.tree.read('package.json') ?? '')
    expect(pkg.dependencies['@miiajs/core']).toBe('^0.0.0-test')
    expect(pkg.scripts.test).toBe('vitest')
    expect(pkg.scripts.dev).toBe('miia dev --runtime bun')
  })
})
