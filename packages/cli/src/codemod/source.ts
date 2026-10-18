import type {
  ArrayLiteralExpression,
  Expression,
  ImportDeclaration,
  NamedImports,
  Node,
  ObjectLiteralElementLike,
  ObjectLiteralExpression,
  SourceFile,
  Statement,
} from 'typescript'
import { parse, type TS } from './typescript.js'

/**
 * Text-preserving edits: every helper parses the text, inserts at node positions and returns the new
 * text, leaving the rest of the file byte for byte. Inserted snippets are written with '\n' and
 * two-space indentation; they are re-indented to the file's own EOL and indent unit.
 */

export type EditStatus = 'added' | 'exists' | 'unsupported' | 'conflict'

export interface EditResult {
  text: string
  status: EditStatus
}

export interface Style {
  eol: '\n' | '\r\n'
  indent: string
}

interface Edit {
  start: number
  end: number
  text: string
}

const MODULE_KEYS = ['imports', 'controllers', 'providers', 'exports'] as const
export type ModuleKey = (typeof MODULE_KEYS)[number]

export function detectStyle(text: string): Style {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  let smallest = 0
  for (const line of text.split('\n')) {
    const match = /^([ \t]+)(\S)/.exec(line)
    // ' * ' lines of block comments carry a one-space offset, not an indent unit
    if (!match || match[2] === '*') continue
    if (match[1].includes('\t')) return { eol, indent: '\t' }
    const width = match[1].length
    if (width >= 2 && (smallest === 0 || width < smallest)) smallest = width
  }
  return { eol, indent: smallest ? ' '.repeat(smallest) : '  ' }
}

// --- imports ---------------------------------------------------------------

export function addImport(
  ts: TS,
  text: string,
  opts: { from: string; names?: string[]; type?: boolean; namespace?: string },
): EditResult {
  const sf = parse(ts, text)
  const bindings = collectBindings(ts, sf)
  const wantsValue = !opts.type

  if (opts.namespace) {
    const local = bindings.locals.get(opts.namespace)
    if (local) {
      const same = local.kind === 'namespace' && local.from === opts.from && (!wantsValue || !local.typeOnly)
      return { text, status: same ? 'exists' : 'conflict' }
    }
    const line = `import ${opts.type ? 'type ' : ''}* as ${opts.namespace} from ${quote(ts, sf, opts.from)}`
    return { text: insertImportLine(ts, sf, text, line), status: 'added' }
  }

  const missing: string[] = []
  for (const name of opts.names ?? []) {
    const present = bindings.named.some(
      (b) => b.from === opts.from && b.exported === name && (!wantsValue || !b.typeOnly),
    )
    if (present) continue
    if (bindings.locals.has(name)) return { text, status: 'conflict' }
    missing.push(name)
  }
  if (missing.length === 0) return { text, status: 'exists' }

  // A type goes into `import type { }` from the module, else inline as `type X` into its value import
  const typeOnly = !!opts.type && !!namedImportsOf(ts, sf, opts.from, true)
  const inline = !!opts.type && !typeOnly
  if (!namedImportsOf(ts, sf, opts.from, typeOnly)) {
    const line = `import ${opts.type ? 'type ' : ''}{ ${missing.join(', ')} } from ${quote(ts, sf, opts.from)}`
    return { text: insertImportLine(ts, sf, text, line), status: 'added' }
  }

  const style = detectStyle(text)
  let result = text
  // One name at a time, re-parsing in between, keeps the list rules in one place
  for (const name of missing) {
    const list = namedImportsOf(ts, parse(ts, result), opts.from, typeOnly) as NamedImports
    const element = inline ? `type ${name}` : name
    result = applyEdits(
      result,
      insertIntoList(ts, result, style, listOf(list, list.elements), element, list.elements.length),
    )
  }
  return { text: result, status: 'added' }
}

// `import * as x`, default-only and bare imports from the same module are never merged into
function namedImportsOf(ts: TS, sf: SourceFile, from: string, typeOnly: boolean): NamedImports | undefined {
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || moduleName(ts, stmt) !== from) continue
    const clause = stmt.importClause
    if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings) && clause.isTypeOnly === typeOnly) {
      return clause.namedBindings
    }
  }
  return undefined
}

