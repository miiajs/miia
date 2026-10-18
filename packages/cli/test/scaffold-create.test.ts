import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ts from 'typescript'
import { ProjectTree } from '../src/codemod/tree.js'
import type { Runtime } from '../src/runtime/types.js'
import { type ApplyContext, flavorOf } from '../src/scaffold/apply.js'
import { createProject } from '../src/scaffold/create.js'
import type { NewOptions } from '../src/scaffold/options.js'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function generate(runtime: Runtime, packageManager: NewOptions['packageManager']) {
  const parent = mkdtempSync(join(tmpdir(), 'miia-create-'))
  dirs.push(parent)
  const dir = join(parent, 'demo-app')
  const ctx: ApplyContext = {
    tree: new ProjectTree(dir),
    ts,
    runtime,
    flavor: flavorOf(runtime),
    projectName: 'demo-app',
    cliVersion: '0.0.0-test',
    random: (bytes) => 'ab'.repeat(bytes),
  }
  const result = createProject(ctx, {
    name: 'demo-app',
    dir,
    runtime,
    packageManager,
    addons: [],
    install: false,
    dryRun: false,
  })
  return { ctx, result, files: Object.fromEntries(ctx.tree.changes().map((c) => [c.path, c.content])) }
}

describe('createProject', () => {
  for (const [runtime, pm] of [
    ['bun', 'bun'],
    ['node', 'npm'],
    ['deno', 'deno'],
  ] as const) {
    it(`generates the base project for ${runtime}`, () => {
      const { files, result, ctx } = generate(runtime, pm)
      expect(result.warnings).toEqual([])
      expect(ctx.tree.changes().every((c) => c.kind === 'create')).toBe(true)
      expect(files).toMatchSnapshot()

      const pkg = JSON.parse(files['package.json'])
      expect(pkg.name).toBe('demo-app')
      const versions = { ...pkg.dependencies, ...pkg.devDependencies } as Record<string, string>
      for (const [name, range] of Object.entries(versions)) {
        if (name.startsWith('@miiajs/')) expect(range).toBe('^0.0.0-test')
        expect(range).not.toContain('workspace:')
      }
      expect(files['.env']).toBe(files['.env.example'])
    })
  }

  it('pins the runtime in scripts and adds runtime-specific files', () => {
    const node = generate('node', 'npm').files
    expect(JSON.parse(node['package.json']).scripts.dev).toBe('miia dev --runtime node')
    expect(JSON.parse(node['tsconfig.json']).compilerOptions.types).toEqual(['node'])
    expect(node['tsconfig.build.json']).toBeDefined()
    expect(node['src/app/app.test.ts']).toContain("from 'node:test'")

    const deno = generate('deno', 'deno').files
    expect(JSON.parse(deno['deno.json'])).toEqual({ unstable: ['sloppy-imports'] })
    expect(deno['README.md']).toContain('deno task dev')

    const bun = generate('bun', 'bun').files
    expect(JSON.parse(bun['tsconfig.json']).compilerOptions.types).toEqual(['bun'])
    expect(bun['src/app/app.test.ts']).toContain("from 'bun:test'")
    expect(bun['tsconfig.build.json']).toBeUndefined()
  })
})
