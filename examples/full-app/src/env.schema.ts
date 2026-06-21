import { z } from 'zod'

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string(),
  PORT: z.string().transform((val) => parseInt(val, 10)),
  PUBLIC_URL: z.string().default('http://localhost:3030'),
  JWT_SECRET: z.string(),
  DATABASE_URL: z.string(),
  CORS_ORIGIN: z
    .string()
    .default('*')
    .transform((val) => (val === '*' ? '*' : val.split(',').map((origin) => origin.trim()))),
  SERVER: z.string().optional(),
})

export type Env = z.infer<typeof envSchema>