interface Binding {
  kind: 'named' | 'default' | 'namespace' | 'declaration'
  from?: string
  exported?: string
  typeOnly: boolean
}

function collectBindings(ts: TS, sf: SourceFile) {
  const locals = new Map<string, Binding>()
  const named: Array<Binding & { exported: string }> = []

  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt)) {
      const clause = stmt.importClause
      if (!clause) continue
      const from = moduleName(ts, stmt)
      if (clause.name) locals.set(clause.name.text, { kind: 'default', from, typeOnly: clause.isTypeOnly })
      const bindings = clause.namedBindings
      if (bindings && ts.isNamespaceImport(bindings)) {
        locals.set(bindings.name.text, { kind: 'namespace', from, typeOnly: clause.isTypeOnly })
      } else if (bindings) {
        for (const el of bindings.elements) {
          const binding = {
            kind: 'named' as const,
            from,
            exported: (el.propertyName ?? el.name).text,
            typeOnly: clause.isTypeOnly || el.isTypeOnly,
          }
          locals.set(el.name.text, binding)
          named.push(binding)
        }
      }
      continue
    }
    for (const name of declaredNames(ts, stmt)) locals.set(name, { kind: 'declaration', typeOnly: false })
  }
  return { locals, named }
}

function declaredNames(ts: TS, stmt: Statement): string[] {
  if (ts.isVariableStatement(stmt)) {
    const names: string[] = []
    const visit = (node: Node) => {
      if (ts.isIdentifier(node)) names.push(node.text)
      else if (ts.isObjectBindingPattern(node) || ts.isArrayBindingPattern(node)) {
        for (const el of node.elements) if (ts.isBindingElement(el)) visit(el.name)
      }
    }
    for (const decl of stmt.declarationList.declarations) visit(decl.name)
    return names
  }
  if (
    ts.isClassDeclaration(stmt) ||
    ts.isFunctionDeclaration(stmt) ||
    ts.isEnumDeclaration(stmt) ||
    ts.isInterfaceDeclaration(stmt) ||
    ts.isTypeAliasDeclaration(stmt)
  ) {
    return stmt.name ? [stmt.name.text] : []
  }
  return []
}

function moduleName(ts: TS, decl: ImportDeclaration): string | undefined {
  return ts.isStringLiteral(decl.moduleSpecifier) ? decl.moduleSpecifier.text : undefined
}

// Quote and semicolon style of the file's first import
function quote(ts: TS, sf: SourceFile, value: string): string {
  const first = sf.statements.find(ts.isImportDeclaration)
  const q = first?.moduleSpecifier.getText(sf).startsWith('"') ? '"' : "'"
  const semi = first?.getText(sf).endsWith(';') ? ';' : ''
  return `${q}${value}${q}${semi}`
}

function insertImportLine(ts: TS, sf: SourceFile, text: string, line: string): string {
  const { eol } = detectStyle(text)
  const imports = sf.statements.filter(ts.isImportDeclaration)
  const last = imports.at(-1)
  if (last) return insert(text, lineEnd(text, last.end), eol + line)

  // No imports: after a shebang and triple-slash directives
  let pos = 0
  const lines = text.split('\n')
  let consumed = 0
  for (const [i, raw] of lines.entries()) {
    const content = raw.replace(/\r$/, '')
    if ((i === 0 && content.startsWith('#!')) || /^\/\/\/\s*<reference\b/.test(content)) {
      consumed = i + 1
      continue
    }
    break
  }
  if (consumed > 0) {
    for (let i = 0; i < consumed; i++) pos += lines[i].length + 1
    pos = Math.min(pos, text.length)
    const prefix = pos === text.length && !text.endsWith('\n') ? eol : ''
    return insert(text, pos, `${prefix}${line}${eol}`)
  }
  if (text.length === 0) return line + eol
  return line + (/^\r?\n/.test(text) ? eol : eol + eol) + text
}

// --- @Module arrays --------------------------------------------------------

