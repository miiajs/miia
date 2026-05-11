import * as p from '@clack/prompts'
import type { Runtime } from '../runtime/types.js'
import type { FeatureId } from './types.js'

export type PackageManager = 'bun' | 'pnpm' | 'npm' | 'yarn'

export interface ScaffoldAnswers {
  name: string
  runtime: Runtime
  featureIds: FeatureId[]
  packageManager: PackageManager
}

export async function runScaffoldPrompts(nameArg?: string): Promise<ScaffoldAnswers | null> {
  p.intro('Create a new MiiaJS app')

  const name =
    nameArg ??
    (await p.text({
      message: 'Project name:',
      placeholder: 'my-miia-app',
      validate: (val) => {
        if (!val || !val.trim()) return 'Project name is required'
        if (!/^[a-zA-Z][a-zA-Z0-9._-]*$/.test(val)) return 'Invalid project name'
      },
    }))
  if (p.isCancel(name)) return null

  const runtime = await p.select({
    message: 'Runtime:',
    options: [
      { value: 'bun' as const, label: 'Bun', hint: 'recommended - fastest startup' },
      { value: 'deno' as const, label: 'Deno', hint: 'secure by default' },
      { value: 'node' as const, label: 'Node.js', hint: 'widest ecosystem' },
    ],
  })
  if (p.isCancel(runtime)) return null

  // Bun is its own package manager; others get to choose
  let packageManager: PackageManager = 'bun'
  if (runtime !== 'bun') {
    const pm = await p.select({
      message: 'Package manager:',
      options: [
        { value: 'pnpm' as const, label: 'pnpm', hint: 'recommended' },
        { value: 'npm' as const, label: 'npm' },
        { value: 'yarn' as const, label: 'yarn' },
      ],
    })
    if (p.isCancel(pm)) return null
    packageManager = pm as PackageManager
  }

  const features = await p.multiselect({
    message: 'Select features:',
    options: [
      { value: 'config' as const, label: 'Config', hint: 'typed env variables via Zod' },
      { value: 'jwt-auth' as const, label: 'JWT Auth', hint: 'JWT authentication' },
      { value: 'swagger' as const, label: 'Swagger', hint: 'OpenAPI 3.1 + Swagger UI' },
      { value: 'cors' as const, label: 'CORS', hint: 'cross-origin resource sharing' },
      { value: 'serve-static' as const, label: 'Serve Static', hint: 'static file serving' },
    ],
    required: false,
  })
  if (p.isCancel(features)) return null

  const database = await p.select({
    message: 'Database:',
    options: [
      { value: 'none' as const, label: 'None' },
      { value: 'drizzle-postgres' as const, label: 'Drizzle + PostgreSQL' },
      { value: 'drizzle-mysql' as const, label: 'Drizzle + MySQL' },
      { value: 'drizzle-sqlite' as const, label: 'Drizzle + SQLite' },
      { value: 'papr' as const, label: 'Papr + MongoDB' },
      { value: 'mongoose' as const, label: 'Mongoose + MongoDB' },
    ],
  })
  if (p.isCancel(database)) return null

  const featureIds = [...(features as string[])] as FeatureId[]
  if (database !== 'none') {
    featureIds.push(database as FeatureId)
  }

  return {
    name: typeof name === 'string' ? name.trim() : name,
    runtime: runtime as Runtime,
    featureIds,
    packageManager,
  }
}
