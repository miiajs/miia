import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Runtime } from './types.js'

export type PackageManager = 'bun' | 'npm' | 'pnpm' | 'yarn' | 'deno'

export const PACKAGE_MANAGERS: readonly PackageManager[] = ['bun', 'npm', 'pnpm', 'yarn', 'deno']

const LOCKFILES: [string, PackageManager][] = [
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['package-lock.json', 'npm'],
  ['deno.lock', 'deno'],
]

export function isPackageManager(value: string): value is PackageManager {
  return (PACKAGE_MANAGERS as readonly string[]).includes(value)
}

// `bun/1.4.0 npm/? node/v24.3.0 darwin arm64`, `pnpm/9.15.0 npm/? node/v22.12.0 linux x64`
export function packageManagerFromUserAgent(ua = process.env.npm_config_user_agent): PackageManager | null {
  const name = ua?.split(' ')[0]?.split('/')[0]
  return name && isPackageManager(name) ? name : null
}

export function detectPackageManager(cwd: string, opts: { stopAt?: string } = {}): PackageManager | null {
  let dir = cwd
  while (true) {
    for (const [file, pm] of LOCKFILES) {
      if (existsSync(join(dir, file))) return pm
    }
    const parent = dirname(dir)
    if (dir === opts.stopAt || parent === dir) return null
    dir = parent
  }
}

/** For a project without a lockfile: npm on Node.js, else the runtime */
export function defaultPackageManager(runtime: Runtime): PackageManager {
  return runtime === 'node' ? 'npm' : runtime
}

export function installArgs(pm: PackageManager): [string, string[]] {
  return [pm, ['install']]
}

export function runScriptCommand(pm: PackageManager, script: string): string {
  switch (pm) {
    case 'bun':
    case 'npm':
      return `${pm} run ${script}`
    case 'pnpm':
    case 'yarn':
      return `${pm} ${script}`
    case 'deno':
      return `deno task ${script}`
  }
}

export function addDevHint(pm: PackageManager, pkg: string): string {
  switch (pm) {
    case 'bun':
      return `bun add -d ${pkg}`
    case 'npm':
      return `npm install -D ${pkg}`
    case 'pnpm':
    case 'yarn':
      return `${pm} add -D ${pkg}`
    case 'deno':
      return `deno add -D npm:${pkg}`
  }
}

/** How to run the project's own `miia` binary outside package.json scripts (Deno: the `miia` script `new` adds). */
export function execCommand(pm: PackageManager): string {
  switch (pm) {
    case 'bun':
      return 'bunx miia'
    case 'npm':
      return 'npx miia'
    case 'pnpm':
      return 'pnpm exec miia'
    case 'yarn':
      return 'yarn miia'
    case 'deno':
      return 'deno task miia'
  }
}
