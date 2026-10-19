import { afterEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProjectTree } from '../src/codemod/tree.js'
import { CliError } from '../src/utils/errors.js'

const dirs: string[] = []

function project(files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'miia-tree-'))
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

describe('ProjectTree', () => {
  it('reads pending changes first, then the disk', () => {
    const tree = new ProjectTree(project({ 'a.txt': 'disk' }))
    expect(tree.read('a.txt')).toBe('disk')
    expect(tree.read('missing.txt')).toBeNull()
    tree.update('a.txt', () => 'memory')
    expect(tree.read('./a.txt')).toBe('memory')
    expect(tree.exists('a.txt')).toBe(true)
    expect(tree.exists('b.txt')).toBe(false)
  })

  it('refuses to create over an existing file', () => {
    const tree = new ProjectTree(project({ 'src/main.ts': '' }))
    expect(() => tree.create('src/main.ts', 'x')).toThrow(CliError)
    tree.create('src/new.ts', 'x')
    expect(() => tree.create('src/new.ts', 'y')).toThrow('File already exists: src/new.ts')
  })

  it('does not record an update that changes nothing', () => {
    const tree = new ProjectTree(project({ 'a.txt': 'same' }))
    expect(tree.update('a.txt', (t) => t)).toBe(false)
    expect(tree.changes()).toEqual([])
    expect(() => tree.update('missing.txt', (t) => t)).toThrow('File not found: missing.txt')
  })

  it('keeps an update of a created file a create', () => {
    const tree = new ProjectTree(project())
    tree.create('src/a.ts', 'one')
    expect(tree.update('src/a.ts', (t) => `${t} two`)).toBe(true)
    expect(tree.changes()).toEqual([{ path: 'src/a.ts', kind: 'create', content: 'one two' }])
  })

  it('rejects paths outside the root', () => {
    const tree = new ProjectTree(project())
    expect(() => tree.create('../evil.ts', '')).toThrow(CliError)
    expect(() => tree.read('src/../../evil.ts')).toThrow('Path leaves the project')
    expect(() => tree.create('/etc/passwd', '')).toThrow(CliError)
    expect(() => tree.create('C:\\x.ts', '')).toThrow(CliError)
  })

  it('normalizes backslashes and ./', () => {
    const tree = new ProjectTree(project())
    tree.create('.\\src\\a.ts', 'x')
    expect(tree.summary()).toEqual(['CREATE src/a.ts'])
  })

  it('lists disk files and created files, sorted, without node_modules', () => {
    const tree = new ProjectTree(
      project({ 'src/b.ts': '', 'src/app/a.ts': '', 'src/node_modules/x.ts': '', 'other.ts': '' }),
    )
    tree.create('src/app/c.ts', '')
    expect(tree.list('src')).toEqual(['src/app/a.ts', 'src/app/c.ts', 'src/b.ts'])
    expect(tree.list('missing')).toEqual([])
  })

  it('summarizes and commits changes sorted by path, creating directories', async () => {
    const root = project({ 'package.json': '{}' })
    const tree = new ProjectTree(root)
    tree.create('src/z.ts', 'z')
    tree.create('src/deep/a.ts', 'a')
    tree.update('package.json', () => '{ "name": "x" }')
    expect(tree.summary()).toEqual(['UPDATE package.json', 'CREATE src/deep/a.ts', 'CREATE src/z.ts'])
    expect(existsSync(join(root, 'src'))).toBe(false)

    const written = await tree.commit()
    expect(written).toEqual([join(root, 'package.json'), join(root, 'src/deep/a.ts'), join(root, 'src/z.ts')])
    expect(readFileSync(join(root, 'src/deep/a.ts'), 'utf-8')).toBe('a')
    expect(readFileSync(join(root, 'package.json'), 'utf-8')).toBe('{ "name": "x" }')
  })

  it('writes nothing when one write fails', async () => {
    const root = project({ 'package.json': '{}', blocker: 'a file, not a folder' })
    const tree = new ProjectTree(root)
    tree.create('a/new.ts', 'x')
    tree.create('blocker/x.ts', 'y')
    tree.update('package.json', () => '{ "changed": true }')
    await expect(tree.commit()).rejects.toThrow('Nothing was written')
    expect(existsSync(join(root, 'a'))).toBe(false)
    expect(readFileSync(join(root, 'package.json'), 'utf-8')).toBe('{}')
    expect(readdirSync(root).sort()).toEqual(['blocker', 'package.json'])
  })

  it('works with a root that does not exist yet', async () => {
    const root = join(project(), 'new-app')
    const tree = new ProjectTree(root)
    expect(tree.exists('package.json')).toBe(false)
    tree.create('package.json', '{}')
    await tree.commit()
    expect(readFileSync(join(root, 'package.json'), 'utf-8')).toBe('{}')
  })
})
