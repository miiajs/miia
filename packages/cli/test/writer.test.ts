import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeGeneratedFiles } from '../src/utils/writer.js'

describe('writeGeneratedFiles pre-check', () => {
  let tmp: string

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'miia-writer-'))
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('writes all files when none exist', async () => {
    const files = [
      { path: join(tmp, 'a.ts'), content: 'a' },
      { path: join(tmp, 'b.ts'), content: 'b' },
    ]
    const result = await writeGeneratedFiles(files)
    expect(result.created).toEqual(files.map((f) => f.path))
    expect(result.skipped).toEqual([])
    expect(existsSync(files[0].path)).toBe(true)
    expect(existsSync(files[1].path)).toBe(true)
  })

  it('skips ALL files when one conflicts (pre-check)', async () => {
    mkdirSync(join(tmp, 'sub'), { recursive: true })
    writeFileSync(join(tmp, 'sub', 'existing.ts'), 'old')

    const files = [
      { path: join(tmp, 'fresh.ts'), content: 'new' },
      { path: join(tmp, 'sub', 'existing.ts'), content: 'replacement' },
      { path: join(tmp, 'another.ts'), content: 'data' },
    ]
    const result = await writeGeneratedFiles(files)

    expect(result.created).toEqual([])
    expect(result.skipped).toEqual(files.map((f) => f.path))
    expect(existsSync(files[0].path)).toBe(false)
    expect(existsSync(files[2].path)).toBe(false)
    const fs = await import('node:fs')
    expect(fs.readFileSync(files[1].path, 'utf-8')).toBe('old')
  })

  it('overwrites existing files when allowOverwrite is true', async () => {
    writeFileSync(join(tmp, 'x.ts'), 'old')
    const files = [{ path: join(tmp, 'x.ts'), content: 'new' }]
    const result = await writeGeneratedFiles(files, { allowOverwrite: true })
    expect(result.created).toEqual(files.map((f) => f.path))
    const fs = await import('node:fs')
    expect(fs.readFileSync(files[0].path, 'utf-8')).toBe('new')
  })
})
