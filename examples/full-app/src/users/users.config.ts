import { defineConfig } from '@miiajs/config'
import { z } from 'zod'

export const usersConfig = defineConfig(
  'users',
  z.object({
    SEED_ADMIN_EMAIL: z.string().default('admin@miiajs.com'),
    SEED_ADMIN_PASSWORD: z.string().default('admin'),
  }),
)
