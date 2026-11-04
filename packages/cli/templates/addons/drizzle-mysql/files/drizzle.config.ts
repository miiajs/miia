import { defineConfig } from 'drizzle-kit'

// npm run and deno task do not load .env, and drizzle-kit needs DATABASE_URL
try {
  process.loadEnvFile()
} catch {
  // no .env: DATABASE_URL comes from the environment
}

export default defineConfig({
  dialect: 'mysql',
  schema: './src/db.schema.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL! },
})
