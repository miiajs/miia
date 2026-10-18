import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { templatesDir } from '../src/scaffold/templates.js'

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    if (entry === 'node_modules') return []
    const path = join(dir, entry)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })
}

const PORTABLE = ['describe', 'expect', 'it', 'test']

describe('template tests', () => {
  const files = walk(templatesDir).filter((f) => f.endsWith('.test.ts'))

  it('exist', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it('import only describe/it/test/expect from bun:test (node:test on Deno has no hooks)', () => {
    for (const file of files) {
      const sf = ts.createSourceFile(file, readFileSync(file, 'utf-8'), ts.ScriptTarget.Latest, true)
      for (const stmt of sf.statements) {
        if (!ts.isImportDeclaration(stmt) || (stmt.moduleSpecifier as ts.StringLiteral).text !== 'bun:test') continue
        const bindings = stmt.importClause?.namedBindings
        expect(bindings && ts.isNamedImports(bindings)).toBe(true)
        for (const el of (bindings as ts.NamedImports).elements) {
          expect({ file, name: (el.propertyName ?? el.name).text }).toEqual({
            file,
            name: expect.stringMatching(new RegExp(`^(${PORTABLE.join('|')})$`)),
          })
        }
      }
    }
  })
})
