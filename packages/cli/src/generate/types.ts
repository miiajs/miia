export type SchematicName = 'module' | 'controller' | 'service' | 'middleware' | 'guard' | 'resource'

export type RegistrationTarget = 'imports' | 'controllers' | 'providers'

export interface GenerateContext {
  /** Raw name from CLI, e.g. "user" or "auth/user" */
  rawName: string
  /** PascalCase class name stem, e.g. "User" */
  className: string
  /** kebab-case file stem, e.g. "user" */
  fileName: string
  /** Absolute path to the target directory */
  targetDir: string
  /** Resolved schematic name */
  schematic: SchematicName
  /** Dry-run mode - no files written */
  dryRun: boolean
}

export interface GeneratedFile {
  path: string
  content: string
}

export interface SchematicDefinition {
  name: SchematicName
  aliases: string[]
  /** File suffix appended after the kebab name, e.g. ".controller" */
  fileSuffix: string
  /** Template function that returns file content */
  template: (ctx: GenerateContext) => string
  /** Which @Module array this artifact registers in (null = no auto-register) */
  registrationTarget: RegistrationTarget | null
}

export interface GenerateOptions {
  schematic: string
  name: string
  path?: string
  flat?: boolean
  dryRun?: boolean
}