export function addToModuleArray(
  ts: TS,
  text: string,
  opts: { key: ModuleKey; element: string; ref: string; moduleClass?: string },
): EditResult {
  const sf = parse(ts, text)
  const config = findModuleConfig(ts, sf, opts.moduleClass)
  if (!config) return { text, status: 'unsupported' }

  const style = detectStyle(text)
  const prop = config.properties.find((p) => propertyName(ts, p) === opts.key)

  if (prop) {
    if (!ts.isPropertyAssignment(prop) || !ts.isArrayLiteralExpression(prop.initializer)) {
      return { text, status: 'unsupported' }
    }
    const array: ArrayLiteralExpression = prop.initializer
    if (array.elements.some((el) => refersTo(ts, el, opts.ref))) return { text, status: 'exists' }
    const edits = insertIntoList(ts, text, style, listOf(array, array.elements), opts.element, array.elements.length)
    return { text: applyEdits(text, edits), status: 'added' }
  }

  // A spread may already carry the key
  if (config.properties.some((p) => ts.isSpreadAssignment(p))) return { text, status: 'unsupported' }

  const later = MODULE_KEYS.slice(MODULE_KEYS.indexOf(opts.key) + 1) as readonly string[]
  const anchor = config.properties.findIndex((p) => later.includes(propertyName(ts, p) ?? ''))
  const index = anchor === -1 ? config.properties.length : anchor
  const snippet = isMultiline(opts.element)
    ? `${opts.key}: [\n${indentSnippet(opts.element)},\n]`
    : `${opts.key}: [${opts.element}]`
  const edits = insertIntoList(ts, text, style, listOf(config, config.properties), snippet, index, {
    multilineWhenEmpty: true,
    padSingleLine: true,
  })
  return { text: applyEdits(text, edits), status: 'added' }
}

/** Whether `key` of the @Module holds an array entry referring to `ref`. */
export function hasModuleEntry(
  ts: TS,
  text: string,
  opts: { key: ModuleKey; ref: string; moduleClass?: string },
): boolean {
  const config = findModuleConfig(ts, parse(ts, text), opts.moduleClass)
  const prop = config?.properties.find((p) => propertyName(ts, p) === opts.key)
  return (
    !!prop &&
    ts.isPropertyAssignment(prop) &&
    ts.isArrayLiteralExpression(prop.initializer) &&
    prop.initializer.elements.some((el) => refersTo(ts, el, opts.ref))
  )
}

function findModuleConfig(ts: TS, sf: SourceFile, moduleClass?: string): ObjectLiteralExpression | null {
  const decoratorNames = new Set(['Module'])
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || moduleName(ts, stmt) !== '@miiajs/core') continue
    const bindings = stmt.importClause?.namedBindings
    if (!bindings || !ts.isNamedImports(bindings)) continue
    for (const el of bindings.elements)
      if ((el.propertyName ?? el.name).text === 'Module') decoratorNames.add(el.name.text)
  }

  for (const stmt of sf.statements) {
    if (!ts.isClassDeclaration(stmt)) continue
    if (moduleClass && stmt.name?.text !== moduleClass) continue
    for (const decorator of ts.getDecorators(stmt) ?? []) {
      const call = decorator.expression
      if (!ts.isCallExpression(call) || !ts.isIdentifier(call.expression)) continue
      if (!decoratorNames.has(call.expression.text)) continue
      const arg = call.arguments[0]
      return arg && ts.isObjectLiteralExpression(arg) ? arg : null
    }
  }
  return null
}

function propertyName(ts: TS, p: ObjectLiteralElementLike): string | undefined {
  if (ts.isSpreadAssignment(p) || !p.name) return undefined
  return ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) || ts.isNoSubstitutionTemplateLiteral(p.name)
    ? p.name.text
    : undefined
}

// `X`, `X.configure(...)`, `X.register(...)`, `forwardRef(() => X)`
function refersTo(ts: TS, node: Expression, ref: string): boolean {
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'forwardRef') {
    const fn = node.arguments[0]
    return !!fn && ts.isArrowFunction(fn) && !ts.isBlock(fn.body) && refersTo(ts, fn.body, ref)
  }
  let current: Expression = node
  while (true) {
    if (ts.isIdentifier(current)) return current.text === ref
    if (
      ts.isCallExpression(current) ||
      ts.isPropertyAccessExpression(current) ||
      ts.isElementAccessExpression(current) ||
      ts.isNonNullExpression(current) ||
      ts.isParenthesizedExpression(current)
    ) {
      current = current.expression
    } else {
      return false
    }
  }
}

