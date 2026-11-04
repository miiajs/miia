import { randomBytes } from 'node:crypto'
import type { PackageJson } from '../codemod/json.js'
import { ProjectTree } from '../codemod/tree.js'
import type { TS } from '../codemod/typescript.js'
import { isRuntime, resolveRuntime } from '../runtime/detect.js'
import { defaultPackageManager, detectPackageManager, type PackageManager } from '../runtime/package-manager.js'
import type { Runtime } from '../runtime/types.js'
import { CliError } from '../utils/errors.js'
import { type Addon, addonContext, addons, resolveAddons } from './addons.js'
import { type ApplyContext, flavorOf } from './apply.js'
import { detectLayout, type ProjectLayout } from './layout.js'

export interface Project {
  ctx: ApplyContext
  layout: ProjectLayout
  packageManager: PackageManager
}

const DATABASE_PACKAGES = ['@miiajs/drizzle', '@miiajs/papr', '@miiajs/mongoose']

/** An existing project in `cwd`: runtime from `scripts.dev --runtime`, else detection. */
export function openProject(
  cwd: string,
  ts: TS,
  opts: { cliVersion: string; random?: (bytes: number) => string },
): Project {
  const tree = new ProjectTree(cwd)
  const text = tree.read('package.json')
  const pkg = text ? (JSON.parse(text) as PackageJson) : null
  if (!pkg || (!pkg.dependencies?.['@miiajs/core'] && !pkg.devDependencies?.['@miiajs/core'])) {
    throw new CliError('Run miia add from the project root (a package.json with @miiajs/core)')
  }

  const runtime = projectRuntime(pkg, cwd)
  const packageManager = detectPackageManager(cwd) ?? defaultPackageManager(runtime)

  return {
    ctx: {
      tree,
      ts,
      runtime,
      flavor: flavorOf(runtime),
      projectName: pkg.name ?? 'app',
      cliVersion: opts.cliVersion,
      random: opts.random ?? ((bytes) => randomBytes(bytes).toString('hex')),
    },
    layout: detectLayout(tree, ts),
    packageManager,
  }
}

/** The runtime pinned in `scripts.dev` (`miia dev --runtime x`), else detection. */
export function projectRuntime(pkg: PackageJson | null, cwd: string): Runtime {
  const pinned = /(?:--runtime|-r)[=\s]+(\w+)/.exec(pkg?.scripts?.dev ?? '')?.[1]
  return pinned && isRuntime(pinned) ? pinned : resolveRuntime(cwd).runtime
}

export function installedAddons(project: Project, registry: readonly Addon[] = addons): Addon[] {
  return registry.filter((a) => a.isInstalled(project.ctx.tree, project.layout))
}

/** Applies add-ons to the project tree; installed ones are skipped, a second database is refused. */
export function addToProject(
  project: Project,
  ids: string[],
  registry: readonly Addon[] = addons,
): { applied: Addon[]; skipped: Addon[]; warnings: string[]; next: string[] } {
  const { ctx, layout } = project
  const selected = resolveAddons(ids, ctx.runtime, registry)

  // Before isInstalled: drizzle-mysql in a postgres project is a conflict, not "already installed"
  const usedDatabase = DATABASE_PACKAGES.find((name) => dependsOn(ctx, name))
  for (const addon of selected) {
    if (addon.kind === 'database' && usedDatabase && !addon.isInstalled(ctx.tree, layout)) {
      throw new CliError(`Project already uses ${usedDatabase}; ${addon.id} would be a second database`)
    }
  }

  const warnings: string[] = []
  const next: string[] = []
  const applied: Addon[] = []
  const skipped: Addon[] = []
  for (const addon of selected) {
    if (addon.isInstalled(ctx.tree, layout)) {
      skipped.push(addon)
      continue
    }
    addon.apply(
      addonContext(ctx, addon, { layout, selected, warnings, next, registry, packageManager: project.packageManager }),
    )
    applied.push(addon)
  }
  return { applied, skipped, warnings, next }
}

export function dependencySnapshot(tree: ProjectTree): string {
  const pkg = JSON.parse(tree.read('package.json') ?? '{}') as PackageJson
  return JSON.stringify([pkg.dependencies ?? {}, pkg.devDependencies ?? {}])
}

function dependsOn(ctx: ApplyContext, name: string): boolean {
  const pkg = JSON.parse(ctx.tree.read('package.json') ?? '{}') as PackageJson
  return pkg.dependencies?.[name] !== undefined || pkg.devDependencies?.[name] !== undefined
}
