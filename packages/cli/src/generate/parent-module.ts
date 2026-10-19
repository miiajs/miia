import { existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * Find the nearest *.module.ts file by walking up from targetDir toward src/.
 * Prefers a module matching the directory name (e.g. user/ → user.module.ts), then `rootModule`
 * (the module main.ts registers) when a folder holds several.
 * Pass `excludeFile` to skip a specific path (e.g. a module file that was just generated).
 */
export function findParentModule(targetDir: string, excludeFile?: string, rootModule?: string | null): string | null {
  const srcRoot = findSrcRoot(targetDir)
  if (!srcRoot) return null

  // Walk up from targetDir toward src/
  let current = targetDir
  while (current.length >= srcRoot.length) {
    const moduleFile = findModuleInDir(current, excludeFile, rootModule)
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

function findModuleInDir(dir: string, excludeFile?: string, rootModule?: string | null): string | null {
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
  const preferred =
    modules.find((f) => f === `${dirName}.module.ts`) ?? modules.find((f) => join(dir, f) === rootModule)
  return join(dir, preferred ?? modules[0])
}
