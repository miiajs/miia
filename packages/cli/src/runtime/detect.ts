import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { execaSync } from 'execa'
import { logger } from '../utils/logger.js'
import type { Runtime } from './types.js'

interface DetectionResult {
  runtime: Runtime
  source: string
}

const VALID_RUNTIMES = ['bun', 'deno', 'node'] as const satisfies readonly Runtime[]

const LOCKFILE_MAP: [string, Runtime][] = [
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
  ['deno.lock', 'deno'],
  ['package-lock.json', 'node'],
  ['yarn.lock', 'node'],
  ['pnpm-lock.yaml', 'node'],
]

function detectFromLockfile(cwd: string): DetectionResult | null {
  for (const [file, runtime] of LOCKFILE_MAP) {
    if (existsSync(resolve(cwd, file))) {
      return { runtime, source: file }
    }
  }
  return null
}

function hasExecutable(name: string): boolean {
  try {
    execaSync('which', [name])
    return true
  } catch {
    return false
  }
}

function detectFromExecutable(): DetectionResult | null {
  if (hasExecutable('bun')) return { runtime: 'bun', source: 'bun in PATH' }
  if (hasExecutable('deno')) return { runtime: 'deno', source: 'deno in PATH' }
  return null
}

export function detectRuntime(cwd: string): DetectionResult {
  const fromLockfile = detectFromLockfile(cwd)
  if (fromLockfile) return fromLockfile

  const fromExec = detectFromExecutable()
  if (fromExec) return fromExec

  return { runtime: 'node', source: 'default' }
}

export function resolveRuntime(cwd: string, flag?: string): DetectionResult {
  if (flag) {
    if (!(VALID_RUNTIMES as readonly string[]).includes(flag)) {
      throw new Error(`Invalid runtime "${flag}". Valid: ${VALID_RUNTIMES.join(', ')}`)
    }
    return { runtime: flag as Runtime, source: '--runtime flag' }
  }
  return detectRuntime(cwd)
}

export function tryResolveRuntime(cwd: string, flag?: string): DetectionResult {
  try {
    return resolveRuntime(cwd, flag)
  } catch (e) {
    logger.error((e as Error).message)
    process.exit(1)
  }
}
