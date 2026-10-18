import { afterEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
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

async function project(runtime: Runtime = 'bun'): Promise<string> {
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
      addons: [],
      install: false,
      dryRun: false,
    },
  )
  await tree.commit()
  return root
}

function generate(cwd: string, options: Omit<GenerateOptions, 'dryRun'>) {
  const { tree, warnings } = planGenerate(options, { cwd, ts, cliVersion: '0.0.0-test' })
  const files = Object.fromEntries(tree.changes().map((c) => [c.path, c.content]))
  return { tree, warnings, files }
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

  it('does not register guards and middleware', async () => {
    const root = await project()
    for (const schematic of ['guard', 'middleware']) {
      const { tree } = generate(root, { schematic, name: 'admin' })
      expect(tree.changes().map((c) => c.path)).toEqual([`src/admin/admin.${schematic}.ts`])
    }
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
      'CREATE src/widgets/widgets.controller.ts',
      'CREATE src/widgets/widgets.module.ts',
      'CREATE src/widgets/widgets.schemas.ts',
      'CREATE src/widgets/widgets.service.ts',
      'CREATE src/widgets/widgets.test.ts',
    ])
    expect(existsSync(join(root, 'src/widgets'))).toBe(false)
  })

  it('needs src/', () => {
    const root = mkdtempSync(join(tmpdir(), 'miia-generate-'))
    dirs.push(root)
    expect(() => generate(root, { schematic: 's', name: 'x' })).toThrow('no src/ found')
  })
})
