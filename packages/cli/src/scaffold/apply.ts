import { posix } from 'node:path'
import { mergeDependencies, mergeScripts, type PackageJson, updateJson } from '../codemod/json.js'
import type { ProjectTree } from '../codemod/tree.js'
import type { TS } from '../codemod/typescript.js'
import type { Runtime } from '../runtime/types.js'
import { CliError } from '../utils/errors.js'
import {
  type Flavor,
  fillPlaceholders,
  type Manifest,
  outputPath,
  overlayManifest,
  readLayers,
  readManifest,
  replaceIdentifiers,
} from './templates.js'
import { toNodeTestRunner } from './test-runner.js'

export interface ApplyContext {
  tree: ProjectTree
  ts: TS
  runtime: Runtime
  flavor: Flavor
  projectName: string
  /** `^cliVersion` replaces `workspace:*`; a fixed value in tests keeps snapshots stable */
  cliVersion: string
  /** Hex string of `bytes` random bytes, for secrets written to .env */
  random: (bytes: number) => string
}

export interface ApplyOptions {
  /** Folder relative to the project root; default: the root */
  target?: string
  /** `{{key}}` values */
  placeholders?: Record<string, string>
  /** `__Name__` / `__name__` / `__file__` values, in contents and file names */
  identifiers?: Record<string, string>
  /** Refuse any existing file, identical content included (generate) */
  strict?: boolean
}

export function flavorOf(runtime: Runtime): Flavor {
  return runtime === 'bun' ? 'bun' : 'node'
}

/**
 * Copies template folders (layered in order) into the tree and merges their manifests into
 * package.json. A file that already exists with the same content is skipped; every file that exists
 * with other content is reported in one error before anything is created. Returns warnings.
 */
export function applyTemplate(ctx: ApplyContext, dirs: string | string[], opts: ApplyOptions = {}): string[] {
  const list = Array.isArray(dirs) ? dirs : [dirs]
  const files = readLayers(list, ctx.flavor).map((file) => {
    let path = outputPath(file.path)
    let content = file.content
    if (opts.identifiers) {
      path = replaceIdentifiers(path, opts.identifiers)
      content = replaceIdentifiers(content, opts.identifiers)
    }
    if (opts.placeholders) content = fillPlaceholders(content, opts.placeholders)
    if (ctx.flavor === 'node' && path.endsWith('.test.ts')) content = toNodeTestRunner(ctx.ts, content)
    return { path: opts.target ? posix.join(opts.target, path) : path, content }
  })

  const conflicts = files.filter((f) => {
    const existing = ctx.tree.read(f.path)
    return existing !== null && (opts.strict || existing !== f.content)
  })
  if (conflicts.length > 0) {
    const listing = conflicts.map((f) => `  ${f.path}`).join('\n')
    const what = opts.strict ? 'already exist' : 'already exist with different content'
    throw new CliError(`These files ${what}:\n${listing}`)
  }
  for (const file of files) {
    if (ctx.tree.read(file.path) === null) ctx.tree.create(file.path, file.content)
  }

  let manifest: Manifest | null = null
  for (const dir of list) {
    const next = readManifest(dir, ctx.flavor)
    if (next) manifest = manifest ? overlayManifest(manifest, next) : next
  }
  return manifest ? applyManifest(ctx, manifest) : []
}

function applyManifest(ctx: ApplyContext, manifest: Manifest): string[] {
  const warnings: string[] = []
  const versions = (deps: Record<string, string>) =>
    Object.fromEntries(
      Object.entries(deps).map(([name, range]) => [name, range === 'workspace:*' ? `^${ctx.cliVersion}` : range]),
    )

  ctx.tree.update('package.json', (text) =>
    updateJson<PackageJson>(text, 'package.json', (pkg) => {
      if (manifest.dependencies) mergeDependencies(pkg, 'dependencies', versions(manifest.dependencies))
      if (manifest.devDependencies) mergeDependencies(pkg, 'devDependencies', versions(manifest.devDependencies))
      for (const name of mergeScripts(pkg, manifest.scripts ?? {})) {
        warnings.push(`package.json already has a "${name}" script; kept it`)
      }
    }),
  )
  return warnings
}
