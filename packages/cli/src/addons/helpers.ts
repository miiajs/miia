import type { PackageJson } from '../codemod/json.js'
import { importSpecifier } from '../codemod/paths.js'
import {
  addImport,
  addSchemaKey,
  addToModuleArray,
  hasModuleEntry,
  insertStatement,
  isListenCall,
} from '../codemod/source.js'
import { addEnvEntries, addLines } from '../codemod/text.js'
import type { ProjectTree } from '../codemod/tree.js'
import { parse } from '../codemod/typescript.js'
import type { AddonContext } from '../scaffold/addons.js'

export interface ImportSpec {
  from: string
  names?: string[]
  type?: boolean
  namespace?: string
}

export function hasDependency(tree: ProjectTree, name: string): boolean {
  const text = tree.read('package.json')
  if (!text) return false
  const pkg = JSON.parse(text) as PackageJson
  return pkg.dependencies?.[name] !== undefined || pkg.devDependencies?.[name] !== undefined
}

/** Import specifier from the root module to a project file */
export function fromRootModule(ctx: AddonContext, file: string): string {
  return importSpecifier(ctx.layout.rootModule ?? 'src/app/app.module.ts', file)
}

/**
 * Adds `element` to `imports` of the root module, then the imports it needs. Nothing is edited when the
 * entry is there already, and a shape the codemod does not handle becomes a warning.
 */
export function registerModule(ctx: AddonContext, opts: { element: string; ref: string; imports: ImportSpec[] }): void {
  const path = ctx.layout.rootModule
  const manual = `add ${opts.ref} to the imports of the root @Module`
  if (!path) {
    ctx.warn(`No root module found: ${manual}`)
    return
  }
  let warning: string | null = null
  ctx.tree.update(path, (text) => {
    const array = addToModuleArray(ctx.ts, text, { key: 'imports', element: opts.element, ref: opts.ref })
    if (array.status === 'unsupported') warning = `Could not edit ${path}: ${manual}`
    if (array.status !== 'added') return text
    let result = array.text
    for (const spec of opts.imports) {
      const imported = addImport(ctx.ts, result, spec)
      if (imported.status === 'conflict') {
        warning = `Could not edit ${path}: a name from ${spec.from} is taken; ${manual}`
        return text
      }
      result = imported.text
    }
    return result
  })
  if (warning) ctx.warn(warning)
}

/** Inserts a statement before `app.listen(...)` in main.ts, plus its imports. */
export function beforeListen(
  ctx: AddonContext,
  opts: { statement: (app: string) => string; exists: (text: string) => boolean; imports: ImportSpec[] },
): void {
  const path = ctx.layout.main
  const fallback = opts.statement('app')
  if (!path) {
    ctx.warn(`No src/main.ts found: add ${fallback} before app.listen()`)
    return
  }
  let warning: string | null = null
  ctx.tree.update(path, (text) => {
    const app = listenReceiver(ctx, text) ?? 'app'
    const inserted = insertStatement(ctx.ts, text, {
      statement: opts.statement(app),
      exists: (sf) => opts.exists(sf.text),
      before: (stmt) => isListenCall(ctx.ts, stmt),
    })
    if (inserted.status === 'unsupported') warning = `Could not edit ${path}: add ${fallback} before app.listen()`
    if (inserted.status !== 'added') return text
    let result = inserted.text
    for (const spec of opts.imports) {
      const imported = addImport(ctx.ts, result, spec)
      if (imported.status === 'conflict') {
        warning = `Could not edit ${path}: a name from ${spec.from} is taken; add ${fallback} manually`
        return text
      }
      result = imported.text
    }
    return result
  })
  if (warning) ctx.warn(warning)
}

function listenReceiver(ctx: AddonContext, text: string): string | null {
  const sf = parse(ctx.ts, text)
  for (const stmt of sf.statements) {
    if (!isListenCall(ctx.ts, stmt) || !ctx.ts.isExpressionStatement(stmt)) continue
    const expr = ctx.ts.isAwaitExpression(stmt.expression) ? stmt.expression.expression : stmt.expression
    if (ctx.ts.isCallExpression(expr) && ctx.ts.isPropertyAccessExpression(expr.expression)) {
      return expr.expression.expression.getText(sf)
    }
  }
  return null
}

