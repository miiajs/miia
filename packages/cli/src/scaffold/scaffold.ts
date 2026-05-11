import { resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { writeFileRecursive } from '../utils/fs.js'
import { installDependencies } from './package-install.js'
import { resolveFeatures } from './features/registry.js'
import { buildPackageJson, buildTsconfig, buildGitignore, buildEnvFile } from './project-files.js'
import { composeAppModule, composeMainTs, composeAppController, composeAppService } from './app-composer.js'
import { logger } from '../utils/logger.js'
import type { Runtime } from '../runtime/types.js'
import type { FeatureId, ScaffoldContext } from './types.js'
import type { PackageManager } from './prompts.js'
import * as p from '@clack/prompts'

export interface ScaffoldOptions {
  name: string
  runtime: Runtime
  featureIds: FeatureId[]
  packageManager: PackageManager
  targetDir: string
  dryRun?: boolean
  skipInstall?: boolean
}

export async function scaffoldProject(options: ScaffoldOptions): Promise<void> {
  const { name, runtime, featureIds, packageManager, targetDir, dryRun = false, skipInstall = false } = options
  const root = resolve(process.cwd(), targetDir)

  if (existsSync(root)) {
    logger.error(`Directory "${targetDir}" already exists`)
    process.exit(1)
  }

  // Resolve features (auto-select requires, check conflicts)
  const { features, error } = resolveFeatures(featureIds)
  if (error) {
    logger.error(error)
    process.exit(1)
  }

  const ctx: ScaffoldContext = { name, runtime, features, dryRun }

  if (dryRun) {
    logger.info('DRY RUN - no files will be written\n')
  }

  // Collect all files to write
  const files: Record<string, string> = {
    'package.json': buildPackageJson({ name, runtime, features }),
    'tsconfig.json': buildTsconfig(runtime),
    '.gitignore': buildGitignore(),
    'src/main.ts': composeMainTs({ runtime, features }),
    'src/app/app.module.ts': composeAppModule({ runtime, features }),
    'src/app/app.controller.ts': composeAppController(),
    'src/app/app.service.ts': composeAppService(),
  }

  // Add .env if any feature has envVars (or base env needed)
  const hasEnvVars = features.some((f) => f.envVars)
  if (hasEnvVars) {
    files['.env'] = buildEnvFile(features)
  }

  // Add feature-specific files
  for (const feature of features) {
    if (feature.files) {
      const featureFiles = feature.files(ctx)
      Object.assign(files, featureFiles)
    }
  }

  // Write files
  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = resolve(root, relativePath)
    if (dryRun) {
      logger.info(`  CREATE ${relativePath}`)
    } else {
      await writeFileRecursive(fullPath, content)
      logger.success(`  CREATE ${relativePath}`)
    }
  }

  // Install dependencies
  if (!dryRun && !skipInstall) {
    console.log()
    await installDependencies(root, packageManager)
  } else if (dryRun) {
    console.log()
    const allDeps: Record<string, string> = Object.assign({}, ...features.map((f) => f.packages))
    const allDevDeps: Record<string, string> = Object.assign({}, ...features.map((f) => f.devPackages ?? {}))
    const depList = Object.entries(allDeps)
      .map(([k, v]) => `    ${k} ${v}`)
      .join('\n')
    const devDepList = Object.entries(allDevDeps)
      .map(([k, v]) => `    ${k} ${v} (dev)`)
      .join('\n')
    if (depList || devDepList) {
      logger.info('  Dependencies that would be installed:')
      if (depList) logger.info(depList)
      if (devDepList) logger.info(devDepList)
    }
  }

  if (!dryRun) {
    console.log()
    p.outro(`Project "${name}" created successfully!\n\n  cd ${targetDir}\n  miia dev`)
  }
}
