import { existsSync } from 'node:fs'
import { relative } from 'node:path'
import { writeFileRecursive } from './fs.js'
import { logger } from './logger.js'

export interface WriteResult {
  created: string[]
  modified: string[]
  skipped: string[]
}

export interface WriteFileOptions {
  dryRun?: boolean
  /** If true, allow overwriting existing files (used for module updates) */
  allowOverwrite?: boolean
}

export async function writeGeneratedFile(
  absolutePath: string,
  content: string,
  options: WriteFileOptions = {},
): Promise<'created' | 'skipped'> {
  const displayPath = relative(process.cwd(), absolutePath)

  if (!options.allowOverwrite && existsSync(absolutePath)) {
    logger.error(`  File already exists: ${displayPath}`)
    return 'skipped'
  }

  if (options.dryRun) {
    const lines = content.split('\n').length
    logger.info(`  CREATE ${displayPath} (${lines} lines)`)
    return 'created'
  }

  await writeFileRecursive(absolutePath, content)
  logger.success(`  CREATE ${displayPath}`)
  return 'created'
}

export async function writeGeneratedFiles(
  files: Array<{ path: string; content: string }>,
  options: WriteFileOptions = {},
): Promise<WriteResult> {
  const result: WriteResult = { created: [], modified: [], skipped: [] }

  if (!options.allowOverwrite) {
    const conflicts = files.filter((f) => existsSync(f.path))
    if (conflicts.length > 0) {
      for (const c of conflicts) {
        logger.error(`  File already exists: ${relative(process.cwd(), c.path)}`)
      }
      return { created: [], modified: [], skipped: files.map((f) => f.path) }
    }
  }

  for (const file of files) {
    const status = await writeGeneratedFile(file.path, file.content, options)
    if (status === 'created') {
      result.created.push(file.path)
    } else {
      result.skipped.push(file.path)
    }
  }

  return result
}
