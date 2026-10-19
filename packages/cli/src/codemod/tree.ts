import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, posix, win32 } from 'node:path'
import { CliError } from '../utils/errors.js'

export interface FileChange {
  path: string
  kind: 'create' | 'update'
  content: string
}

const LIST_SKIP = new Set(['node_modules', '.git'])

/**
 * Pending changes to a project. Reads see the changes first and the disk second; nothing is written
 * until commit(), so a failing step leaves the disk untouched and --dry-run prints the same set.
 * Paths are posix and relative to the root.
 */
export class ProjectTree {
  private readonly pending = new Map<string, FileChange>()

  constructor(readonly root: string) {}

  read(path: string): string | null {
    const key = this.normalize(path)
    const change = this.pending.get(key)
    if (change) return change.content
    try {
      return readFileSync(join(this.root, key), 'utf-8')
    } catch {
      return null
    }
  }

  exists(path: string): boolean {
    return this.read(path) !== null
  }

  /** Files under `dir`, recursively: disk plus files created in the tree. */
  list(dir: string): string[] {
    const base = this.normalize(dir)
    const found = new Set<string>()
    const walk = (rel: string) => {
      let entries: string[]
      try {
        entries = readdirSync(join(this.root, rel))
      } catch {
        return
      }
      for (const entry of entries) {
        if (LIST_SKIP.has(entry)) continue
        const child = `${rel}/${entry}`
        try {
          if (statSync(join(this.root, child)).isDirectory()) walk(child)
          else found.add(child)
        } catch {}
      }
    }
    walk(base)
    for (const key of this.pending.keys()) if (key.startsWith(`${base}/`)) found.add(key)
    return [...found].sort()
  }

  create(path: string, content: string): void {
    const key = this.normalize(path)
    if (this.pending.has(key) || existsSync(join(this.root, key))) throw new CliError(`File already exists: ${key}`)
    this.pending.set(key, { path: key, kind: 'create', content })
  }

  /** Returns false when `fn` leaves the content as it was; nothing is recorded then. */
  update(path: string, fn: (text: string) => string): boolean {
    const key = this.normalize(path)
    const current = this.read(key)
    if (current === null) throw new CliError(`File not found: ${key}`)
    const next = fn(current)
    if (next === current) return false
    this.pending.set(key, { path: key, kind: this.pending.get(key)?.kind ?? 'update', content: next })
    return true
  }

  changes(): FileChange[] {
    return [...this.pending.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  }

  summary(): string[] {
    return this.changes().map((c) => `${c.kind.toUpperCase()} ${c.path}`)
  }

  /**
   * Writes every change to a temporary file next to its target first, then renames them into place:
   * a failed write leaves the project as it was, and a failed rename names what is already written.
   */
  async commit(): Promise<string[]> {
    const staged: Array<{ path: string; temp: string; target: string }> = []
    const createdDirs: string[] = []
    try {
      for (const change of this.changes()) {
        const target = join(this.root, change.path)
        const created = await mkdir(dirname(target), { recursive: true })
        if (created) createdDirs.push(created)
        const temp = join(dirname(target), `.${basename(target)}.${process.pid}.miia-tmp`)
        await writeFile(temp, change.content, 'utf-8')
        staged.push({ path: change.path, temp, target })
      }
    } catch (err) {
      await Promise.all(staged.map((s) => rm(s.temp, { force: true })))
      for (const dir of createdDirs.reverse()) await rm(dir, { recursive: true, force: true })
      throw new CliError(`Nothing was written: ${(err as Error).message}`)
    }

    const written: string[] = []
    for (const [i, s] of staged.entries()) {
      try {
        await rename(s.temp, s.target)
      } catch (err) {
        await Promise.all(staged.slice(i).map((rest) => rm(rest.temp, { force: true })))
        const done = staged.slice(0, i).map((d) => `  ${d.path}`)
        const listing = done.length > 0 ? `\nAlready written:\n${done.join('\n')}` : ''
        throw new CliError(`Writing ${s.path} failed: ${(err as Error).message}${listing}`)
      }
      written.push(s.target)
    }
    return written
  }

  private normalize(path: string): string {
    if (isAbsolute(path) || win32.isAbsolute(path))
      throw new CliError(`Expected a path relative to the project: ${path}`)
    const key = posix.normalize(path.replaceAll('\\', '/')).replace(/^\.\//, '').replace(/\/$/, '')
    if (key === '..' || key.startsWith('../')) throw new CliError(`Path leaves the project: ${path}`)
    return key
  }
}
