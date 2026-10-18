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
    expect(project.ctx.tree.read('src/app/app.module.ts')).toContain(
      "SwaggerModule.configure({ title: 'app', version: '0.1.0' })",
    )
    expect(readFileSync(join(root, 'src/app/app.module.ts'), 'utf-8')).toBe(moduleBefore)

    await project.ctx.tree.commit()
    expect(readFileSync(join(root, 'src/main.ts'), 'utf-8')).toContain(
      "app.use(cors({ origin: config.get('CORS_ORIGIN') }))",
    )
  })

  it('skips what is installed and changes nothing', async () => {
    const root = await generated(['swagger', 'drizzle-postgres'])
    const project = open(root)
    const result = addToProject(project, ['swagger', 'drizzle-postgres'])
    expect(result.applied).toEqual([])
    expect(result.skipped.map((a) => a.id)).toEqual(['swagger', 'drizzle-postgres'])
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
      'Could not edit src/app/app.module.ts: add AuthModule to the imports of the root @Module',
      'No .env file: set JWT_SECRET in your environment',
    ])
  })
})
