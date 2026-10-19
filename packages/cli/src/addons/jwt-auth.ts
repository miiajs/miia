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
    // Empty in .env.example: a copied example must not start the app with a publicly known HS256 secret
    addEnv(ctx, {
      key: 'JWT_SECRET',
      schema: 'z.string().min(32)',
      example: '',
      value: ctx.random(32),
      comment: 'At least 32 random characters, e.g. openssl rand -hex 32',
    })
  },
}
