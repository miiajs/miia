import type { Addon } from '../scaffold/addons.js'
import { addEnv, beforeListen, mainDeclares } from './helpers.js'

export const cors: Addon = {
  id: 'cors',
  label: 'CORS',
  hint: 'cors() with the origin from CORS_ORIGIN',
  kind: 'feature',
  isInstalled: (tree, layout) => !!layout.main && /\bcors\(/.test(tree.read(layout.main) ?? ''),
  apply(ctx) {
    const withConfig = mainDeclares(ctx, 'config')
    beforeListen(ctx, {
      statement: (app) =>
        withConfig ? `${app}.use(cors({ origin: config.get('CORS_ORIGIN') }))` : `${app}.use(cors())`,
      exists: (text) => /\bcors\(/.test(text),
      imports: [{ from: '@miiajs/core', names: ['cors'] }],
    })
    if (!withConfig) {
      ctx.warn('No `const config` (ConfigService) in src/main.ts: cors() allows every origin; pass { origin } yourself')
      return
    }
    addEnv(ctx, { key: 'CORS_ORIGIN', schema: "z.string().default('*')", example: '*' })
  },
}
