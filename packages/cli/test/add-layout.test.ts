import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ts from 'typescript'
import { ProjectTree } from '../src/codemod/tree.js'
import { detectLayout } from '../src/scaffold/layout.js'

const dirs: string[] = []

function project(files: Record<string, string>): ProjectTree {
  const root = mkdtempSync(join(tmpdir(), 'miia-layout-'))
  dirs.push(root)
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  return new ProjectTree(root)
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('detectLayout', () => {
  it('finds the conventional files', () => {
    const tree = project({
      'src/main.ts': '',
      'src/app/app.module.ts': '',
      'src/env.schema.ts': '',
      '.env': '',
      '.env.example': '',
    })
    expect(detectLayout(tree, ts)).toEqual({
      rootModule: 'src/app/app.module.ts',
      main: 'src/main.ts',
      envSchema: 'src/env.schema.ts',
      env: '.env',
      envExample: '.env.example',
    })
  })

  it('follows register(X) in main.ts to the root module and finds a nested env schema', () => {
    const tree = project({
      'src/main.ts':
        "import { Miia } from '@miiajs/core'\nimport { RootModule } from './root.module.js'\n\nconst app = new Miia().register(RootModule)\n",
      'src/root.module.ts': '',
      'src/config/env.schema.ts': '',
    })
    expect(detectLayout(tree, ts)).toEqual({
      rootModule: 'src/root.module.ts',
      main: 'src/main.ts',
      envSchema: 'src/config/env.schema.ts',
      env: null,
      envExample: null,
    })
  })

  it('reports what is missing as null', () => {
    const tree = project({ 'src/main.ts': "import { M } from 'pkg'\nnew Miia().register(M)\n" })
    expect(detectLayout(tree, ts)).toEqual({
      rootModule: null,
      main: 'src/main.ts',
      envSchema: null,
      env: null,
      envExample: null,
    })
    expect(detectLayout(project({ 'package.json': '{}' }), ts).main).toBeNull()
  })
})
