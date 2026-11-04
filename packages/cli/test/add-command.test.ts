import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ts from 'typescript'
import { ProjectTree } from '../src/codemod/tree.js'
import { addToProject, openProject } from '../src/scaffold/add.js'
import { flavorOf } from '../src/scaffold/apply.js'
import { createProject } from '../src/scaffold/create.js'
import { CliError } from '../src/utils/errors.js'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

async function generated(addons: string[] = []): Promise<string> {
  const root = join(mkdtempSync(join(tmpdir(), 'miia-add-')), 'app')
  dirs.push(join(root, '..'))
  const tree = new ProjectTree(root)
  createProject(
    {
      tree,
      ts,
      runtime: 'bun',
      flavor: flavorOf('bun'),
      projectName: 'app',
      cliVersion: '0.0.0-test',
      random: () => 'x',
    },
    { name: 'app', dir: root, runtime: 'bun', packageManager: 'bun', addons, install: false, dryRun: false },
  )
  await tree.commit()
  return root
}

const open = (root: string) => openProject(root, ts, { cliVersion: '0.0.0-test', random: () => 'secret' })

describe('miia add', () => {
  it('applies add-ons to a project and writes nothing before commit', async () => {
    const root = await generated()
    const moduleBefore = readFileSync(join(root, 'src/app/app.module.ts'), 'utf-8')
    const project = open(root)
    expect([project.ctx.runtime, project.packageManager]).toEqual(['bun', 'bun'])

    const result = addToProject(project, ['swagger', 'cors'])
    expect(result.applied.map((a) => a.id)).toEqual(['swagger', 'cors'])
    expect(result.warnings).toEqual([])
    expect(result.next).toEqual([])
    expect(project.ctx.tree.read('src/app/app.module.ts')).toContain(
      "SwaggerModule.configure({ title: 'app', version: '0.1.0' })",
    )
    expect(readFileSync(join(root, 'src/app/app.module.ts'), 'utf-8')).toBe(moduleBefore)

    await project.ctx.tree.commit()
    expect(readFileSync(join(root, 'src/main.ts'), 'utf-8')).toContain(
      "app.use(cors({ origin: config.get('CORS_ORIGIN') }))",
    )
  })

  it('returns the next steps of a database and adds them to the README', async () => {
    const root = await generated()
    const project = open(root)
    const result = addToProject(project, ['drizzle-postgres'])
    expect(result.next).toEqual(['start PostgreSQL with a "app" database (see README)', 'bunx miia g table posts'])
    expect(project.ctx.tree.read('src/db.schema.ts')).toContain('export {}')
    expect(project.ctx.tree.read('src/db.ts')).toContain("from './db.schema.js'")
    const readme = project.ctx.tree.read('README.md') ?? ''
    expect(readme).toContain('## Database\n\nThe app connects to `DATABASE_URL` in `.env`')
    expect(readme).toContain('bunx miia g table posts\nbun run db:generate\nbun run db:migrate')
    expect(readme.indexOf('## Database')).toBeLessThan(readme.indexOf('## Next steps'))
  })

  it('prints g table with the package manager of the lockfile', async () => {
    const commands = { 'package-lock.json': 'npx miia', 'pnpm-lock.yaml': 'pnpm exec miia', 'yarn.lock': 'yarn miia' }
    for (const [lockfile, command] of Object.entries(commands)) {
      const root = await generated()
      writeFileSync(join(root, lockfile), '')
      expect(addToProject(open(root), ['drizzle-sqlite']).next).toEqual([`${command} g table posts`])
    }
  })

  it('skips what is installed and changes nothing', async () => {
    const root = await generated(['swagger', 'drizzle-postgres'])
    const project = open(root)
    const result = addToProject(project, ['swagger', 'drizzle-postgres'])
    expect(result.applied).toEqual([])
    expect(result.skipped.map((a) => a.id)).toEqual(['drizzle-postgres', 'swagger'])
    expect(project.ctx.tree.changes()).toEqual([])
  })

  it('refuses a second database', async () => {
    const root = await generated(['drizzle-postgres'])
    expect(() => addToProject(open(root), ['drizzle-mysql'])).toThrow('Project already uses @miiajs/drizzle')
    expect(() => addToProject(open(root), ['papr'])).toThrow(CliError)
  })

  it('reads the runtime pinned in scripts.dev', async () => {
    const root = await generated()
    const pkgPath = join(root, 'package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
    pkg.scripts.dev = 'miia dev --runtime node'
    writeFileSync(pkgPath, JSON.stringify(pkg))
    expect(open(root).ctx.flavor).toBe('node')
  })

  it('needs a package.json with @miiajs/core', () => {
    const root = mkdtempSync(join(tmpdir(), 'miia-add-'))
    dirs.push(root)
    expect(() => open(root)).toThrow('Run miia add from the project root')
    mkdirSync(join(root, 'src'))
    writeFileSync(join(root, 'package.json'), '{ "dependencies": { "express": "^5.0.0" } }')
    expect(() => open(root)).toThrow(CliError)
  })

  it('warns instead of guessing in a project it cannot edit', async () => {
    const root = await generated()
    writeFileSync(
      join(root, 'src/app/app.module.ts'),
      "import { Module } from '@miiajs/core'\n\nconst imports = []\n\n@Module({ imports })\nexport class AppModule {}\n",
    )
    rmSync(join(root, '.env'))
    const result = addToProject(open(root), ['jwt-auth'])
    expect(result.warnings).toEqual([
      'No ConfigModule in the root module: add ConfigModule.configure({ schema }, { global: true }) to its imports',
      'Could not edit src/app/app.module.ts: add JwtModule to the imports of the root @Module',
      'Could not edit src/app/app.module.ts: add UsersModule to the imports of the root @Module',
      'Could not edit src/app/app.module.ts: add AuthModule to the imports of the root @Module',
      'No .env file: set JWT_SECRET in your environment',
    ])
  })

  describe('jwt-auth in a project with a database', () => {
    const inMemory = 'In-memory store'
    const addAuth = (root: string) => {
      const project = open(root)
      return { result: addToProject(project, ['jwt-auth']), tree: project.ctx.tree }
    }

    it('keeps users in the Drizzle database of the project', async () => {
      const { result, tree } = addAuth(await generated(['drizzle-postgres']))
      expect(result.warnings).toEqual([])
      expect(result.next).toEqual(['bun run db:generate', 'bun run db:migrate'])
      expect(tree.read('src/users/users.table.ts')).toContain("pgTable('users'")
      expect(tree.read('src/users/users.service.ts')).toContain('inject(db)')
      expect(tree.read('src/db.schema.ts')).toContain("export * from './users/users.table.js'")
      expect(tree.read('src/db.schema.ts')).not.toContain('export {}')
    })

    it('adds the table next to tables that are already in the barrel', async () => {
      const root = await generated(['drizzle-sqlite'])
      writeFileSync(join(root, 'src/db.schema.ts'), "export * from './posts/posts.table.js'\n")
      const { tree } = addAuth(root)
      expect(tree.read('src/db.schema.ts')).toBe(
        "export * from './posts/posts.table.js'\nexport * from './users/users.table.js'\n",
      )
      expect(tree.read('src/users/users.table.ts')).toContain("sqliteTable('users'")
    })

    it('keeps users in the papr or mongoose database of the project', async () => {
      const papr = addAuth(await generated(['papr']))
      expect(papr.result.warnings).toEqual([])
      expect(papr.result.next).toEqual([])
      expect(papr.tree.read('src/users/users.model.ts')).toContain("defineModel('users', usersSchema)")
      expect(papr.tree.read('src/users/users.module.ts')).toContain('PaprModule.register([UsersModel])')
      expect(papr.tree.read('src/users/users.service.ts')).toContain('createIndex({ email: 1 }, { unique: true })')

      const mongoose = addAuth(await generated(['mongoose']))
      expect(mongoose.result.warnings).toEqual([])
      expect(mongoose.result.next).toEqual([])
      expect(mongoose.tree.read('src/users/users.model.ts')).toContain('unique: true')
      expect(mongoose.tree.read('src/users/users.module.ts')).toContain('MongooseModule.register([UsersModel])')
      expect(mongoose.tree.read('src/users/users.service.ts')).toContain('isValidObjectId(id)')
    })

    it('finds Drizzle by the dependency, whatever the quotes in the root module', async () => {
      const root = await generated(['drizzle-postgres'])
      const modulePath = join(root, 'src/app/app.module.ts')
      writeFileSync(modulePath, readFileSync(modulePath, 'utf-8').replace("dialect: 'postgres'", 'dialect: "postgres"'))
      const { result, tree } = addAuth(root)
      expect(result.warnings).toEqual([])
      expect(tree.read('src/users/users.table.ts')).toContain("pgTable('users'")
    })

    it('stays in memory with a warning when drizzle.config.ts names no dialect it knows', async () => {
      const root = await generated(['drizzle-postgres'])
      rmSync(join(root, 'drizzle.config.ts'))
      const { result, tree } = addAuth(root)
      const warning =
        'No postgresql, mysql or sqlite dialect in drizzle.config.ts: src/users/users.service.ts keeps users in memory, move it to the database'
      expect(result.warnings).toEqual([warning])
      expect(result.next).toEqual([])
      expect(tree.read('src/users/users.service.ts')).toContain(inMemory)
      expect(tree.exists('src/users/users.table.ts')).toBe(false)
      expect(tree.read('src/db.schema.ts')).toContain('export {}')

      const other = await generated(['drizzle-postgres'])
      writeFileSync(join(other, 'drizzle.config.ts'), "export default { dialect: 'turso', schema: './s.ts' }\n")
      expect(addAuth(other).result.warnings).toEqual([warning])
    })

    it('warns when src/db.ts is gone, the schema is not one file, or a script is missing', async () => {
      const noDb = await generated(['drizzle-mysql'])
      rmSync(join(noDb, 'src/db.ts'))
      expect(addAuth(noDb).result.warnings).toEqual([
        'No src/db.ts found: src/users/users.service.ts imports the typed Drizzle handle from ../db.js',
      ])

      const glob = await generated(['drizzle-mysql'])
      const configPath = join(glob, 'drizzle.config.ts')
      writeFileSync(
        configPath,
        readFileSync(configPath, 'utf-8').replace("'./src/db.schema.ts'", "'./src/**/*.table.ts'"),
      )
      const globbed = addAuth(glob)
      expect(globbed.result.warnings).toEqual(['Add src/users/users.table.ts to your Drizzle schema manually'])
      expect(globbed.tree.read('src/users/users.service.ts')).toContain('inject(db)')

      const noScript = await generated(['drizzle-mysql'])
      const pkgPath = join(noScript, 'package.json')
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
      delete pkg.scripts['db:migrate']
      writeFileSync(pkgPath, JSON.stringify(pkg))
      expect(addAuth(noScript).result.next).toEqual(['bun run db:generate'])
    })

    it('refuses a users table that is already there, and writes nothing', async () => {
      const root = await generated(['drizzle-postgres'])
      mkdirSync(join(root, 'src/users'))
      writeFileSync(join(root, 'src/users/users.table.ts'), 'export const users = 1\n')
      const project = open(root)
      expect(() => addToProject(project, ['jwt-auth'])).toThrow('src/users/users.table.ts')
      expect(project.ctx.tree.read('src/db.schema.ts')).toContain('export {}')
    })

    it('runs the database first when both are added at once', async () => {
      const project = open(await generated())
      const result = addToProject(project, ['jwt-auth', 'drizzle-sqlite'])
      expect(result.applied.map((a) => a.id)).toEqual(['drizzle-sqlite', 'jwt-auth'])
      expect(result.warnings).toEqual([])
      expect(result.next).toEqual(['bun run db:generate', 'bun run db:migrate'])
      expect(project.ctx.tree.read('src/users/users.table.ts')).toContain("sqliteTable('users'")
      expect(project.ctx.tree.read('README.md')).toContain('Create the tables and start the app')
    })
  })

  describe('a database in a project whose jwt-auth keeps users in memory', () => {
    const warning = 'src/users/users.service.ts keeps users in memory: move it to the database'

    it('warns, leaves the service alone and keeps the plain guide', async () => {
      const root = await generated(['jwt-auth'])
      const service = readFileSync(join(root, 'src/users/users.service.ts'), 'utf-8')
      const project = open(root)
      const result = addToProject(project, ['drizzle-postgres'])
      expect(result.warnings).toEqual([warning])
      expect(result.next).toEqual(['start PostgreSQL with a "app" database (see README)', 'bunx miia g table posts'])
      expect(project.ctx.tree.read('src/users/users.service.ts')).toBe(service)
      expect(project.ctx.tree.exists('src/users/users.table.ts')).toBe(false)
      expect(project.ctx.tree.read('src/db.schema.ts')).toContain('export {}')
      const readme = project.ctx.tree.read('README.md') ?? ''
      expect(readme).not.toContain('Create the tables')
      expect(readme).not.toContain('create the tables')
      expect(readme).toContain('Then start the app:')
    })

    it('treats naming jwt-auth again the same way', async () => {
      const project = open(await generated(['jwt-auth']))
      const result = addToProject(project, ['drizzle-sqlite', 'jwt-auth'])
      expect(result.applied.map((a) => a.id)).toEqual(['drizzle-sqlite'])
      expect(result.skipped.map((a) => a.id)).toEqual(['jwt-auth'])
      expect(result.warnings).toEqual([warning])
      expect(result.next).toEqual(['bunx miia g table posts'])
    })

    it('warns on Mongo too', async () => {
      for (const id of ['papr', 'mongoose']) {
        const result = addToProject(open(await generated(['jwt-auth'])), [id])
        expect(result.warnings).toEqual([warning])
        expect(result.next).toEqual(['start MongoDB (see README)'])
      }
    })

    it('says nothing once the service no longer keeps them in memory', async () => {
      const root = await generated(['jwt-auth'])
      writeFileSync(join(root, 'src/users/users.service.ts'), 'export class UsersService {}\n')
      expect(addToProject(open(root), ['drizzle-sqlite']).warnings).toEqual([])
    })
  })
})
