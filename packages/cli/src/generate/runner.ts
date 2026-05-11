import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { resolveSchematic, isResourceSchematic, listSchematics } from './schematics.js'
import { findParentModule, registerInModule } from './module-updater.js'
import { toKebabCase, toPascalCase } from '../utils/naming.js'
import { writeGeneratedFiles } from '../utils/writer.js'
import { formatFiles } from '../utils/format.js'
import { logger } from '../utils/logger.js'
import { resourceModuleTemplate, resourceControllerTemplate, resourceServiceTemplate } from './templates/resource.js'
import type { GenerateContext, GenerateOptions, GeneratedFile } from './types.js'

export async function runGenerate(options: GenerateOptions): Promise<void> {
  const { name, path, flat = false, dryRun = false } = options

  // Validate project structure
  const srcDir = resolve(process.cwd(), 'src')
  if (!existsSync(srcDir)) {
    logger.error('Not a MiiaJS project (no src/ found). Run from project root.')
    process.exit(1)
  }

  // Resolve schematic
  const schematic = resolveSchematic(options.schematic)
  if (!schematic) {
    logger.error(`Unknown schematic "${options.schematic}". Available:`)
    for (const s of listSchematics()) {
      const aliases = s.aliases.length ? ` (${s.aliases.join(', ')})` : ''
      logger.info(`  ${s.name}${aliases}`)
    }
    process.exit(1)
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

  if (dryRun) {
    logger.info('DRY RUN - no files will be written\n')
  }

  if (isResourceSchematic(schematic)) {
    await generateResource({ fileName, className, targetDir, dryRun, rawName: name })
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
    const content = schematic.template(ctx)

    const result = await writeGeneratedFiles([{ path: filePath, content }], { dryRun })

    if (result.skipped.length > 0) {
      process.exit(1)
    }

    // Auto-register in parent module
    let modifiedModule: string | null = null
    if (schematic.registrationTarget && result.created.length > 0) {
      const classWithSuffix = getClassNameWithSuffix(className, schematic.name)
      const parentModule = findParentModule(fileDir, filePath)
      if (parentModule) {
        modifiedModule = await registerInModule(
          parentModule,
          classWithSuffix,
          filePath,
          schematic.registrationTarget,
          dryRun,
        )
      } else {
        logger.warn(`  No parent module found. Register ${classWithSuffix} manually.`)
      }
    }

    // Format generated + modified files
    if (!dryRun && result.created.length > 0) {
      const toFormat = [...result.created, ...(modifiedModule ? [modifiedModule] : [])]
      await formatFiles(toFormat, process.cwd())
    }
  }
}

async function generateResource(opts: {
  fileName: string
  className: string
  targetDir: string
  dryRun: boolean
  rawName: string
}): Promise<void> {
  const { fileName, className, targetDir, dryRun, rawName } = opts
  const resourceDir = join(targetDir, fileName)

  const ctx: GenerateContext = {
    rawName,
    className,
    fileName,
    targetDir: resourceDir,
    schematic: 'resource',
    dryRun,
  }

  const files: GeneratedFile[] = [
    { path: join(resourceDir, `${fileName}.module.ts`), content: resourceModuleTemplate(ctx) },
    { path: join(resourceDir, `${fileName}.controller.ts`), content: resourceControllerTemplate(ctx) },
    { path: join(resourceDir, `${fileName}.service.ts`), content: resourceServiceTemplate(ctx) },
  ]

  const result = await writeGeneratedFiles(files, { dryRun })

  if (result.skipped.length > 0) {
    process.exit(1)
  }

  // Register the resource module in parent module's imports
  let modifiedModule: string | null = null
  if (result.created.length > 0) {
    const modulePath = files[0].path
    const moduleClassName = `${className}Module`
    const parentModule = findParentModule(targetDir, modulePath)
    if (parentModule) {
      modifiedModule = await registerInModule(parentModule, moduleClassName, modulePath, 'imports', dryRun)
    } else {
      logger.warn(`  No parent module found. Register ${moduleClassName} manually.`)
    }
  }

  if (!dryRun && result.created.length > 0) {
    const toFormat = [...result.created, ...(modifiedModule ? [modifiedModule] : [])]
    await formatFiles(toFormat, process.cwd())
  }
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
