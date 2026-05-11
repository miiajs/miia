import type { Feature } from '../types.js'

export const drizzlePostgresFeature: Feature = {
  id: 'drizzle-postgres',
  label: 'Drizzle + PostgreSQL',
  hint: '',
  group: 'database',
  requires: ['config'],
  packages: {
    '@miiajs/drizzle': '^0.1.0',
    'drizzle-orm': '^0.44.0',
    postgres: '^3.4.0',
  },
  devPackages: {
    'drizzle-kit': '^0.31.0',
  },
  moduleImport: {
    statement: `import { DrizzleModule } from '@miiajs/drizzle'`,
    entries: [
      `DrizzleModule.configure((resolve) => ({
      dialect: 'postgres',
      connection: { url: resolve(ConfigService).getOrThrow('DATABASE_URL') },
    }))`,
    ],
  },
  envVars: {
    DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/myapp',
  },
}
