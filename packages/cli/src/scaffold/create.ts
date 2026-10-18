import { type PackageJson, updateJson } from '../codemod/json.js'
import { execCommand, runScriptCommand } from '../runtime/package-manager.js'
import { addonContext, resolveAddons } from './addons.js'
import { type ApplyContext, applyTemplate } from './apply.js'
import { newProjectLayout } from './layout.js'
import type { NewOptions } from './options.js'
import { applyRuntime } from './runtimes.js'

/** Fills the tree with a new project: base + runtime layers, then add-ons the way `miia add` applies them. */
export function createProject(ctx: ApplyContext, options: NewOptions): { warnings: string[] } {
  const pm = options.packageManager
  const placeholders: Record<string, string> = { name: options.name, exec: execCommand(pm) }
  for (const script of ['dev', 'test', 'check', 'build', 'start'])
    placeholders[`run:${script}`] = runScriptCommand(pm, script)

  const warnings = applyTemplate(ctx, ['base', `runtimes/${options.runtime}`], { placeholders })
  ctx.tree.create('.env', ctx.tree.read('.env.example') ?? '')
  ctx.tree.update('package.json', (text) =>
    updateJson<PackageJson>(text, 'package.json', (pkg) => {
      pkg.name = options.name
    }),
  )
  applyRuntime(ctx)

  const selected = resolveAddons(options.addons, options.runtime)
  for (const addon of selected) {
    addon.apply(addonContext(ctx, addon, { layout: newProjectLayout, selected, warnings }))
  }
  return { warnings }
}
