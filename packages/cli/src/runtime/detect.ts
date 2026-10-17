import { existsSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { CliError } from '../utils/errors.js'
import { findExecutable } from '../utils/which.js'
import type { Runtime } from './types.js'

export interface DetectionResult {
  runtime: Runtime
  source: string
}

export const RUNTIMES: readonly Runtime[] = ['bun', 'deno', 'node']

// Checked per directory level, deno.json before any lockfile: a Deno project installed with pnpm still runs on Deno
const PROJECT_FILES: [string, Runtime][] = [
  ['deno.json', 'deno'],
  ['deno.jsonc', 'deno'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
  ['deno.lock', 'deno'],
  ['package-lock.json', 'node'],
  ['yarn.lock', 'node'],
  ['pnpm-lock.yaml', 'node'],
]

export function isRuntime(value: string): value is Runtime {
  return (RUNTIMES as readonly string[]).includes(value)
}

export function resolveRuntime(
  cwd: string,
  flag?: string,
  deps: { findExecutable?: typeof findExecutable; stopAt?: string } = {},
): DetectionResult {
  if (flag !== undefined) {
    if (!isRuntime(flag)) throw new CliError(`Invalid runtime "${flag}". Valid: ${RUNTIMES.join(', ')}`)
    return { runtime: flag, source: '--runtime flag' }
  }

  const fromFiles = detectFromProjectFiles(cwd, deps.stopAt)
  if (fromFiles) return fromFiles

  const find = deps.findExecutable ?? findExecutable
  if (find('bun')) return { runtime: 'bun', source: 'bun in PATH' }
  if (find('deno')) return { runtime: 'deno', source: 'deno in PATH' }

  return { runtime: 'node', source: 'default' }
}

function detectFromProjectFiles(cwd: string, stopAt?: string): DetectionResult | null {
  let dir = cwd
  while (true) {
    for (const [file, runtime] of PROJECT_FILES) {
      const path = join(dir, file)
      if (existsSync(path)) return { runtime, source: dir === cwd ? file : relative(cwd, path) }
    }
    const parent = dirname(dir)
    if (dir === stopAt || parent === dir) return null
    dir = parent
  }
}
