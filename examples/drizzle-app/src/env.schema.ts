import { z } from 'zod'

export const envSchema = z.object({
  PORT: z.string().default('3000'),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string(),
})

export type Env = z.infer<typeof envSchema>
