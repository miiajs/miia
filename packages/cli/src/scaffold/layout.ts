import { posix } from 'node:path'
import type { ProjectTree } from '../codemod/tree.js'
import { parse, type TS } from '../codemod/typescript.js'

/** Where an add-on finds the files it edits; null when the project has no such file. */
export interface ProjectLayout {
  rootModule: string | null
  main: string | null
  envSchema: string | null
  env: string | null
  envExample: string | null
}

export const newProjectLayout: ProjectLayout = {
  rootModule: 'src/app/app.module.ts',
  main: 'src/main.ts',
  envSchema: 'src/env.schema.ts',
  env: '.env',
  envExample: '.env.example',
}

/** The layout of an existing project: the conventional paths first, then what main.ts registers. */
export function detectLayout(tree: ProjectTree, ts: TS): ProjectLayout {
  const main = tree.exists('src/main.ts') ? 'src/main.ts' : null
  const rootModule = tree.exists('src/app/app.module.ts')
    ? 'src/app/app.module.ts'
    : main
      ? registeredModule(tree, ts, main)
      : null
  const envSchema = tree.exists('src/env.schema.ts')
    ? 'src/env.schema.ts'
    : (tree.list('src').find((path) => path.endsWith('/env.schema.ts')) ?? null)
  return {
    rootModule,
    main,
    envSchema,
    env: tree.exists('.env') ? '.env' : null,
    envExample: tree.exists('.env.example') ? '.env.example' : null,
  }
}

// `new Miia().register(AppModule)` + `import { AppModule } from './app.module.js'` -> src/app.module.ts
function registeredModule(tree: ProjectTree, ts: TS, main: string): string | null {
  const sf = parse(ts, tree.read(main) ?? '')
  let name: string | null = null
  const visit = (node: import('typescript').Node) => {
    if (name) return
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'register' &&
      node.arguments[0] &&
      ts.isIdentifier(node.arguments[0])
    ) {
      name = node.arguments[0].text
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  if (!name) return null

  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue
    const bindings = stmt.importClause?.namedBindings
    if (!bindings || !ts.isNamedImports(bindings) || !bindings.elements.some((el) => el.name.text === name)) continue
    const specifier = stmt.moduleSpecifier.text
    if (!specifier.startsWith('.')) return null
    const target = posix.join(posix.dirname(main), specifier).replace(/\.js$/, '.ts')
    for (const candidate of [target, `${target}.ts`]) if (tree.exists(candidate)) return candidate
    return null
  }
  return null
}
