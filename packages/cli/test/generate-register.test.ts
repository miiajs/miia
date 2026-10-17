import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ts from 'typescript'
import { ProjectTree } from '../src/codemod/tree.js'
import { findParentModule } from '../src/generate/parent-module.js'
import { registerInModule } from '../src/generate/register.js'

const dirs: string[] = []

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'miia-register-'))
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

const appModule = `import { Module } from '@miiajs/core'
import { AppController } from './app.controller.js'

@Module({
  controllers: [AppController],
})
export class AppModule {}
`

describe('registerInModule', () => {
  it('adds the array entry and the import', () => {
    const tree = new ProjectTree(project({ 'src/app/app.module.ts': appModule }))
    tree.create('src/app/users/users.service.ts', 'export class UsersService {}\n')
    const status = registerInModule(tree, ts, {
      modulePath: 'src/app/app.module.ts',
      className: 'UsersService',
      file: 'src/app/users/users.service.ts',
      key: 'providers',
    })
    expect(status).toBe('added')
    expect(tree.read('src/app/app.module.ts')).toBe(`import { Module } from '@miiajs/core'
import { AppController } from './app.controller.js'
import { UsersService } from './users/users.service.js'

@Module({
  controllers: [AppController],
  providers: [UsersService],
})
export class AppModule {}
`)
  })

  it('uses a posix specifier for a module found by absolute OS path', () => {
    const root = project({ 'src/app/app.module.ts': appModule, 'src/main.ts': '' })
    const parent = findParentModule(join(root, 'src', 'posts'), join(root, 'src', 'posts', 'posts.module.ts'))
    expect(parent).toBe(join(root, 'src', 'app', 'app.module.ts'))

    const tree = new ProjectTree(root)
    registerInModule(tree, ts, {
      modulePath: 'src/app/app.module.ts',
      className: 'PostsModule',
      file: 'src/posts/posts.module.ts',
      key: 'imports',
    })
    expect(tree.read('src/app/app.module.ts')).toContain("import { PostsModule } from '../posts/posts.module.js'")
  })

  it('leaves the file alone when the entry exists or the shape is unsupported', () => {
    const tree = new ProjectTree(
      project({
        'src/a.module.ts': appModule,
        'src/b.module.ts': "import { Module } from '@miiajs/core'\n\n@Module(shared)\nexport class B {}\n",
      }),
    )
    expect(
      registerInModule(tree, ts, {
        modulePath: 'src/a.module.ts',
        className: 'AppController',
        file: 'src/x.ts',
        key: 'controllers',
      }),
    ).toBe('exists')
    expect(
      registerInModule(tree, ts, { modulePath: 'src/b.module.ts', className: 'X', file: 'src/x.ts', key: 'providers' }),
    ).toBe('unsupported')
    expect(tree.changes()).toEqual([])
  })

  it('reverts the array entry when the import name clashes', () => {
    const clash = appModule.replace(
      "import { AppController } from './app.controller.js'",
      "import { AppController, UsersService } from './app.controller.js'",
    )
    const tree = new ProjectTree(project({ 'src/app.module.ts': clash }))
    expect(
      registerInModule(tree, ts, {
        modulePath: 'src/app.module.ts',
        className: 'UsersService',
        file: 'src/users.service.ts',
        key: 'providers',
      }),
    ).toBe('conflict')
    expect(tree.changes()).toEqual([])
  })
})