/** A top-level `const <name>` in main.ts */
export function mainDeclares(ctx: AddonContext, name: string): boolean {
  const text = ctx.layout.main && ctx.tree.read(ctx.layout.main)
  if (!text) return false
  const sf = parse(ctx.ts, text)
  return sf.statements.some(
    (stmt) =>
      ctx.ts.isVariableStatement(stmt) &&
      stmt.declarationList.declarations.some((d) => ctx.ts.isIdentifier(d.name) && d.name.text === name),
  )
}

/** A key in the env schema, .env.example and .env. `value` goes to .env (a generated secret), else `example`. */
export function addEnv(
  ctx: AddonContext,
  opts: { key: string; schema: string; example: string; value?: string },
): void {
  const { envSchema, envExample, env } = ctx.layout
  if (envSchema) {
    let status = 'added'
    ctx.tree.update(envSchema, (text) => {
      const result = addSchemaKey(ctx.ts, text, { key: opts.key, value: opts.schema })
      status = result.status
      return result.text
    })
    if (status === 'unsupported')
      ctx.warn(`Could not edit ${envSchema}: add ${opts.key}: ${opts.schema} to the env schema`)
  } else {
    ctx.warn(`No env schema found: validate ${opts.key} yourself`)
  }
  if (envExample) ctx.tree.update(envExample, (text) => addEnvEntries(text, [[opts.key, opts.example]]))
  if (env) ctx.tree.update(env, (text) => addEnvEntries(text, [[opts.key, opts.value ?? opts.example]]))
  else if (opts.value !== undefined) ctx.warn(`No .env file: set ${opts.key} in your environment`)
}

export function ignoreFiles(ctx: AddonContext, lines: string[]): void {
  if (ctx.tree.exists('.gitignore')) ctx.tree.update('.gitignore', (text) => addLines(text, lines))
  else ctx.tree.create('.gitignore', `${lines.join('\n')}\n`)
}

/**
 * How a configure() factory reads config: `resolve<ConfigService<Env>>(ConfigService)` when the root module
 * has ConfigModule and the env schema exports `Env`, untyped `resolve(ConfigService)` otherwise.
 */
export function configReader(ctx: AddonContext): { get: (key: string) => string; imports: ImportSpec[] } {
  const rootText = ctx.layout.rootModule ? ctx.tree.read(ctx.layout.rootModule) : null
  const hasConfigModule = !!rootText && hasModuleEntry(ctx.ts, rootText, { key: 'imports', ref: 'ConfigModule' })
  const schemaText = ctx.layout.envSchema ? ctx.tree.read(ctx.layout.envSchema) : null
  const typed = hasConfigModule && !!schemaText && /export\s+type\s+Env\b/.test(schemaText)

  if (!hasConfigModule) {
    ctx.warn(
      'No ConfigModule in the root module: add ConfigModule.configure({ schema }, { global: true }) to its imports',
    )
  }
  const imports: ImportSpec[] = [{ from: '@miiajs/config', names: ['ConfigService'] }]
  if (typed && ctx.layout.envSchema)
    imports.push({ from: fromRootModule(ctx, ctx.layout.envSchema), names: ['Env'], type: true })
  return {
    get: (key) =>
      typed
        ? `resolve<ConfigService<Env>>(ConfigService).getOrThrow('${key}')`
        : `resolve(ConfigService).getOrThrow('${key}')`,
    imports,
  }
}

/** Database name for connection URLs: the package name without scope, [a-z0-9_] only */
export function databaseName(projectName: string): string {
  return projectName.replace(/^@[^/]+\//, '').replace(/[^a-z0-9_]/g, '_')
}

export function quoted(value: string): string {
  return `'${value.replace(/[\\']/g, '\\$&')}'`
}
