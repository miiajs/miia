import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ts from 'typescript'
import { ProjectTree } from '../src/codemod/tree.js'
import type { Runtime } from '../src/runtime/types.js'
import { type Addon, addonContext, addons, resolveAddons } from '../src/scaffold/addons.js'
import { type ApplyContext, flavorOf } from '../src/scaffold/apply.js'
import { createProject } from '../src/scaffold/create.js'
import { newProjectLayout } from '../src/scaffold/layout.js'
import { CliError } from '../src/utils/errors.js'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function context(runtime: Runtime): ApplyContext {
  const parent = mkdtempSync(join(tmpdir(), 'miia-addons-'))
  dirs.push(parent)
  return {
    tree: new ProjectTree(join(parent, 'demo-app')),
    ts,
    runtime,
    flavor: flavorOf(runtime),
    projectName: 'demo-app',
    cliVersion: '0.0.0-test',
    random: (bytes) => 'ab'.repeat(bytes),
  }
}

function generate(runtime: Runtime, ids: string[]) {
  const ctx = context(runtime)
  const { warnings } = createProject(ctx, {
    name: 'demo-app',
    dir: ctx.tree.root,
    runtime,
    packageManager: runtime === 'node' ? 'npm' : runtime,
    addons: ids,
    install: false,
    dryRun: false,
  })
  return { ctx, warnings, files: Object.fromEntries(ctx.tree.changes().map((c) => [c.path, c.content])) }
}

const fake = (id: string, extra: Partial<Addon> = {}): Addon => ({
  id,
  label: id,
  hint: '',
  kind: 'feature',
  isInstalled: () => false,
  apply: () => {},
  ...extra,
})

describe('resolveAddons', () => {
  const registry = [
    fake('a', { dependsOn: ['b'] }),
    fake('b', { dependsOn: ['c'] }),
    fake('c'),
    fake('pg', { kind: 'database' }),
    fake('mongo', { kind: 'database' }),
    fake('bun-only', { runtimes: ['bun'] }),
    fake('loop', { dependsOn: ['loop2'] }),
    fake('loop2', { dependsOn: ['loop'] }),
  ]

  it('orders dependencies first and adds them', () => {
    expect(resolveAddons(['a', 'c'], 'bun', registry).map((x) => x.id)).toEqual(['c', 'b', 'a'])
  })

  it('refuses unknown ids, a runtime it does not support, two databases and cycles', () => {
    expect(() => resolveAddons(['nope'], 'bun', registry)).toThrow('Unknown add-on "nope"')
    expect(() => resolveAddons(['bun-only'], 'deno', registry)).toThrow('not available on deno')
    expect(() => resolveAddons(['pg', 'mongo'], 'bun', registry)).toThrow(CliError)
    expect(() => resolveAddons(['loop'], 'bun', registry)).toThrow('cycle')
  })

  it('keeps drizzle-sqlite off Deno', () => {
    expect(() => resolveAddons(['drizzle-sqlite'], 'deno')).toThrow('not available on deno')
  })
})

describe('add-ons', () => {
  const base = {
    bun: generate('bun', []).files,
    node: generate('node', []).files,
  }

  for (const addon of addons) {
    for (const runtime of ['bun', 'node'] as const) {
      it(`${addon.id} on ${runtime}`, () => {
        const { ctx, files, warnings } = generate(runtime, [addon.id])
        expect(warnings).toEqual([])
        // Only what the add-on adds or changes
        const changed = Object.fromEntries(
          Object.entries(files).filter(([path, content]) => base[runtime][path] !== content),
        )
        expect(changed).toMatchSnapshot()

        expect(addon.isInstalled(ctx.tree, newProjectLayout)).toBe(true)
        const before = ctx.tree.changes()
        addon.apply(addonContext(ctx, addon, { layout: newProjectLayout, selected: [addon], warnings: [] }))
        expect(ctx.tree.changes()).toEqual(before)
      })
    }
  }

  it('combine into one project', () => {
    const { files, warnings } = generate('bun', [
      'jwt-auth',
      'swagger',
      'cors',
      'serve-static',
      'rate-limit',
      'biome',
      'drizzle-sqlite',
    ])
    expect(warnings).toEqual([])
    expect(files['src/app/app.module.ts']).toMatchSnapshot()
    expect(files['src/main.ts']).toMatchSnapshot()
    expect(files['src/env.schema.ts']).toMatchSnapshot()
  })
})
