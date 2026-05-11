import type { Runtime } from '../runtime/types.js'

export type FeatureId =
  | 'config'
  | 'jwt-auth'
  | 'swagger'
  | 'drizzle-postgres'
  | 'drizzle-mysql'
  | 'drizzle-sqlite'
  | 'papr'
  | 'mongoose'
  | 'cors'
  | 'serve-static'

export type FeatureGroup = 'core' | 'database' | 'extras'

export interface Feature {
  id: FeatureId
  label: string
  hint: string
  group: FeatureGroup

  /** Production dependencies */
  packages: Record<string, string>
  /** Dev dependencies */
  devPackages?: Record<string, string>

  /** Import + registration in app.module.ts */
  moduleImport?: {
    /** Full import statement line */
    statement: string
    /** Each entry is one complete expression inserted into @Module({ imports: [...] }) */
    entries: string[]
  }

  /** Setup code injected into main.ts */
  mainSetup?: {
    imports: string[]
    /** Code lines inserted before app.listen() */
    code: string[]
  }

  /** Extra files to generate */
  files?: (ctx: ScaffoldContext) => Record<string, string>

  /** Environment variables added to .env */
  envVars?: Record<string, string>

  /** Feature IDs that will be auto-selected */
  requires?: FeatureId[]
  /** Feature IDs that are mutually exclusive */
  conflicts?: FeatureId[]
}

export interface ScaffoldContext {
  name: string
  runtime: Runtime
  features: Feature[]
  dryRun: boolean
}