// --- env schema ------------------------------------------------------------

export function addSchemaKey(ts: TS, text: string, opts: { key: string; value: string; schema?: string }): EditResult {
  const sf = parse(ts, text)
  const name = opts.schema ?? 'envSchema'
  let shape: ObjectLiteralExpression | null = null

  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue
    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || decl.name.text !== name || !decl.initializer) continue
      shape = objectShape(ts, decl.initializer)
    }
  }
  if (!shape) return { text, status: 'unsupported' }
  if (shape.properties.some((p) => propertyName(ts, p) === opts.key)) return { text, status: 'exists' }

  const snippet = `${opts.key}: ${opts.value}`
  const edits = insertIntoList(
    ts,
    text,
    detectStyle(text),
    listOf(shape, shape.properties),
    snippet,
    shape.properties.length,
    {
      multilineWhenEmpty: true,
      padSingleLine: true,
    },
  )
  return { text: applyEdits(text, edits), status: 'added' }
}

// `z.object({...})`, also behind a chain such as `z.object({...}).strict()`
function objectShape(ts: TS, init: Expression): ObjectLiteralExpression | null {
  let current: Expression = init
  while (ts.isCallExpression(current)) {
    const callee = current.expression
    if (!ts.isPropertyAccessExpression(callee)) return null
    if (callee.name.text === 'object') {
      const arg = current.arguments[0]
      return arg && ts.isObjectLiteralExpression(arg) ? arg : null
    }
    current = callee.expression
  }
  return null
}

// --- statements ------------------------------------------------------------

export function insertStatement(
  ts: TS,
  text: string,
  opts: { statement: string; exists: (sf: SourceFile) => boolean; before: (stmt: Statement) => boolean },
): EditResult {
  const sf = parse(ts, text)
  if (opts.exists(sf)) return { text, status: 'exists' }
  // No anchor, no guess: the end of a bootstrap()-style main.ts is outside the scope of `app`
  const anchor = sf.statements.find((s) => opts.before(s))
  if (!anchor) return { text, status: 'unsupported' }

  const style = detectStyle(text)
  const pos = lineStart(text, leadingStart(ts, text, anchor))
  const indent = lineIndent(text, anchor.getStart(sf))
  return { text: insert(text, pos, indent + formatSnippet(opts.statement, indent, style) + style.eol), status: 'added' }
}

/** Top-level `await app.listen(...)` or `app.listen(...)` for any identifier. */
export function isListenCall(ts: TS, stmt: Statement): boolean {
  if (!ts.isExpressionStatement(stmt)) return false
  const expr = ts.isAwaitExpression(stmt.expression) ? stmt.expression.expression : stmt.expression
  return (
    ts.isCallExpression(expr) &&
    ts.isPropertyAccessExpression(expr.expression) &&
    expr.expression.name.text === 'listen' &&
    ts.isIdentifier(expr.expression.expression)
  )
}

