import { posix, win32 } from 'node:path'
import type { Node, ObjectLiteralExpression } from 'typescript'
import type { Dialect } from '../addons/drizzle.js'
import { importSpecifier } from '../codemod/paths.js'
import { addExportStar, propertyName } from '../codemod/source.js'
import type { ProjectTree } from '../codemod/tree.js'
import { parse, type TS } from '../codemod/typescript.js'
import { CliError } from '../utils/errors.js'

const GLOB = /[*?[\]{}!]/

/** dialect and the file named by `schema` in drizzle.config.ts; `schema` is null for an array, a glob or a path outside the project */
export function readDrizzleConfig(tree: ProjectTree, ts: TS): { dialect: Dialect; schema: string | null } {
  const text = tree.read('drizzle.config.ts')
  if (text === null) throw new CliError('miia g table needs a Drizzle project: no drizzle.config.ts found')

  const config = findConfig(ts, parse(ts, text))
  const value = config && property(ts, config, 'dialect')
  if (!value || !ts.isStringLiteralLike(value)) {
    throw new CliError(
      "Could not read drizzle.config.ts: miia g table needs dialect as a string, e.g. dialect: 'mysql'",
    )
  }
  const dialect = toDialect(value.text)
  if (!dialect) {
    throw new CliError(`miia g table works with postgresql, mysql and sqlite, not with the ${value.text} dialect`)
  }

  const schema = property(ts, config, 'schema')
  return { dialect, schema: schema && ts.isStringLiteralLike(schema) ? projectPath(schema.text) : null }
}

/** Adds `export * from <table>` to the schema file named by the config; a warning when it cannot, never a throw */
export function addTableToSchema(tree: ProjectTree, ts: TS, schema: string | null, tableFile: string): string | null {
  if (!schema || !tree.exists(schema)) return `Add ${tableFile} to your Drizzle schema manually`
  tree.update(schema, (text) => addExportStar(ts, text, { from: importSpecifier(schema, tableFile) }).text)
  return null
}

function toDialect(value: string): Dialect | null {
  if (value === 'postgresql') return 'postgres'
  return value === 'mysql' || value === 'sqlite' ? value : null
}

// `defineConfig({ ... })`, `export default { ... }`, `const config = { ... }`: the object that names the dialect
function findConfig(ts: TS, root: Node): ObjectLiteralExpression | null {
  let found: ObjectLiteralExpression | null = null
  const visit = (node: Node) => {
    if (found) return
    if (ts.isObjectLiteralExpression(node) && node.properties.some((p) => propertyName(ts, p) === 'dialect')) {
      found = node
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(root)
  return found
}

function property(ts: TS, config: ObjectLiteralExpression, name: string) {
  const prop = config.properties.find((p) => propertyName(ts, p) === name)
  return prop && ts.isPropertyAssignment(prop) ? prop.initializer : null
}

function projectPath(value: string): string | null {
  const path = value.replaceAll('\\', '/')
  if (GLOB.test(path) || posix.isAbsolute(path) || win32.isAbsolute(path)) return null
  const normalized = posix.normalize(path)
  return normalized === '..' || normalized.startsWith('../') ? null : normalized
}
