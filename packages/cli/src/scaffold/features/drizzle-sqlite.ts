import type { Feature } from '../types.js'

export const drizzleSqliteFeature: Feature = {
  id: 'drizzle-sqlite',
  label: 'Drizzle + SQLite',
  hint: '',
  group: 'database',
  requires: ['config'],
  packages: {
    '@miiajs/drizzle': '^0.1.0',
    'drizzle-orm': '^0.44.0',
    'better-sqlite3': '^11.9.0',
  },
  devPackages: {
    'drizzle-kit': '^0.31.0',
    '@types/better-sqlite3': '^7.6.0',
  },
  moduleImport: {
    statement: `import { DrizzleModule } from '@miiajs/drizzle'`,
    entries: [
      `DrizzleModule.configure((resolve) => ({
      dialect: 'sqlite',
      connection: { url: resolve(ConfigService).getOrThrow('DATABASE_URL') },
    }))`,
    ],
  },
  envVars: {
    DATABASE_URL: 'file:./data.db',
  },
}
