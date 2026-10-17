import { accessSync, constants, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD'

export interface FindExecutableOptions {
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  cwd?: string
}

export function findExecutable(name: string, opts: FindExecutableOptions = {}): string | null {
  const env = opts.env ?? process.env
  const platform = opts.platform ?? process.platform
  const win = platform === 'win32'
  const pathValue = envValue(env, 'PATH', win) ?? ''
  const extensions = win ? candidateExtensions(name, envValue(env, 'PATHEXT', win)) : ['']

  for (const entry of pathValue.split(win ? ';' : ':')) {
    if (!entry) continue
    const dir = opts.cwd ? resolve(opts.cwd, entry) : entry
    const found = probe(dir, name, extensions, win)
    if (found) return found
  }
  return null
}

export function findLocalBin(cwd: string, name: string, platform: NodeJS.Platform = process.platform): string | null {
  const win = platform === 'win32'
  const extensions = win ? candidateExtensions(name, envValue(process.env, 'PATHEXT', win)) : ['']

  let dir = cwd
  while (true) {
    const found = probe(join(dir, 'node_modules', '.bin'), name, extensions, win)
    if (found) return found
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

function probe(dir: string, name: string, extensions: string[], win: boolean): string | null {
  if (!win) {
    const candidate = join(dir, name)
    return isExecutable(candidate, false) ? candidate : null
  }
  // PATHEXT is upper case while shims are usually lower case: match against the listing, case-insensitively
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return null
  }
  for (const ext of extensions) {
    const wanted = (name + ext).toLowerCase()
    const entry = entries.find((e) => e.toLowerCase() === wanted)
    if (entry && isExecutable(join(dir, entry), true)) return join(dir, entry)
  }
  return null
}

function isExecutable(file: string, win: boolean): boolean {
  try {
    if (!statSync(file).isFile()) return false
    if (!win) accessSync(file, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function candidateExtensions(name: string, pathExt: string | undefined): string[] {
  const extensions = (pathExt ?? DEFAULT_PATHEXT).split(';').filter(Boolean)
  const lower = name.toLowerCase()
  return extensions.some((ext) => lower.endsWith(ext.toLowerCase())) ? ['', ...extensions] : extensions
}

// Windows environment keys are case-insensitive (`Path`, `PATH`)
function envValue(env: NodeJS.ProcessEnv, key: string, win: boolean): string | undefined {
  if (!win) return env[key]
  const match = Object.keys(env).find((k) => k.toUpperCase() === key)
  return match === undefined ? undefined : env[match]
}
