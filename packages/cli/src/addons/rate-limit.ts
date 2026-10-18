import type { Addon } from '../scaffold/addons.js'
import { beforeListen, hasDependency, registerModule } from './helpers.js'

export const rateLimit: Addon = {
  id: 'rate-limit',
  label: 'Rate limit',
  hint: 'global guard, 100 requests a minute per client',
  kind: 'feature',
  isInstalled: (tree) => hasDependency(tree, '@miiajs/rate-limit'),
  apply(ctx) {
    ctx.template()
    registerModule(ctx, {
      ref: 'RateLimitModule',
      element: "RateLimitModule.configure({ limit: 100, window: '1m' }, { global: true })",
      imports: [{ from: '@miiajs/rate-limit', names: ['RateLimitModule'] }],
    })
    beforeListen(ctx, {
      statement: (app) => `${app}.useGuard(RateLimitGuard)`,
      exists: (text) => /\.useGuard\(\s*RateLimitGuard\b/.test(text),
      imports: [{ from: '@miiajs/rate-limit', names: ['RateLimitGuard'] }],
    })
  },
}
