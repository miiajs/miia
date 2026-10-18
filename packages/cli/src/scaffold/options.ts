import { existsSync, readdirSync, statSync } from 'node:fs'
import { basename, relative, resolve } from 'node:path'
import * as p from '@clack/prompts'
import { isRuntime, RUNTIMES } from '../runtime/detect.js'
import { isPackageManager, type PackageManager, packageManagerFromUserAgent } from '../runtime/package-manager.js'
import type { Runtime } from '../runtime/types.js'
import { CliError } from '../utils/errors.js'
import { type Addon, addons as registeredAddons, availableAddons } from './addons.js'

export interface NewArgs {
  name?: string
  runtime?: string
  pm?: string
  features?: string
  db?: string
  yes?: boolean
  'skip-install'?: boolean
  'dry-run'?: boolean
}

export interface NewOptions {
  name: string
  /** Absolute path of the project folder */
  dir: string
  runtime: Runtime
  packageManager: PackageManager
  addons: string[]
  install: boolean
  dryRun: boolean
}

export interface NewEnv {
  interactive: boolean
  hasBun: boolean
  userAgent?: string
  cwd?: string
  registry?: readonly Addon[]
}

// validate-npm-package-name: lower case, URL-safe, optional scope
const PACKAGE_NAME = /^(?:@[a-z0-9-*~][a-z0-9-*._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/

export function validateProjectName(name: string): string | undefined {
  if (!name) return 'Project name is required'
  if (name.length > 214) return 'Project name must be at most 214 characters'
  if (name !== name.toLowerCase()) return 'Project name must be lower case'
  if (!PACKAGE_NAME.test(name)) {
    return 'Project name may contain lower-case letters, digits, "-", ".", "_" and "~", with an optional @scope/'
  }
  return undefined
}

/** Resolves every prompt from flags, then from prompts (interactive) or defaults. null: cancelled. */
export async function resolveNewOptions(args: NewArgs, env: NewEnv): Promise<NewOptions | null> {
  const cwd = env.cwd ?? process.cwd()
  const registry = env.registry ?? registeredAddons
  const cancelled = Symbol('cancelled')
  const ask = async <T>(prompt: Promise<T | symbol>): Promise<T | typeof cancelled> => {
    const answer = await prompt
    if (p.isCancel(answer)) {
      p.cancel('Cancelled')
      return cancelled
    }
    return answer as T
  }

  // Name and folder
  let rawName = args.name?.trim()
  if (!rawName) {
    if (!env.interactive) throw new CliError('Project name is required')
    const answer = await ask(
      p.text({
        message: 'Project name:',
        placeholder: 'my-app',
        validate: (value) => (value?.trim() === '.' ? undefined : validateProjectName(value?.trim() ?? '')),
      }),
    )
    if (answer === cancelled) return null
    rawName = answer.trim()
  }
  const inPlace = rawName === '.'
  const name = inPlace ? basename(cwd) : rawName
  const invalid = validateProjectName(name)
  if (invalid) throw new CliError(inPlace ? `${invalid} (the current folder name is used)` : invalid)
  const dir = inPlace ? cwd : resolve(cwd, name.startsWith('@') ? name.slice(name.indexOf('/') + 1) : name)
  assertEmptyFolder(dir, cwd)

  // Runtime
  let runtime: Runtime
  if (args.runtime !== undefined) {
    if (!isRuntime(args.runtime)) throw new CliError(`Invalid runtime "${args.runtime}". Valid: ${RUNTIMES.join(', ')}`)
    runtime = args.runtime
  } else {
    const fallback: Runtime = env.hasBun ? 'bun' : 'node'
    if (env.interactive) {
      const answer = await ask(
        p.select<Runtime>({
          message: 'Runtime:',
          initialValue: fallback,
          options: [
            { value: 'bun', label: 'Bun', hint: 'recommended' },
            { value: 'node', label: 'Node.js' },
            { value: 'deno', label: 'Deno' },
          ],
        }),
      )
      if (answer === cancelled) return null
      runtime = answer
    } else {
      runtime = fallback
    }
  }

  // Package manager
  let packageManager: PackageManager
  if (args.pm !== undefined) {
    if (!isPackageManager(args.pm))
      throw new CliError(`Invalid package manager "${args.pm}". Valid: bun, npm, pnpm, yarn, deno`)
    packageManager = args.pm
  } else if (runtime !== 'node') {
    packageManager = runtime
  } else {
    const agent = packageManagerFromUserAgent(env.userAgent ?? '')
    const fallback: PackageManager = agent && agent !== 'deno' ? agent : 'npm'
    if (env.interactive) {
      const answer = await ask(
        p.select<PackageManager>({
          message: 'Package manager:',
          initialValue: fallback,
          options: (['npm', 'pnpm', 'yarn', 'bun'] as const).map((pm) => ({ value: pm, label: pm })),
        }),
      )
      if (answer === cancelled) return null
      packageManager = answer
    } else {
      packageManager = fallback
    }
  }

  // Add-ons
  const available = availableAddons(runtime, registry)
  let features: string[]
  if (args.features !== undefined) {
    features = args.features
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean)
  } else {
    const options = available.filter((a) => a.kind !== 'database')
    if (env.interactive && options.length > 0) {
      const answer = await ask(
        p.multiselect<string>({
          message: 'Features:',
          required: false,
          options: options.map((a) => ({ value: a.id, label: a.label, hint: a.hint })),
        }),
      )
      if (answer === cancelled) return null
      features = answer
    } else {
      features = []
    }
  }

  let database: string | null = null
  const databases = available.filter((a) => a.kind === 'database')
  if (args.db !== undefined) {
    if (args.db !== 'none') {
      const known = registry.find((a) => a.id === args.db && a.kind === 'database')
      if (!known) {
        const list = ['none', ...registry.filter((a) => a.kind === 'database').map((a) => a.id)].join(', ')
        throw new CliError(`Unknown database "${args.db}". Available: ${list}`)
      }
      database = args.db
    }
  } else if (env.interactive && databases.length > 0) {
    const answer = await ask(
      p.select<string>({
        message: 'Database:',
        initialValue: 'none',
        options: [
          { value: 'none', label: 'None' },
          ...databases.map((a) => ({ value: a.id, label: a.label, hint: a.hint })),
        ],
      }),
    )
    if (answer === cancelled) return null
    if (answer !== 'none') database = answer
  }

  return {
    name,
    dir,
    runtime,
    packageManager,
    addons: database ? [...features, database] : features,
    install: !args['skip-install'],
    dryRun: !!args['dry-run'],
  }
}

function assertEmptyFolder(dir: string, cwd: string): void {
  if (!existsSync(dir)) return
  const shown = relative(cwd, dir) || '.'
  if (!statSync(dir).isDirectory()) throw new CliError(`"${shown}" exists and is not a folder`)
  if (readdirSync(dir).length > 0) throw new CliError(`Folder "${shown}" is not empty`)
}
