import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, posix } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Same folder from dist/scaffold/ and src/scaffold/: packages/cli/templates */
export const templatesDir: string = fileURLToPath(new URL('../../templates/', import.meta.url))

/** `bun` for Bun; `node` for Node.js and Deno, which run the same files */
export type Flavor = 'bun' | 'node'

export interface TemplateFile {
  path: string
  content: string
}

export interface Manifest {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  scripts?: Record<string, string>
}

// npm does not pack dotfiles such as .gitignore, and a biome.json inside the repo would be read as a
// nested Biome root, so templates store them under these names
const OUTPUT_NAMES: Record<string, string> = {
  _gitignore: '.gitignore',
  '_env.example': '.env.example',
  '_biome.json': 'biome.json',
}

/** For each template folder: files/ then files-<flavor>/; a later layer replaces an earlier one by path. */
export function readLayers(dirs: string[], flavor: Flavor, from = templatesDir): TemplateFile[] {
  const files = new Map<string, string>()
  for (const dir of dirs) {
    const root = join(from, dir)
    if (!existsSync(root)) throw new Error(`Unknown template: ${dir}`)
    for (const layer of ['files', `files-${flavor}`]) {
      const base = join(root, layer)
      for (const rel of walk(base)) files.set(rel, readFileSync(join(base, rel), 'utf-8'))
    }
  }
  return [...files]
    .map(([path, content]) => ({ path, content }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

/** manifest.json with manifest-<flavor>.json on top; null when the folder has neither. */
export function readManifest(dir: string, flavor: Flavor, from = templatesDir): Manifest | null {
  const read = (name: string): Manifest | null => {
    const file = join(from, dir, name)
    return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf-8')) as Manifest) : null
  }
  const base = read('manifest.json')
  const overlay = read(`manifest-${flavor}.json`)
  if (!base || !overlay) return base ?? overlay
  return overlayManifest(base, overlay)
}

/** The overlay wins: its versions and scripts replace the base, a package moves to the overlay's section. */
export function overlayManifest(base: Manifest, overlay: Manifest): Manifest {
  const result: Manifest = structuredClone(base)
  for (const kind of ['dependencies', 'devDependencies'] as const) {
    const other = kind === 'dependencies' ? 'devDependencies' : 'dependencies'
    for (const [name, range] of Object.entries(overlay[kind] ?? {})) {
      const section = result[other]
      if (section) {
        delete section[name]
        if (Object.keys(section).length === 0) delete result[other]
      }
      result[kind] = { ...result[kind], [name]: range }
    }
  }
  if (overlay.scripts) result.scripts = { ...result.scripts, ...overlay.scripts }
  return result
}

export function outputPath(templatePath: string): string {
  const name = posix.basename(templatePath)
  const mapped = OUTPUT_NAMES[name]
  return mapped ? posix.join(posix.dirname(templatePath), mapped) : templatePath
}

/** `{{key}}` for known keys; everything else, `${...}` included, stays as written. */
export function fillPlaceholders(text: string, values: Record<string, string>): string {
  return text.replace(/\{\{([\w:-]+)\}\}/g, (match, key: string) => values[key] ?? match)
}

/** `__Name__` / `__name__` / `__file__` / `__table__` in file contents and paths. */
export function replaceIdentifiers(text: string, values: Record<string, string>): string {
  let result = text
  for (const [key, value] of Object.entries(values)) result = result.replaceAll(key, value)
  return result
}

function walk(root: string, prefix = ''): string[] {
  if (!existsSync(root)) return []
  const found: string[] = []
  for (const entry of readdirSync(root)) {
    const rel = prefix ? `${prefix}/${entry}` : entry
    if (statSync(join(root, entry)).isDirectory()) found.push(...walk(join(root, entry), rel))
    else found.push(rel)
  }
  return found
}
