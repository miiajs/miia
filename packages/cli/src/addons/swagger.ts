import type { Addon } from '../scaffold/addons.js'
import { hasDependency, quoted, registerModule } from './helpers.js'

export const swagger: Addon = {
  id: 'swagger',
  label: 'Swagger',
  hint: 'OpenAPI 3.1 spec at /docs/json, UI at /docs',
  kind: 'feature',
  isInstalled: (tree) => hasDependency(tree, '@miiajs/swagger'),
  apply(ctx) {
    ctx.template()
    registerModule(ctx, {
      ref: 'SwaggerModule',
      element: `SwaggerModule.configure({ title: ${quoted(ctx.projectName)}, version: '0.1.0' })`,
      imports: [{ from: '@miiajs/swagger', names: ['SwaggerModule'] }],
    })
  },
}
