import type { Addon, AddonContext } from '../scaffold/addons.js'
import { addTableToSchema, readDrizzleConfig } from '../scaffold/drizzle-config.js'
import { CliError } from '../utils/errors.js'
import { addEnv, configReader, fromRootModule, hasDependency, hasScript, registerModule } from './helpers.js'

export const jwtAuth: Addon = {
  id: 'jwt-auth',
  label: 'JWT auth',
  hint: 'register, login and /auth/me; users live in your database, in memory without one',
  kind: 'feature',
  isInstalled: (tree) => hasDependency(tree, '@miiajs/jwt') || tree.exists('src/auth/auth.module.ts'),
  apply(ctx) {
    const layers = usersLayers(ctx)
    ctx.template(...layers)
    if (layers.includes('with-drizzle')) addUsersTable(ctx)
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
      ref: 'UsersModule',
      element: 'UsersModule',
      imports: [{ from: fromRootModule(ctx, 'src/users/users.module.ts'), names: ['UsersModule'] }],
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

/** Template layers for the store of users: [] keeps them in memory, the base variant. */
function usersLayers(ctx: AddonContext): string[] {
  if (hasDependency(ctx.tree, '@miiajs/papr')) return ['with-papr']
  if (hasDependency(ctx.tree, '@miiajs/mongoose')) return ['with-mongoose']
  if (!hasDependency(ctx.tree, '@miiajs/drizzle')) return []
  try {
    return ['with-drizzle', `with-drizzle-${readDrizzleConfig(ctx.tree, ctx.ts).dialect}`]
  } catch (error) {
    if (!(error instanceof CliError)) throw error
    ctx.warn(
      'No postgresql, mysql or sqlite dialect in drizzle.config.ts: src/users/users.service.ts keeps users in memory, move it to the database',
    )
    return []
  }
}

function addUsersTable(ctx: AddonContext): void {
  const { schema } = readDrizzleConfig(ctx.tree, ctx.ts)
  const warning = addTableToSchema(ctx.tree, ctx.ts, schema, 'src/users/users.table.ts')
  if (warning) ctx.warn(warning)
  if (!ctx.tree.exists('src/db.ts')) {
    ctx.warn('No src/db.ts found: src/users/users.service.ts imports the typed Drizzle handle from ../db.js')
  }
  for (const script of ['db:generate', 'db:migrate']) {
    if (hasScript(ctx.tree, script)) ctx.next(ctx.run(script))
  }
}
