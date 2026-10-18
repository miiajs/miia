import { registry } from '../addons/index.js'
import type { ProjectTree } from '../codemod/tree.js'
import type { Runtime } from '../runtime/types.js'
import { CliError } from '../utils/errors.js'
import { type ApplyContext, applyTemplate } from './apply.js'
import type { ProjectLayout } from './layout.js'

export interface Addon {
  id: string
  label: string
  hint: string
  kind: 'feature' | 'database' | 'tooling'
  /** Where it is available; default: every runtime */
  runtimes?: Runtime[]
  dependsOn?: string[]
  isInstalled(tree: ProjectTree, layout: ProjectLayout): boolean
  apply(ctx: AddonContext): void
}

export interface AddonContext extends ApplyContext {
  layout: ProjectLayout
  /** Selected in this run or already installed */
  has(id: string): boolean
  /** applyTemplate for templates/addons/<id>[/<dir>] */
  template(dir?: string): void
  /** Collected and printed at the end, e.g. a file a codemod could not edit */
  warn(message: string): void
}

export const addons: readonly Addon[] = registry

export function findAddon(id: string, registry: readonly Addon[] = addons): Addon | undefined {
  return registry.find((a) => a.id === id)
}

export function availableAddons(runtime: Runtime, registry: readonly Addon[] = addons): Addon[] {
  return registry.filter((a) => !a.runtimes || a.runtimes.includes(runtime))
}

/** Selected add-ons plus their dependencies, dependencies first. */
export function resolveAddons(ids: string[], runtime: Runtime, registry: readonly Addon[] = addons): Addon[] {
  const ordered: Addon[] = []
  const visit = (id: string, path: string[]) => {
    if (ordered.some((a) => a.id === id)) return
    if (path.includes(id)) throw new CliError(`Add-on dependency cycle: ${[...path, id].join(' -> ')}`)
    const addon = findAddon(id, registry)
    if (!addon) {
      const known = registry.map((a) => a.id).join(', ') || 'none'
      throw new CliError(`Unknown add-on "${id}". Available: ${known}`)
    }
    if (addon.runtimes && !addon.runtimes.includes(runtime)) {
      throw new CliError(`Add-on "${id}" is not available on ${runtime} (only ${addon.runtimes.join(', ')})`)
    }
    for (const dep of addon.dependsOn ?? []) visit(dep, [...path, id])
    ordered.push(addon)
  }
  for (const id of ids) visit(id, [])

  const databases = ordered.filter((a) => a.kind === 'database')
  if (databases.length > 1) {
    throw new CliError(`Pick one database, not ${databases.map((a) => a.id).join(' and ')}`)
  }
  return ordered
}

export function addonContext(
  ctx: ApplyContext,
  addon: Addon,
  opts: { layout: ProjectLayout; selected: readonly Addon[]; warnings: string[]; registry?: readonly Addon[] },
): AddonContext {
  const registry = opts.registry ?? addons
  return {
    ...ctx,
    layout: opts.layout,
    has: (id) =>
      opts.selected.some((a) => a.id === id) || !!findAddon(id, registry)?.isInstalled(ctx.tree, opts.layout),
    template: (dir) => {
      opts.warnings.push(...applyTemplate(ctx, dir ? `addons/${addon.id}/${dir}` : `addons/${addon.id}`))
    },
    warn: (message) => {
      opts.warnings.push(message)
    },
  }
}
