import { existsSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { ProjectTree } from '../codemod/tree.js'
import { loadTypeScript } from '../codemod/typescript.js'
import { CliError } from '../utils/errors.js'
import { formatFiles } from '../utils/format.js'
import { logger } from '../utils/logger.js'
import { toKebabCase, toPascalCase } from '../utils/naming.js'
import { findParentModule } from './parent-module.js'
import { registerInModule } from './register.js'
import { isResourceSchematic, listSchematics, resolveSchematic } from './schematics.js'
import { resourceControllerTemplate, resourceModuleTemplate, resourceServiceTemplate } from './templates/resource.js'
import type { GenerateContext, GenerateOptions, GeneratedFile, RegistrationTarget } from './types.js'

export async function runGenerate(options: GenerateOptions): Promise<void> {
  const { name, path, flat = false, dryRun = false } = options
  const cwd = process.cwd()

  // Validate project structure
  const srcDir = resolve(cwd, 'src')
  if (!existsSync(srcDir)) {
    throw new CliError('Not a MiiaJS project (no src/ found). Run from project root.')
  }

  // Resolve schematic
  const schematic = resolveSchematic(options.schematic)
  if (!schematic) {
    const available = listSchematics().map((s) => `  ${s.name}${s.aliases.length ? ` (${s.aliases.join(', ')})` : ''}`)
    throw new CliError([`Unknown schematic "${options.schematic}". Available:`, ...available].join('\n'))
  }

  // Parse name (supports "auth/user" → path=auth, name=user)
  const parts = name.split('/')
  const artifactName = parts.pop()!
  const extraPath = parts.join('/')

  const fileName = toKebabCase(artifactName)
  const className = toPascalCase(artifactName)

  // Resolve target directory
  let targetDir = srcDir
  if (path) targetDir = join(targetDir, path)
  if (extraPath) targetDir = join(targetDir, extraPath)

  let files: GeneratedFile[]
  let registration: { file: string; className: string; key: RegistrationTarget; searchFrom: string } | null

  if (isResourceSchematic(schematic)) {
    const resourceDir = join(targetDir, fileName)
    const ctx: GenerateContext = {
      rawName: name,
      className,
      fileName,
      targetDir: resourceDir,
      schematic: 'resource',
      dryRun,
    }
    files = [
      { path: join(resourceDir, `${fileName}.module.ts`), content: resourceModuleTemplate(ctx) },
      { path: join(resourceDir, `${fileName}.controller.ts`), content: resourceControllerTemplate(ctx) },
      { path: join(resourceDir, `${fileName}.service.ts`), content: resourceServiceTemplate(ctx) },
    ]
    registration = { file: files[0].path, className: `${className}Module`, key: 'imports', searchFrom: targetDir }
  } else {
    // Slash in name implies the user chose the directory - don't nest further
    const useFlat = flat || extraPath.length > 0
    const fileDir = useFlat ? targetDir : join(targetDir, fileName)
    const ctx: GenerateContext = {
      rawName: name,
      className,
      fileName,
      targetDir: fileDir,
      schematic: schematic.name,
      dryRun,
    }
    const filePath = join(fileDir, `${fileName}${schematic.fileSuffix}.ts`)
    files = [{ path: filePath, content: schematic.template(ctx) }]
    registration = schematic.registrationTarget
      ? {
          file: filePath,
          className: getClassNameWithSuffix(className, schematic.name),
          key: schematic.registrationTarget,
          searchFrom: fileDir,
        }
      : null
  }

  const ts = await loadTypeScript()
  const tree = new ProjectTree(cwd)
  const rel = (abs: string) => relative(cwd, abs).split(sep).join('/')

  for (const file of files) tree.create(rel(file.path), file.content)

  if (registration) {
    const parentModule = findParentModule(registration.searchFrom, registration.file)
    if (parentModule) {
      const modulePath = rel(parentModule)
      const status = registerInModule(tree, ts, {
        modulePath,
        className: registration.className,
        file: rel(registration.file),
        key: registration.key,
      })
      if (status === 'unsupported' || status === 'conflict') {
        logger.warn(`  Register ${registration.className} manually in ${modulePath}`)
      }
    } else {
      logger.warn(`  No parent module found. Register ${registration.className} manually.`)
    }
  }

  if (dryRun) {
    logger.info('DRY RUN - no files will be written\n')
    for (const line of tree.summary()) logger.info(`  ${line}`)
    return
  }

  const written = await tree.commit()
  for (const line of tree.summary()) logger.success(`  ${line}`)
  await formatFiles(written, cwd)
}

function getClassNameWithSuffix(className: string, schematic: string): string {
  const suffixMap: Record<string, string> = {
    module: 'Module',
    controller: 'Controller',
    service: 'Service',
    guard: 'Guard',
  }
  return `${className}${suffixMap[schematic] ?? ''}`
}
