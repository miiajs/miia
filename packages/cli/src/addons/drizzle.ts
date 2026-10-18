import type { Addon } from '../scaffold/addons.js'
import {
  addEnv,
  configReader,
  databaseName,
  fromRootModule,
  hasDependency,
  ignoreFiles,
  registerModule,
} from './helpers.js'

type Dialect = 'postgres' | 'mysql' | 'sqlite'

const LABELS: Record<Dialect, string> = { postgres: 'PostgreSQL', mysql: 'MySQL', sqlite: 'SQLite' }

const URLS: Record<Dialect, (db: string) => string> = {
  postgres: (db) => `postgres://postgres:postgres@localhost:5432/${db}`,
  mysql: (db) => `mysql://root:root@localhost:3306/${db}`,
  sqlite: () => 'data.db',
}

export function drizzleAddon(dialect: Dialect): Addon {
  return {
    id: `drizzle-${dialect}`,
    label: `Drizzle + ${LABELS[dialect]}`,
    hint: dialect === 'sqlite' ? 'bun:sqlite on Bun, better-sqlite3 on Node.js' : 'drizzle-kit migrations',
    kind: 'database',
    // better-sqlite3 crashes Deno
    runtimes: dialect === 'sqlite' ? ['bun', 'node'] : undefined,
    isInstalled: (tree, layout) =>
      hasDependency(tree, '@miiajs/drizzle') &&
      !!layout.rootModule &&
      (tree.read(layout.rootModule) ?? '').includes(`dialect: '${dialect}'`),
    apply(ctx) {
      ctx.template()
      const config = configReader(ctx)
      registerModule(ctx, {
        ref: 'DrizzleModule',
        element: [
          'DrizzleModule.configure(',
          '  (resolve) => ({',
          `    dialect: '${dialect}',`,
          `    connection: { url: ${config.get('DATABASE_URL')} },`,
          '    schema,',
          '  }),',
          '  { global: true },',
          ')',
        ].join('\n'),
        imports: [
          { from: '@miiajs/drizzle', names: ['DrizzleModule'] },
          { from: fromRootModule(ctx, 'src/db/schema.ts'), namespace: 'schema' },
          ...config.imports,
        ],
      })
      addEnv(ctx, { key: 'DATABASE_URL', schema: 'z.string()', example: URLS[dialect](databaseName(ctx.projectName)) })
      if (dialect === 'sqlite') ignoreFiles(ctx, ['data.db'])
    },
  }
}
