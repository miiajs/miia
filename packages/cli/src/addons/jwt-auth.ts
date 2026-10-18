import type { Addon } from '../scaffold/addons.js'
import { addEnv, configReader, fromRootModule, hasDependency, registerModule } from './helpers.js'

export const jwtAuth: Addon = {
  id: 'jwt-auth',
  label: 'JWT auth',
  hint: 'register, login and /auth/me with an in-memory user store',
  kind: 'feature',
  isInstalled: (tree) => hasDependency(tree, '@miiajs/jwt') || tree.exists('src/auth/auth.module.ts'),
  apply(ctx) {
    ctx.template()
    const config = configReader(ctx)
    registerModule(ctx, {
      ref: 'JwtModule',
      element: [
        'JwtModule.configure(',
        '  (resolve) => ({',
        `    secret: ${config.get('JWT_SECRET')},`,
        "    expiresIn: '1h',",
        '  }),',
        '  { global: true },',
        ')',
      ].join('\n'),
      imports: [{ from: '@miiajs/jwt', names: ['JwtModule'] }, ...config.imports],
    })
    registerModule(ctx, {
      ref: 'AuthModule',
      element: 'AuthModule',
      imports: [{ from: fromRootModule(ctx, 'src/auth/auth.module.ts'), names: ['AuthModule'] }],
    })
    addEnv(ctx, {
      key: 'JWT_SECRET',
      schema: 'z.string().min(32)',
      example: 'change-me-to-a-random-string-of-at-least-32-chars',
      value: ctx.random(32),
    })
  },
}
