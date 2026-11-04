import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ts from 'typescript'
import { ProjectTree } from '../src/codemod/tree.js'
import type { PackageManager } from '../src/runtime/package-manager.js'
import type { Runtime } from '../src/runtime/types.js'
import { type Addon, addonContext, addons, findAddon, resolveAddons } from '../src/scaffold/addons.js'
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

function generate(runtime: Runtime, ids: string[], packageManager?: PackageManager) {
  const ctx = context(runtime)
  const { warnings, next } = createProject(ctx, {
    name: 'demo-app',
    dir: ctx.tree.root,
    runtime,
    packageManager: packageManager ?? (runtime === 'node' ? 'npm' : runtime),
    addons: ids,
    install: false,
    dryRun: false,
  })
  return { ctx, warnings, next, files: Object.fromEntries(ctx.tree.changes().map((c) => [c.path, c.content])) }
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

  it('puts the database first and keeps the rest in order', () => {
    expect(resolveAddons(['a', 'pg'], 'bun', registry).map((x) => x.id)).toEqual(['pg', 'c', 'b', 'a'])
    expect(resolveAddons(['c', 'mongo', 'bun-only'], 'bun', registry).map((x) => x.id)).toEqual([
      'mongo',
      'c',
      'bun-only',
    ])
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

describe('addonContext', () => {
  const installed = fake('installed', { isInstalled: () => true })
  const fresh = fake('fresh')
  const other = fake('other')
  const registry = [installed, fresh, other]
  const subject = () =>
    addonContext(context('bun'), other, {
      layout: newProjectLayout,
      selected: [installed, fresh],
      warnings: [],
      registry,
    })

  it('adding() is true only for what this run selected and is not installed yet', () => {
    expect(subject().adding('fresh')).toBe(true)
    expect(subject().adding('installed')).toBe(false)
    expect(subject().adding('other')).toBe(false)
  })

  it('has() is also true for what is installed', () => {
    expect(subject().has('fresh')).toBe(true)
    expect(subject().has('installed')).toBe(true)
    expect(subject().has('other')).toBe(false)
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

  it('jwt-auth registers UsersModule in the root module, before AuthModule', () => {
    const root = generate('bun', ['jwt-auth']).files['src/app/app.module.ts']
    expect(root).toContain("import { UsersModule } from '../users/users.module.js'")
    expect(root.indexOf('UsersModule,')).toBeGreaterThan(root.indexOf('JwtModule.configure('))
    expect(root.indexOf('UsersModule,')).toBeLessThan(root.indexOf('AuthModule,'))
  })

  it('databases print their next steps with the project package manager', () => {
    expect(generate('bun', ['drizzle-postgres']).next).toEqual([
      'start PostgreSQL with a "demo_app" database (see README)',
      'bunx miia g table posts',
    ])
    expect(generate('bun', ['drizzle-mysql']).next).toEqual([
      'start MySQL with a "demo_app" database (see README)',
      'bunx miia g table posts',
    ])
    expect(generate('bun', ['drizzle-sqlite']).next).toEqual(['bunx miia g table posts'])
    expect(generate('node', ['drizzle-sqlite']).next).toEqual(['npx miia g table posts'])
    expect(generate('node', ['drizzle-mysql'], 'pnpm').next).toContain('pnpm exec miia g table posts')
    expect(generate('node', ['drizzle-mysql'], 'yarn').next).toContain('yarn miia g table posts')
    expect(generate('deno', ['drizzle-postgres']).next).toContain('deno task miia g table posts')
    expect(generate('bun', ['papr']).next).toEqual(['start MongoDB (see README)'])
    expect(generate('bun', ['mongoose']).next).toEqual(['start MongoDB (see README)'])
    expect(generate('bun', ['swagger']).next).toEqual([])
  })

  it('Drizzle add-ons write an empty schema barrel next to src/db.ts', () => {
    for (const id of ['drizzle-postgres', 'drizzle-mysql', 'drizzle-sqlite']) {
      const { files } = generate('bun', [id])
      expect(files['src/db.schema.ts']).toBe(
        '// Every table, for DrizzleModule and `typeof schema` in db.ts: `miia g table <name>` adds a line here\nexport {}\n',
      )
      expect(files['src/db.ts']).toContain("import type * as schema from './db.schema.js'")
      expect(files['drizzle.config.ts']).toContain("schema: './src/db.schema.ts'")
      expect(files['src/app/app.module.ts']).toContain("import * as schema from '../db.schema.js'")
      expect(Object.keys(files).filter((path) => path.startsWith('src/db/'))).toEqual([])
    }
  })

  it('drizzle-sqlite migrates through src/db.migrate.ts on Bun only', () => {
    const bun = generate('bun', ['drizzle-sqlite']).files
    expect(bun['src/db.migrate.ts']).toContain('bun:sqlite')
    expect(JSON.parse(bun['package.json']).scripts['db:migrate']).toBe('bun src/db.migrate.ts')
    expect(bun['README.md']).toContain('through `src/db.migrate.ts` on Bun')

    const node = generate('node', ['drizzle-sqlite']).files
    expect(node['src/db.migrate.ts']).toBeUndefined()
    expect(node['src/db.ts']).toContain('BetterSQLite3Database')
    expect(JSON.parse(node['package.json']).scripts['db:migrate']).toBe('drizzle-kit migrate')
    expect(node['README.md']).not.toContain('db.migrate')
  })

  it('jwt-auth gives users UUID ids in memory', () => {
    const { files } = generate('bun', ['jwt-auth'])
    expect(files['src/users/users.types.ts']).toContain('id: string')
    expect(files['src/users/users.service.ts']).toContain('id: crypto.randomUUID()')
    expect(files['src/auth/providers/jwt-auth.provider.ts']).toContain('findById(payload.sub)')
    expect(files['src/auth/auth.service.ts']).toContain('sub: user.id')
  })

  it('databases add a README section before Next steps, once', () => {
    const { ctx, files } = generate('deno', ['drizzle-postgres'])
    const readme = files['README.md']
    expect(readme).toContain('docker run -d --name demo_app-postgres')
    expect(readme).toContain('deno task miia g table posts\ndeno task db:generate\ndeno task db:migrate')
    expect(readme).toContain('Then start the app:\n\n```bash\ndeno task dev\n```')
    expect(readme).toContain("import { db } from '../db.js'\nimport { posts } from './posts.table.js'")
    expect(readme).toContain('this.db.select().from(posts)')
    expect(readme).toContain('`src/posts/posts.table.ts`')
    expect(readme.indexOf('## Database')).toBeLessThan(readme.indexOf('## Next steps'))

    const addon = addons.find((a) => a.id === 'drizzle-postgres') as Addon
    addon.apply(addonContext(ctx, addon, { layout: newProjectLayout, selected: [addon], warnings: [] }))
    expect(ctx.tree.read('README.md')).toBe(readme)
  })

  describe('jwt-auth with a database', () => {
    const databases = ['drizzle-postgres', 'drizzle-mysql', 'drizzle-sqlite', 'papr', 'mongoose']
    const store = (path: string) =>
      path.startsWith('src/users/') || path === 'src/auth/auth.test.ts' || path === 'src/db.schema.ts'

    for (const id of databases) {
      it(`keeps users in ${id}`, () => {
        // The database goes first whichever way the ids come
        const { ctx, files, warnings } = generate('bun', ['jwt-auth', id])
        expect(warnings).toEqual([])
        expect(Object.fromEntries(Object.entries(files).filter(([path]) => store(path)))).toMatchSnapshot()
        expect(files['src/users/users.service.ts']).not.toContain('In-memory store')
        expect(files['src/auth/auth.test.ts']).toContain('.override(UsersService, fakeUsers())')

        // The barrel was edited, and real runs skip the database through isInstalled: only jwt-auth again
        const addon = findAddon('jwt-auth') as Addon
        const before = ctx.tree.changes()
        addon.apply(addonContext(ctx, addon, { layout: newProjectLayout, selected: [addon], warnings: [] }))
        expect(ctx.tree.changes()).toEqual(before)
      })
    }

    it('still applies the base template and its manifest', () => {
      for (const id of databases) {
        const { files } = generate('bun', [id, 'jwt-auth'])
        expect(files['src/auth/auth.module.ts']).toContain('class AuthModule')
        expect(files['src/users/users.module.ts']).toContain('class UsersModule')
        expect(JSON.parse(files['package.json']).dependencies['@miiajs/jwt']).toBe('^0.0.0-test')
      }
    })

    it('registers the database before JwtModule in the root module', () => {
      const root = generate('bun', ['jwt-auth', 'drizzle-sqlite']).files['src/app/app.module.ts']
      expect(root.indexOf('DrizzleModule.configure(')).toBeGreaterThan(-1)
      expect(root.indexOf('DrizzleModule.configure(')).toBeLessThan(root.indexOf('JwtModule.configure('))
    })

    it('adds the table to the Drizzle barrel, per dialect', () => {
      const tables = { 'drizzle-postgres': 'pgTable', 'drizzle-mysql': 'mysqlTable', 'drizzle-sqlite': 'sqliteTable' }
      for (const [id, table] of Object.entries(tables)) {
        const { files } = generate('bun', ['jwt-auth', id])
        expect(files['src/db.schema.ts']).toBe(
          "// Every table, for DrizzleModule and `typeof schema` in db.ts: `miia g table <name>` adds a line here\nexport * from './users/users.table.js'\n",
        )
        expect(files['src/users/users.table.ts']).toContain(`${table}('users'`)
        expect(files['src/users/users.types.ts']).toContain('typeof users.$inferSelect')
      }
    })

    it('leaves the Mongo types of the base in place', () => {
      for (const id of ['papr', 'mongoose']) {
        const { files } = generate('bun', ['jwt-auth', id])
        expect(files['src/users/users.types.ts']).toBe(generate('bun', ['jwt-auth']).files['src/users/users.types.ts'])
        expect(files['src/users/users.table.ts']).toBeUndefined()
        expect(files['src/db.schema.ts']).toBeUndefined()
        expect(files['src/auth/auth.test.ts']).toContain('.override(UsersModel, {})')
      }
    })

    it('prints the migrations instead of g table', () => {
      expect(generate('bun', ['jwt-auth', 'drizzle-postgres']).next).toEqual([
        'start PostgreSQL with a "demo_app" database (see README)',
        'bun run db:generate',
        'bun run db:migrate',
      ])
      expect(generate('bun', ['jwt-auth', 'drizzle-mysql']).next).toEqual([
        'start MySQL with a "demo_app" database (see README)',
        'bun run db:generate',
        'bun run db:migrate',
      ])
      expect(generate('bun', ['jwt-auth', 'drizzle-sqlite']).next).toEqual([
        'bun run db:generate',
        'bun run db:migrate',
      ])
      expect(generate('node', ['jwt-auth', 'drizzle-sqlite']).next).toEqual([
        'npm run db:generate',
        'npm run db:migrate',
      ])
      expect(generate('deno', ['jwt-auth', 'drizzle-postgres']).next).toContain('deno task db:migrate')
      expect(generate('bun', ['jwt-auth', 'papr']).next).toEqual(['start MongoDB (see README)'])
      expect(generate('bun', ['jwt-auth', 'mongoose']).next).toEqual(['start MongoDB (see README)'])
      expect(generate('bun', ['jwt-auth']).next).toEqual([])
    })

    it('puts creating the tables in the README, before how to add one', () => {
      const postgres = generate('bun', ['jwt-auth', 'drizzle-postgres']).files['README.md']
      const start = 'bun run db:generate\nbun run db:migrate\nbun run dev'
      expect(postgres).toContain(`Then create the tables and start the app:\n\n\`\`\`bash\n${start}\n\`\`\``)
      expect(postgres.indexOf(start)).toBeLessThan(postgres.indexOf('Add a table, then create it in the database:'))

      const sqlite = generate('bun', ['jwt-auth', 'drizzle-sqlite']).files['README.md']
      expect(sqlite).toContain(
        `so there is no server to start. Create the tables and start the app:\n\n\`\`\`bash\n${start}`,
      )
      expect(sqlite).toContain('Add a table, then create it in the database:')

      const plain = generate('bun', ['drizzle-sqlite']).files['README.md']
      expect(plain).not.toContain('Create the tables')
    })

    it('keeps the Node.js layers: scrypt, node:test and better-sqlite3', () => {
      const { ctx, files, warnings } = generate('node', ['jwt-auth', 'drizzle-sqlite'])
      expect(warnings).toEqual([])
      expect(files['src/auth/password.service.ts']).toContain('scrypt')
      expect(files['src/auth/auth.test.ts']).toContain("from 'node:test'")
      expect(files['src/auth/auth.test.ts']).not.toContain('bun:test')
      expect(files['src/users/users.service.ts']).toContain('inject(db)')
      expect(files['src/db.ts']).toContain('BetterSQLite3Database')

      const addon = findAddon('jwt-auth') as Addon
      const before = ctx.tree.changes()
      addon.apply(addonContext(ctx, addon, { layout: newProjectLayout, selected: [addon], warnings: [] }))
      expect(ctx.tree.changes()).toEqual(before)
    })

    it('stays in memory without a database', () => {
      const { files, warnings, next } = generate('bun', ['jwt-auth'])
      expect(warnings).toEqual([])
      expect(next).toEqual([])
      expect(files['src/users/users.service.ts']).toContain('In-memory store')
      expect(files['src/users/users.table.ts']).toBeUndefined()
      expect(files['src/users/users.model.ts']).toBeUndefined()
      expect(files['src/auth/auth.test.ts']).not.toContain('override')
    })
  })

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
