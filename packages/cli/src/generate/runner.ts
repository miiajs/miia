import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { isAbsolute, join, posix, relative, sep } from 'node:path'
import type { PackageJson } from '../codemod/json.js'
import { addToModuleArray } from '../codemod/source.js'
import { ProjectTree } from '../codemod/tree.js'
import { loadTypeScript, type TS } from '../codemod/typescript.js'
import { projectRuntime } from '../scaffold/add.js'
import { applyTemplate, flavorOf } from '../scaffold/apply.js'
import { detectLayout } from '../scaffold/layout.js'
import { CliError } from '../utils/errors.js'
import { formatFiles } from '../utils/format.js'
import { logger } from '../utils/logger.js'
import { toCamelCase, toKebabCase, toPascalCase, validateArtifactName } from '../utils/naming.js'
import { cliVersion } from '../utils/package-info.js'
import { findParentModule } from './parent-module.js'
import { registerInModule } from './register.js'
import { describeSchematics, resolveSchematic } from './schematics.js'

export interface GenerateOptions {
  schematic: string
  name: string
  path?: string
  flat?: boolean
  export?: boolean
  dryRun?: boolean
}

/** Fills a tree with the artifact and its registration; nothing is written. */
export function planGenerate(
  options: GenerateOptions,
  deps: { cwd: string; ts: TS; cliVersion?: string },
): { tree: ProjectTree; warnings: string[] } {
  const { cwd, ts } = deps
  if (!existsSync(join(cwd, 'src'))) throw new CliError('Not a MiiaJS project (no src/ found). Run from project root.')

  const schematic = resolveSchematic(options.schematic)
  if (!schematic) throw new CliError(`Unknown schematic "${options.schematic}". Available: ${describeSchematics()}`)
  if (options.export && !schematic.exportable) {
    throw new CliError(`--export works with service only, not with ${schematic.name}`)
  }

  const { dir, name } = validateArtifactName(options.name)
  const path = options.path?.trim() ?? ''
  if (isAbsolute(path) || path.split(/[\\/]/).includes('..')) {
    throw new CliError(`--path must stay inside src/: ${options.path}`)
  }

  const className = toPascalCase(name)
  const file = toKebabCase(name)
  const base = posix.join('src', path.replaceAll('\\', '/'), dir)
  const nested = schematic.alwaysNested || (!options.flat && !dir)
  const target = nested ? posix.join(base, file) : base

  const tree = new ProjectTree(cwd)
  const pkgText = tree.read('package.json')
  const runtime = projectRuntime(pkgText ? (JSON.parse(pkgText) as PackageJson) : null, cwd)
  const ctx = {
    tree,
    ts,
    runtime,
    flavor: flavorOf(runtime),
    projectName: '',
    cliVersion: deps.cliVersion ?? cliVersion(),
    random: (bytes: number) => randomBytes(bytes).toString('hex'),
  }
  applyTemplate(ctx, `generate/${schematic.name}`, {
    target,
    identifiers: { __Name__: className, __name__: toCamelCase(name), __file__: file },
    strict: true,
  })

  const warnings: string[] = []
  const register = schematic.register
  if (!register) return { tree, warnings }

  const registered = register.className(className)
  const registeredFile = posix.join(target, register.file(file))
  // The resource's own module is in its folder: search from the folder around it
  const searchFrom = schematic.name === 'resource' ? base : target
  const { rootModule } = detectLayout(tree, ts)
  const parent = findParentModule(join(cwd, searchFrom), join(cwd, registeredFile), rootModule && join(cwd, rootModule))
  if (!parent) {
    warnings.push(`No parent module found. Register ${registered} manually.`)
    return { tree, warnings }
  }

  const modulePath = relative(cwd, parent).split(sep).join('/')
  const status = registerInModule(tree, ts, {
    modulePath,
    className: registered,
    file: registeredFile,
    key: register.key,
  })
  if (status === 'unsupported' || status === 'conflict') {
    warnings.push(`Register ${registered} manually in ${modulePath}`)
  } else if (options.export) {
    let exported = 'added'
    tree.update(modulePath, (text) => {
      const result = addToModuleArray(ts, text, { key: 'exports', element: registered, ref: registered })
      exported = result.status
      return result.text
    })
    if (exported === 'unsupported') warnings.push(`Add ${registered} to exports of ${modulePath} manually`)
  }
  return { tree, warnings }
}

export async function runGenerate(options: GenerateOptions): Promise<void> {
  const cwd = process.cwd()
  const { tree, warnings } = planGenerate(options, { cwd, ts: await loadTypeScript() })

  if (options.dryRun) {
    logger.info('DRY RUN - no files will be written\n')
    for (const line of tree.summary()) logger.info(`  ${line}`)
  } else {
    const written = await tree.commit()
    for (const line of tree.summary()) logger.success(`  ${line}`)
    await formatFiles(written, cwd)
  }
  for (const warning of warnings) logger.warn(`  ${warning}`)
}
