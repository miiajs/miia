import type { Feature } from '../types.js'

export const drizzleMysqlFeature: Feature = {
  id: 'drizzle-mysql',
  label: 'Drizzle + MySQL',
  hint: '',
  group: 'database',
  requires: ['config'],
  packages: {
    '@miiajs/drizzle': '^0.1.0',
    'drizzle-orm': '^0.44.0',
    mysql2: '^3.14.0',
  },
  devPackages: {
    'drizzle-kit': '^0.31.0',
  },
  moduleImport: {
    statement: `import { DrizzleModule } from '@miiajs/drizzle'`,
    entries: [
      `DrizzleModule.configure((resolve) => ({
      dialect: 'mysql',
      connection: { url: resolve(ConfigService).getOrThrow('DATABASE_URL') },
    }))`,
    ],
  },
  envVars: {
    DATABASE_URL: 'mysql://root:password@localhost:3306/myapp',
  },
}
