import { CliError } from '../utils/errors.js'

export interface PackageJson {
  name?: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  scripts?: Record<string, string>
  [key: string]: unknown
}

export type DependencyKind = 'dependencies' | 'devDependencies'

const DEPENDENCY_SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies'] as const

/**
 * Edits a JSON file through `fn`. Unchanged value -> the same text byte for byte; otherwise the
 * file's indent, EOL and final newline are kept. JSONC is refused rather than stripped of comments.
 */
export function updateJson<T>(text: string, path: string, fn: (value: T) => void): string {
  let original: T
  try {
    original = JSON.parse(text) as T
  } catch {
    throw new CliError(`Cannot update ${path}: not plain JSON`)
  }
  const value = structuredClone(original)
  fn(value)
  if (JSON.stringify(value) === JSON.stringify(original)) return text

  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const indent = /^([ \t]+)"/m.exec(text)?.[1] ?? '  '
  const body = JSON.stringify(value, null, indent).replaceAll('\n', eol)
  return /\r?\n$/.test(text) ? body + eol : body
}

/** User versions win; keys are sorted only when something was added. */
export function mergeDependencies(
  pkg: PackageJson,
  kind: DependencyKind,
  deps: Record<string, string>,
  opts: { move?: boolean } = {},
): void {
  let added = false
  for (const [name, range] of Object.entries(deps)) {
    if (pkg[kind]?.[name] !== undefined) continue
    const other = DEPENDENCY_SECTIONS.find((section) => section !== kind && pkg[section]?.[name] !== undefined)
    let version = range
    if (other) {
      if (!opts.move) continue
      const section = pkg[other] as Record<string, string>
      version = section[name]
      delete section[name]
      if (Object.keys(section).length === 0) delete pkg[other]
    }
    pkg[kind] = { ...pkg[kind], [name]: version }
    added = true
  }
  if (added) pkg[kind] = sortKeys(pkg[kind] ?? {})
}

/** Adds missing scripts; returns the names that already exist with a different command (left as they are). */
export function mergeScripts(pkg: PackageJson, scripts: Record<string, string>): string[] {
  const conflicts: string[] = []
  for (const [name, command] of Object.entries(scripts)) {
    const current = pkg.scripts?.[name]
    if (current === undefined) pkg.scripts = { ...pkg.scripts, [name]: command }
    else if (current !== command) conflicts.push(name)
  }
  return conflicts
}

function sortKeys(record: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
}
