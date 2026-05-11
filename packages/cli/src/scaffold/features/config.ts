import type { Feature } from '../types.js'

export const configFeature: Feature = {
  id: 'config',
  label: 'Config',
  hint: 'typed env variables via Zod',
  group: 'core',
  packages: {
    '@miiajs/config': '^0.1.0',
    zod: '^3.24.0',
  },
  moduleImport: {
    statement: `import { ConfigModule } from '@miiajs/config'
import { envSchema } from '../env.schema.js'`,
    entries: [`ConfigModule.configure({ schema: envSchema })`],
  },
  files: (ctx) => {
    const fields: string[] = [
      `  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),`,
      `  HOST: z.string().default('0.0.0.0'),`,
      `  PORT: z.coerce.number().int().min(1).max(65535).default(3000),`,
    ]

    const featureIds = new Set(ctx.features.map((f) => f.id))

    if (featureIds.has('jwt-auth')) {
      fields.push(`  JWT_SECRET: z.string(),`)
    }
    if (featureIds.has('drizzle-postgres') || featureIds.has('drizzle-mysql') || featureIds.has('drizzle-sqlite')) {
      fields.push(`  DATABASE_URL: z.string(),`)
    }
    if (featureIds.has('papr') || featureIds.has('mongoose')) {
      fields.push(`  MONGODB_URL: z.string(),`)
    }

    return {
      'src/env.schema.ts': `import { z } from 'zod'

export const envSchema = z.object({
${fields.join('\n')}
})

export type Env = z.infer<typeof envSchema>
`,
    }
  },
}
