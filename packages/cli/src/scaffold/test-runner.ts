import { detectStyle } from '../codemod/source.js'
import { parse, type TS } from '../codemod/typescript.js'
import { CliError } from '../utils/errors.js'

// node:test on Deno 2.7 has no hooks, so templates stick to what runs on all three runtimes
const PORTABLE = new Set(['describe', 'it', 'test', 'expect'])

/**
 * Template tests are written for bun:test. For Node.js and Deno the import moves to node:test, with
 * `expect` from the `expect` package (the same API).
 */
export function toNodeTestRunner(ts: TS, text: string): string {
  const sf = parse(ts, text)
  const { eol } = detectStyle(text)
  let result = text

  for (const stmt of [...sf.statements].reverse()) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue
    if (stmt.moduleSpecifier.text !== 'bun:test') continue
    const bindings = stmt.importClause?.namedBindings
    if (stmt.importClause?.name || !bindings || !ts.isNamedImports(bindings)) {
      throw new CliError('Template tests import named members from bun:test only')
    }

    const runner: string[] = []
    let expect: string | null = null
    for (const el of bindings.elements) {
      const imported = (el.propertyName ?? el.name).text
      if (!PORTABLE.has(imported)) {
        throw new CliError(
          `bun:test "${imported}" has no node:test counterpart on Deno; use describe, it, test and expect`,
        )
      }
      if (imported === 'expect') expect = el.getText(sf)
      else runner.push(el.getText(sf))
    }

    const q = stmt.moduleSpecifier.getText(sf)[0]
    const semi = stmt.getText(sf).endsWith(';') ? ';' : ''
    const lines: string[] = []
    if (runner.length > 0) lines.push(`import { ${runner.join(', ')} } from ${q}node:test${q}${semi}`)
    if (expect) lines.push(`import { ${expect} } from ${q}expect${q}${semi}`)
    result = result.slice(0, stmt.getStart(sf)) + lines.join(eol) + result.slice(stmt.end)
  }
  return result
}
