import { afterEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ts from 'typescript'
import { ProjectTree } from '../src/codemod/tree.js'
import { type GenerateOptions, planGenerate } from '../src/generate/runner.js'
import type { Runtime } from '../src/runtime/types.js'
import { flavorOf } from '../src/scaffold/apply.js'
import { createProject } from '../src/scaffold/create.js'
import { CliError } from '../src/utils/errors.js'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

async function project(runtime: Runtime = 'bun', addons: string[] = []): Promise<string> {
  const root = join(mkdtempSync(join(tmpdir(), 'miia-generate-')), 'app')
  dirs.push(join(root, '..'))
  const tree = new ProjectTree(root)
  createProject(
    { tree, ts, runtime, flavor: flavorOf(runtime), projectName: 'app', cliVersion: '0.0.0-test', random: () => 'x' },
    {
      name: 'app',
      dir: root,
      runtime,
      packageManager: runtime === 'node' ? 'npm' : runtime,
      addons,
      install: false,
      dryRun: false,
    },
  )
  await tree.commit()
  return root
}

function generate(cwd: string, options: Omit<GenerateOptions, 'dryRun'>) {
  const { tree, warnings, next } = planGenerate(options, { cwd, ts, cliVersion: '0.0.0-test' })
  const files = Object.fromEntries(tree.changes().map((c) => [c.path, c.content]))
  return { tree, warnings, next, files }
}

const APP_MODULE = 'src/app/app.module.ts'

describe('miia g', () => {
  for (const schematic of ['module', 'controller', 'service', 'guard', 'middleware', 'resource']) {
    it(`${schematic}: files and the parent module`, async () => {
      const { files, warnings } = generate(await project(), { schematic, name: 'user-profile' })
      expect(warnings).toEqual([])
      expect(files).toMatchSnapshot()
    })
  }

  it('resource: UUID ids, in memory, no database needed', async () => {
    const { files } = generate(await project(), { schematic: 'resource', name: 'widgets' })
    expect(files['src/widgets/widgets.types.ts']).toContain('id: string')
    expect(files['src/widgets/widgets.service.ts']).toContain('id: crypto.randomUUID()')
    expect(files['src/widgets/schemas/widgets-id-params.schema.ts']).toContain('id: z.uuid()')
    expect(files['src/widgets/widgets.test.ts']).toContain('`/widgets/${crypto.randomUUID()}`')
    expect(files['src/widgets/widgets.test.ts']).toContain("'/widgets/999')).status).toBe(422)")
  })

  it('does not register guards and middleware', async () => {
    const root = await project()
    const paths = (schematic: string) => Object.keys(generate(root, { schematic, name: 'admin' }).files)
    expect(paths('guard')).toEqual(['src/common/guards/admin.guard.ts'])
    expect(paths('middleware')).toEqual(['src/common/middleware/admin.middleware.ts'])
  })

  it('puts guards and middleware into src/common/ unless the name or --path picks a folder', async () => {
    const root = await project()
    const paths = (options: Omit<GenerateOptions, 'dryRun'>) => Object.keys(generate(root, options).files)
    expect(paths({ schematic: 'guard', name: 'admin', flat: true })).toEqual(['src/common/guards/admin.guard.ts'])
    expect(paths({ schematic: 'guard', name: 'users/admin' })).toEqual(['src/users/admin.guard.ts'])
    expect(paths({ schematic: 'guard', name: 'admin', path: 'users' })).toEqual(['src/users/admin.guard.ts'])
    expect(paths({ schematic: 'guard', name: 'admin/roles', path: 'core' })).toEqual(['src/core/admin/roles.guard.ts'])
    expect(paths({ schematic: 'middleware', name: 'timing', path: 'http' })).toEqual(['src/http/timing.middleware.ts'])
  })

  it('--export adds a service to exports', async () => {
    const { files } = generate(await project(), { schematic: 's', name: 'audit', export: true })
    expect(files[APP_MODULE]).toContain('  providers: [AppService, AuditService],\n  exports: [AuditService],\n')
  })

  it('--export with anything but a service is an error', async () => {
    const root = await project()
    expect(() => generate(root, { schematic: 'controller', name: 'x', export: true })).toThrow(CliError)
    expect(() => generate(root, { schematic: 'guard', name: 'x', export: true })).toThrow(
      '--export works with service only',
    )
  })

  it('registers a resource in imports of the root module', async () => {
    const { files } = generate(await project(), { schematic: 'r', name: 'widgets' })
    expect(files[APP_MODULE]).toContain("import { WidgetsModule } from '../widgets/widgets.module.js'")
    expect(files[APP_MODULE]).toContain(
      'imports: [ConfigModule.configure({ schema: envSchema }, { global: true }), WidgetsModule]',
    )
    expect(files['src/widgets/widgets.module.ts']).toContain('exports: [WidgetsService]')
  })

  it('writes the resource test for node:test on Node.js', async () => {
    const { files } = generate(await project('node'), { schematic: 'resource', name: 'widgets' })
    const test = files['src/widgets/widgets.test.ts']
    expect(test).toContain("import { describe, it } from 'node:test'\nimport { expect } from 'expect'")
    expect(test).not.toContain('bun:test')
  })

  it('places files by --flat, a path in the name and --path', async () => {
    const root = await project()
    expect(Object.keys(generate(root, { schematic: 's', name: 'audit', flat: true }).files)).toContain(
      'src/audit.service.ts',
    )
    expect(Object.keys(generate(root, { schematic: 's', name: 'admin/audit' }).files)).toContain(
      'src/admin/audit.service.ts',
    )
    expect(Object.keys(generate(root, { schematic: 's', name: 'audit', path: 'core' }).files)).toContain(
      'src/core/audit/audit.service.ts',
    )
    expect(Object.keys(generate(root, { schematic: 'r', name: 'widgets', flat: true }).files)).toContain(
      'src/widgets/widgets.module.ts',
    )
  })

  it('rejects names and paths outside the rules', async () => {
    const root = await project()
    expect(() => generate(root, { schematic: 's', name: 'user.profile' })).toThrow(CliError)
    expect(() => generate(root, { schematic: 's', name: 'audit', path: '../x' })).toThrow(
      '--path must stay inside src/',
    )
    expect(() => generate(root, { schematic: 'nope', name: 'x' })).toThrow('Unknown schematic "nope"')
  })

  it('refuses an existing file and writes nothing', async () => {
    const root = await project()
    await generate(root, { schematic: 'service', name: 'audit' }).tree.commit()
    const moduleBefore = readFileSync(join(root, APP_MODULE), 'utf-8')
    expect(() => generate(root, { schematic: 'service', name: 'audit' })).toThrow(
      'These files already exist:\n  src/audit/audit.service.ts',
    )
    expect(readFileSync(join(root, APP_MODULE), 'utf-8')).toBe(moduleBefore)
  })

  it('plans without writing (--dry-run prints the same set)', async () => {
    const root = await project()
    const { tree } = generate(root, { schematic: 'resource', name: 'widgets' })
    expect(tree.summary()).toEqual([
      'UPDATE src/app/app.module.ts',
      'CREATE src/widgets/schemas/create-widgets.schema.ts',
      'CREATE src/widgets/schemas/update-widgets.schema.ts',
      'CREATE src/widgets/schemas/widgets-id-params.schema.ts',
      'CREATE src/widgets/widgets.controller.ts',
      'CREATE src/widgets/widgets.module.ts',
      'CREATE src/widgets/widgets.service.ts',
      'CREATE src/widgets/widgets.test.ts',
      'CREATE src/widgets/widgets.types.ts',
    ])
    expect(existsSync(join(root, 'src/widgets'))).toBe(false)
  })

  it('picks the module main.ts registers when src/ holds several', async () => {
    const root = await project()
    rmSync(join(root, 'src/app'), { recursive: true })
    writeFileSync(
      join(root, 'src/admin.module.ts'),
      "import { Module } from '@miiajs/core'\n\n@Module({})\nexport class AdminModule {}\n",
    )
    writeFileSync(
      join(root, 'src/root.module.ts'),
      "import { Module } from '@miiajs/core'\n\n@Module({})\nexport class RootModule {}\n",
    )
    writeFileSync(
      join(root, 'src/main.ts'),
      "import { Miia } from '@miiajs/core'\nimport { RootModule } from './root.module.js'\n\nawait new Miia().register(RootModule).listen(3000)\n",
    )
    const { files } = generate(root, { schematic: 's', name: 'audit', flat: true })
    expect(Object.keys(files).sort()).toEqual(['src/audit.service.ts', 'src/root.module.ts'])
  })

  it('needs src/', () => {
    const root = mkdtempSync(join(tmpdir(), 'miia-generate-'))
    dirs.push(root)
    expect(() => generate(root, { schematic: 's', name: 'x' })).toThrow('no src/ found')
  })

  it('has no next steps outside a table', async () => {
    const root = await project('bun', ['drizzle-postgres'])
    expect(generate(root, { schematic: 'resource', name: 'widgets' }).next).toEqual([])
    expect(generate(root, { schematic: 'guard', name: 'admin' }).next).toEqual([])
    // No parent module to register in: the third way out of planGenerate
    rmSync(join(root, 'src/app'), { recursive: true })
    writeFileSync(join(root, 'src/main.ts'), '')
    const orphan = generate(root, { schematic: 's', name: 'audit' })
    expect(orphan.warnings).toEqual(['No parent module found. Register AuditService manually.'])
    expect(orphan.next).toEqual([])
  })
})

describe('miia g table', () => {
  const SCHEMA = 'src/db.schema.ts'
  const paths = (files: Record<string, string>) => Object.keys(files).sort()
  const editConfig = (root: string, from: string | RegExp, to: string) => {
    const path = join(root, 'drizzle.config.ts')
    writeFileSync(path, readFileSync(path, 'utf-8').replace(from, to))
  }

  const dialects = [
    ['drizzle-postgres', "pgTable('user_profile'", "from 'drizzle-orm/pg-core'"],
    ['drizzle-mysql', "mysqlTable('user_profile'", "from 'drizzle-orm/mysql-core'"],
    ['drizzle-sqlite', "sqliteTable('user_profile'", "from 'drizzle-orm/sqlite-core'"],
  ] as const

  for (const [addon, table, from] of dialects) {
    it(`${addon}: the table, its line in the schema barrel and the next steps`, async () => {
      const { files, warnings, next } = generate(await project('bun', [addon]), {
        schematic: 'table',
        name: 'user-profile',
      })
      expect(warnings).toEqual([])
      expect(paths(files)).toEqual([SCHEMA, 'src/user-profile/user-profile.table.ts'])
      const file = files['src/user-profile/user-profile.table.ts']
      expect(file).toContain(`export const userProfile = ${table}`)
      expect(file).toContain(from)
      expect(file).toContain('export type UserProfile = typeof userProfile.$inferSelect')
      expect(file).toContain('export type NewUserProfile = typeof userProfile.$inferInsert')
      expect(file).toMatchSnapshot()
      expect(files[SCHEMA]).toBe(
        "// Every table, for DrizzleModule and `typeof schema` in db.ts: `miia g table <name>` adds a line here\nexport * from './user-profile/user-profile.table.js'\n",
      )
      expect(next).toEqual(['bun run db:generate', 'bun run db:migrate'])
    })
  }

  it('adds a second table after the first', async () => {
    const root = await project('bun', ['drizzle-sqlite'])
    await generate(root, { schematic: 'table', name: 'posts' }).tree.commit()
    const { files } = generate(root, { schematic: 'table', name: 'comments' })
    expect(files[SCHEMA]).toEndWith(
      "export * from './posts/posts.table.js'\nexport * from './comments/comments.table.js'\n",
    )
  })

  it('places the file by --flat, a path in the name and --path', async () => {
    const root = await project('bun', ['drizzle-sqlite'])
    const place = (options: Omit<GenerateOptions, 'dryRun' | 'schematic'>) =>
      generate(root, { schematic: 'table', ...options }).files
    expect(paths(place({ name: 'posts', flat: true }))).toEqual(['src/db.schema.ts', 'src/posts.table.ts'])
    expect(place({ name: 'posts', flat: true })[SCHEMA]).toContain("export * from './posts.table.js'")
    expect(paths(place({ name: 'admin/posts' }))).toEqual(['src/admin/posts.table.ts', SCHEMA])
    expect(place({ name: 'admin/posts' })[SCHEMA]).toContain("export * from './admin/posts.table.js'")
    expect(paths(place({ name: 'posts', path: 'core' }))).toEqual(['src/core/posts/posts.table.ts', SCHEMA])
    expect(place({ name: 'posts', path: 'core' })[SCHEMA]).toContain("export * from './core/posts/posts.table.js'")
  })

  it('needs drizzle.config.ts', async () => {
    const root = await project()
    const run = () => generate(root, { schematic: 'table', name: 'posts' })
    expect(run).toThrow(CliError)
    expect(run).toThrow('miia g table needs a Drizzle project: no drizzle.config.ts found')
  })

  it('refuses another dialect and a dialect it cannot read', async () => {
    const root = await project('bun', ['drizzle-postgres'])
    const run = () => generate(root, { schematic: 'table', name: 'posts' })

    editConfig(root, "dialect: 'postgresql'", "dialect: 'turso'")
    expect(run).toThrow(CliError)
    expect(run).toThrow('not with the turso dialect')

    editConfig(root, "dialect: 'turso'", 'dialect: process.env.DIALECT')
    expect(run).toThrow(CliError)
    expect(run).toThrow('needs dialect as a string')

    writeFileSync(join(root, 'drizzle.config.ts'), 'export default {}\n')
    expect(run).toThrow('needs dialect as a string')
  })

  it('reads the dialect in any quotes and from an object outside defineConfig', async () => {
    const root = await project('bun', ['drizzle-postgres'])
    writeFileSync(
      join(root, 'drizzle.config.ts'),
      'const config = { dialect: "sqlite", schema: "./src/db.schema.ts" };\nexport default config;\n',
    )
    const { files, warnings } = generate(root, { schematic: 'table', name: 'posts' })
    expect(warnings).toEqual([])
    expect(files['src/posts/posts.table.ts']).toContain('sqliteTable')
  })

  it('warns when the schema is not one file in the project, and still writes the table', async () => {
    const manual = 'Add src/posts/posts.table.ts to your Drizzle schema manually'
    const schemas = [
      "schema: ['./src/a.ts', './src/b.ts']",
      "schema: './src/**/*.table.ts'",
      "schema: '../shared/schema.ts'",
      "schema: './src/../../shared/schema.ts'",
      "schema: '/abs/schema.ts'",
      "schema: 'C:/abs/schema.ts'",
      'schema: process.env.SCHEMA!',
      "schema: './src/missing.ts'",
    ]
    for (const schema of schemas) {
      const root = await project('bun', ['drizzle-postgres'])
      editConfig(root, "schema: './src/db.schema.ts'", schema)
      const { files, warnings } = generate(root, { schematic: 'table', name: 'posts' })
      expect(warnings).toEqual([manual])
      expect(paths(files)).toEqual(['src/posts/posts.table.ts'])
    }
  })

  it('warns without a schema key', async () => {
    const root = await project('bun', ['drizzle-postgres'])
    editConfig(root, "  schema: './src/db.schema.ts',\n", '')
    expect(generate(root, { schematic: 'table', name: 'posts' }).warnings).toEqual([
      'Add src/posts/posts.table.ts to your Drizzle schema manually',
    ])
  })

  it('edits the file the config names, wherever it is', async () => {
    const root = await project('bun', ['drizzle-postgres'])
    mkdirSync(join(root, 'db'))
    writeFileSync(join(root, 'db/schema.ts'), "export * from '../src/other.table'\n")
    editConfig(root, "schema: './src/db.schema.ts'", "schema: './db/./schema.ts'")
    const { files, warnings } = generate(root, { schematic: 'table', name: 'posts' })
    expect(warnings).toEqual([])
    expect(files['db/schema.ts']).toBe("export * from '../src/other.table'\nexport * from '../src/posts/posts.table'\n")
  })

  it('refuses a reserved word and a name the table file imports, and writes nothing', async () => {
    const root = await project('bun', ['drizzle-sqlite'])
    const barrel = readFileSync(join(root, SCHEMA), 'utf-8')
    const run = (name: string) => () => generate(root, { schematic: 'table', name })
    for (const name of ['class', 'package', 'enum', 'Class', 'admin/new']) {
      expect(run(name)).toThrow(CliError)
      expect(run(name)).toThrow('the word is reserved')
    }
    expect(run('text')).toThrow(CliError)
    expect(run('text')).toThrow('imports text from drizzle-orm/sqlite-core')
    expect(run('integer')).toThrow('imports integer from drizzle-orm/sqlite-core')
    expect(run('sqlite-table')).toThrow('imports sqliteTable from drizzle-orm/sqlite-core')
    expect(existsSync(join(root, 'src/class'))).toBe(false)
    expect(readFileSync(join(root, SCHEMA), 'utf-8')).toBe(barrel)
  })

  it('checks the imports of the dialect in use', async () => {
    const postgres = await project('bun', ['drizzle-postgres'])
    expect(() => generate(postgres, { schematic: 'table', name: 'uuid' })).toThrow('imports uuid')
    expect(() => generate(postgres, { schematic: 'table', name: 'integer' })).not.toThrow()
    const mysql = await project('bun', ['drizzle-mysql'])
    expect(() => generate(mysql, { schematic: 'table', name: 'varchar' })).toThrow('imports varchar')
    expect(() => generate(mysql, { schematic: 'table', name: 'text' })).not.toThrow()
  })

  it('lists only the scripts the project has, with its package manager', async () => {
    const root = await project('node', ['drizzle-postgres'])
    const table = () => generate(root, { schematic: 'table', name: 'posts' }).next
    expect(table()).toEqual(['npm run db:generate', 'npm run db:migrate'])

    writeFileSync(join(root, 'pnpm-lock.yaml'), '')
    expect(table()).toEqual(['pnpm db:generate', 'pnpm db:migrate'])

    const pkgPath = join(root, 'package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
    delete pkg.scripts['db:migrate']
    writeFileSync(pkgPath, JSON.stringify(pkg))
    expect(table()).toEqual(['pnpm db:generate'])

    delete pkg.scripts['db:generate']
    writeFileSync(pkgPath, JSON.stringify(pkg))
    expect(table()).toEqual([])
  })

  it('refuses a table that exists and leaves the barrel alone', async () => {
    const root = await project('bun', ['drizzle-sqlite'])
    await generate(root, { schematic: 'table', name: 'posts' }).tree.commit()
    const barrel = readFileSync(join(root, SCHEMA), 'utf-8')
    expect(() => generate(root, { schematic: 'table', name: 'posts' })).toThrow(
      'These files already exist:\n  src/posts/posts.table.ts',
    )
    expect(readFileSync(join(root, SCHEMA), 'utf-8')).toBe(barrel)
  })

  it('--export is for services only', async () => {
    const root = await project('bun', ['drizzle-sqlite'])
    expect(() => generate(root, { schematic: 'table', name: 'posts', export: true })).toThrow(
      '--export works with service only, not with table',
    )
  })
})
