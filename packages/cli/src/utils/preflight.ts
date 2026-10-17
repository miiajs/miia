import { execaSync } from 'execa'
import { addDevHint, detectPackageManager } from '../runtime/package-manager.js'
import type { Runtime } from '../runtime/types.js'
import { CliError } from './errors.js'
import { findExecutable, findLocalBin } from './which.js'

function installHint(cwd: string, pkg: string): string {
  return addDevHint(detectPackageManager(cwd) ?? 'npm', pkg)
}

export function requireTypeScript(cwd: string): string {
  const tsc = findLocalBin(cwd, 'tsc') ?? findExecutable('tsc')
  if (tsc) return tsc
  throw new CliError(`TypeScript compiler (tsc) not found. Install typescript:\n  ${installHint(cwd, 'typescript')}`)
}

// The CLI itself may run on Bun or Deno, so node is not guaranteed either
export function requireRuntime(runtime: Runtime): void {
  if (!findExecutable(runtime)) throw new CliError(`Runtime "${runtime}" not found in PATH`)
}

export function requireTsx(cwd: string): void {
  if (findLocalBin(cwd, 'tsx')) return
  const result = execaSync('node', ['--import', 'tsx', '-e', ''], { cwd, reject: false })
  if (result.exitCode !== 0) {
    throw new CliError(`tsx not found. Install it for Node.js dev mode:\n  ${installHint(cwd, 'tsx')}`)
  }
}
