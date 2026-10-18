import type { Addon } from '../scaffold/addons.js'
import { beforeListen, hasDependency } from './helpers.js'

export const serveStatic: Addon = {
  id: 'serve-static',
  label: 'Static files',
  hint: './public served at /static',
  kind: 'feature',
  isInstalled: (tree) => hasDependency(tree, '@miiajs/serve-static'),
  apply(ctx) {
    ctx.template()
    beforeListen(ctx, {
      statement: (app) => `serveStatic(${app}, '/static', './public')`,
      exists: (text) => /\bserveStatic\(/.test(text),
      imports: [{ from: '@miiajs/serve-static', names: ['serveStatic'] }],
    })
  },
}
