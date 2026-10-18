import type { Addon } from '../scaffold/addons.js'

export const biome: Addon = {
  id: 'biome',
  label: 'Biome',
  hint: 'formatter and linter',
  kind: 'tooling',
  isInstalled: (tree) => tree.exists('biome.json') || tree.exists('biome.jsonc'),
  apply(ctx) {
    ctx.template()
  },
}