/** Any call to `name(...)` in the file. */
export function hasCall(ts: TS, sf: SourceFile, name: string): boolean {
  let found = false
  const visit = (node: Node) => {
    if (found) return
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name) {
      found = true
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return found
}

// --- comma-separated lists -------------------------------------------------

interface ListTarget {
  /** Position right after the opening bracket */
  open: number
  /** Position of the closing bracket */
  close: number
  items: readonly Node[]
  trailingComma: boolean
}

function listOf(container: Node, items: readonly Node[] & { hasTrailingComma?: boolean }): ListTarget {
  return {
    open: container.getStart() + 1,
    close: container.getEnd() - 1,
    items,
    trailingComma: !!items.hasTrailingComma,
  }
}

function insertIntoList(
  ts: TS,
  text: string,
  style: Style,
  list: ListTarget,
  snippet: string,
  index: number,
  opts: { multilineWhenEmpty?: boolean; padSingleLine?: boolean } = {},
): Edit[] {
  const base = lineIndent(text, list.open - 1)
  const inner = base + style.indent
  const { items } = list
  const multiline = isMultiline(snippet)

  if (items.length === 0) {
    if (opts.multilineWhenEmpty || multiline) {
      const body = `${style.eol}${inner}${formatSnippet(snippet, inner, style)},${style.eol}${base}`
      return [{ start: list.open, end: list.close, text: body }]
    }
    return [{ start: list.open, end: list.close, text: opts.padSingleLine ? ` ${snippet} ` : snippet }]
  }

  const listIsMultiline = !sameLine(text, list.open, items[0].getStart())

  if (!listIsMultiline) {
    if (multiline) {
      const texts = items.map((item) => item.getText())
      texts.splice(index, 0, formatSnippet(snippet, inner, style))
      const body = texts.map((t) => `${style.eol}${inner}${t},`).join('') + style.eol + base
      return [{ start: list.open, end: list.close, text: body }]
    }
    if (index < items.length)
      return [{ start: items[index].getStart(), end: items[index].getStart(), text: `${snippet}, ` }]
    const last = items[items.length - 1]
    return [{ start: last.end, end: last.end, text: `, ${snippet}` }]
  }

  if (index < items.length) {
    const target = items[index]
    const indent = lineIndent(text, target.getStart())
    const pos = lineStart(text, leadingStart(ts, text, target))
    return [{ start: pos, end: pos, text: `${indent}${formatSnippet(snippet, indent, style)},${style.eol}` }]
  }

  const last = items[items.length - 1]
  const indent = lineIndent(text, last.getStart())
  const afterLast = list.trailingComma ? trailingCommaEnd(text, last.end) : last.end
  const element = formatSnippet(snippet, indent, style)
  const tail = list.trailingComma ? ',' : ''
  const edits: Edit[] = []
  if (!list.trailingComma) edits.push({ start: last.end, end: last.end, text: ',' })

  if (sameLine(text, afterLast, list.close)) {
    // `B]` on one line: keep the new element inside the brackets
    edits.push({ start: afterLast, end: afterLast, text: `${style.eol}${indent}${element}${tail}` })
  } else {
    const pos = lineEnd(text, afterLast)
    edits.push({ start: pos, end: pos, text: `${style.eol}${indent}${element}${tail}` })
  }
  return edits
}

function trailingCommaEnd(text: string, from: number): number {
  const match = /^(?:\s|\/\*[\s\S]*?\*\/)*,/.exec(text.slice(from))
  return match ? from + match[0].length : from
}

// --- text helpers ----------------------------------------------------------

function applyEdits(text: string, edits: Edit[]): string {
  const ordered = edits.map((e, i) => ({ ...e, i })).sort((a, b) => b.start - a.start || b.i - a.i)
  let out = text
  for (const e of ordered) out = out.slice(0, e.start) + e.text + out.slice(e.end)
  return out
}

function insert(text: string, pos: number, value: string): string {
  return text.slice(0, pos) + value + text.slice(pos)
}

function leadingStart(ts: TS, text: string, node: Node): number {
  return ts.getLeadingCommentRanges(text, node.getFullStart())?.[0]?.pos ?? node.getStart()
}

function lineStart(text: string, pos: number): number {
  return text.lastIndexOf('\n', pos - 1) + 1
}

function lineEnd(text: string, pos: number): number {
  const nl = text.indexOf('\n', pos)
  if (nl === -1) return text.length
  return text[nl - 1] === '\r' ? nl - 1 : nl
}

function lineIndent(text: string, pos: number): string {
  return /^[ \t]*/.exec(text.slice(lineStart(text, pos)))?.[0] ?? ''
}

function sameLine(text: string, a: number, b: number): boolean {
  return !text.slice(Math.min(a, b), Math.max(a, b)).includes('\n')
}

function isMultiline(snippet: string): boolean {
  return snippet.includes('\n')
}

function indentSnippet(snippet: string): string {
  return snippet
    .split('\n')
    .map((line) => (line ? `  ${line}` : line))
    .join('\n')
}

/** First line stays at the insertion point; later lines get `base` plus their depth in the file's unit. */
function formatSnippet(snippet: string, base: string, style: Style): string {
  return snippet
    .split('\n')
    .map((line, i) => {
      if (i === 0) return line
      if (!line.trim()) return ''
      const spaces = /^ */.exec(line)?.[0].length ?? 0
      return base + style.indent.repeat(Math.floor(spaces / 2)) + ' '.repeat(spaces % 2) + line.slice(spaces)
    })
    .join(style.eol)
}
