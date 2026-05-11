import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import type * as t from '@babel/types'
import { generateCode, parseModule } from 'magicast'
import type { RegistrationTarget } from './types.js'
import { logger } from '../utils/logger.js'

/**
 * Find the nearest *.module.ts file by walking up from targetDir toward src/.
 * Prefers a module matching the directory name (e.g. user/ → user.module.ts).
 * Pass `excludeFile` to skip a specific path (e.g. a module file that was just generated).
 */
export function findParentModule(targetDir: string, excludeFile?: string): string | null {
  const srcRoot = findSrcRoot(targetDir)
  if (!srcRoot) return null

  // Walk up from targetDir toward src/
  let current = targetDir
  while (current.length >= srcRoot.length) {
    const moduleFile = findModuleInDir(current, excludeFile)
    if (moduleFile && moduleFile !== excludeFile) return moduleFile
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }

  // Fallback: check src/app/app.module.ts (common layout)
  const appModuleFallback = join(srcRoot, 'app', 'app.module.ts')
  if (existsSync(appModuleFallback) && appModuleFallback !== excludeFile) return appModuleFallback

  return null
}

function findSrcRoot(from: string): string | null {
  let current = from
  while (current !== dirname(current)) {
    if (current.endsWith('/src') || current.endsWith('\\src')) return current
    try {
      if (readdirSync(current).includes('src')) return join(current, 'src')
    } catch {
      // Directory may not exist yet (dry-run or target being created)
    }
    current = dirname(current)
  }
  return null
}

function findModuleInDir(dir: string, excludeFile?: string): string | null {
  let files: string[]
  try {
    files = readdirSync(dir)
  } catch {
    return null
  }
  const modules = files.filter((f) => f.endsWith('.module.ts') && join(dir, f) !== excludeFile)
  if (modules.length === 0) return null
  if (modules.length === 1) return join(dir, modules[0])

  // Prefer module matching directory name
  const dirName = dir.split(/[/\\]/).pop()
  const preferred = modules.find((f) => f === `${dirName}.module.ts`)
  return join(dir, preferred ?? modules[0])
}

/**
 * Register a class in a parent module file:
 * 1. Add an import statement
 * 2. Push the class name into the appropriate @Module({}) array
 */
export async function registerInModule(
  modulePath: string,
  className: string,
  generatedFilePath: string,
  target: RegistrationTarget,
  dryRun: boolean,
): Promise<string | null> {
  const displayPath = relative(process.cwd(), modulePath)

  try {
    const source = readFileSync(modulePath, 'utf-8')
    const mod = parseModule(source, { sourceFileName: modulePath })

    // Compute relative import path (with .js extension)
    const fromDir = dirname(modulePath)
    let rel = relative(fromDir, generatedFilePath).replace(/\.ts$/, '.js')
    if (!rel.startsWith('.')) rel = `./${rel}`

    // Add import via magicast
    mod.imports.$add({ from: rel, imported: className })

    // Find and modify @Module decorator via AST.
    // magicast types $ast as Node (the babel AST union); parseModule always
    // returns a Program at runtime, so the cast is safe.
    const modified = addToModuleDecorator(mod.$ast as t.Program, target, className)
    if (!modified) {
      logger.warn(`  Could not find @Module ${target} array in ${displayPath}. Register ${className} manually.`)
      return null
    }

    const { code } = generateCode(mod)

    if (dryRun) {
      logger.info(`  UPDATE ${displayPath}`)
      logger.info(`    + import { ${className} } from '${rel}'`)
      logger.info(`    + ${target}: [..., ${className}]`)
      return modulePath
    }

    const { writeFileSync } = await import('node:fs')
    writeFileSync(modulePath, code, 'utf-8')
    logger.success(`  UPDATE ${displayPath}`)
    return modulePath
  } catch (err) {
    logger.warn(`  Could not update ${displayPath}. Register ${className} manually.`)
    return null
  }
}

/**
 * Walk the Babel AST to find the @Module({...}) decorator and push className
 * into the specified array property (imports/controllers/providers).
 */
export function addToModuleDecorator(ast: t.Program, target: RegistrationTarget, className: string): boolean {
  for (const node of ast.body) {
    const classNode: t.Node | null | undefined = node.type === 'ExportNamedDeclaration' ? node.declaration : node
    if (classNode?.type !== 'ClassDeclaration') continue

    for (const decorator of classNode.decorators ?? []) {
      if (decorator.expression.type !== 'CallExpression') continue
      const callee = decorator.expression.callee
      if (callee.type !== 'Identifier' || callee.name !== 'Module') continue

      const arg = decorator.expression.arguments[0]
      if (!arg || arg.type !== 'ObjectExpression') continue

      return addToArrayProperty(arg, target, className)
    }
  }

  return false
}

/**
 * Find or create the target array property in the @Module({}) ObjectExpression
 * and append the className identifier.
 */
function addToArrayProperty(objExpr: t.ObjectExpression, propertyName: string, className: string): boolean {
  const prop = objExpr.properties.find(
    (p): p is t.ObjectProperty =>
      p.type === 'ObjectProperty' && p.key.type === 'Identifier' && p.key.name === propertyName,
  )

  if (prop && prop.value.type === 'ArrayExpression') {
    const exists = prop.value.elements.some(
      (el): el is t.Identifier => el?.type === 'Identifier' && el.name === className,
    )
    if (!exists) {
      prop.value.elements.push({ type: 'Identifier', name: className } as t.Identifier)
    }
    return true
  }

  if (!prop) {
    objExpr.properties.push({
      type: 'ObjectProperty',
      key: { type: 'Identifier', name: propertyName },
      value: {
        type: 'ArrayExpression',
        elements: [{ type: 'Identifier', name: className }],
      },
      computed: false,
      shorthand: false,
    } as t.ObjectProperty)
    return true
  }

  return false
}
