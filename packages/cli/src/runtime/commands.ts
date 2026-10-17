import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Runtime } from './types.js'

export interface SpawnCommand {
  command: string
  args: string[]
  /** Defaults: applied only for keys the caller's environment does not set */
  env?: Record<string, string>
}

function envFileArgs(cwd: string, envFile?: string): string[] {
  const file = envFile ?? (existsSync(resolve(cwd, '.env')) ? '.env' : null)
  return file ? [`--env-file=${file}`] : []
}

export function getDevServerCommand(runtime: Runtime, entry: string, cwd: string, envFile?: string): SpawnCommand {
  const envArgs = envFileArgs(cwd, envFile)
  const env = { NODE_ENV: 'development' }

  switch (runtime) {
    case 'bun':
      return { command: 'bun', args: [...envArgs, '--watch', entry], env }
    case 'deno':
      return { command: 'deno', args: ['run', ...envArgs, '--allow-all', '--sloppy-imports', '--watch', entry], env }
    case 'node':
      return { command: 'node', args: [...envArgs, '--import', 'tsx', '--watch', entry], env }
  }
}

export function getBuildCommand(runtime: Runtime, cwd: string, tsc = 'tsc'): SpawnCommand {
  switch (runtime) {
    case 'bun':
    case 'deno':
      return { command: tsc, args: ['--noEmit'] }
    case 'node':
      return {
        command: tsc,
        args: existsSync(resolve(cwd, 'tsconfig.build.json')) ? ['-p', 'tsconfig.build.json'] : [],
      }
  }
}

export function getStartCommand(
  runtime: Runtime,
  entry: string,
  distEntry: string,
  cwd: string,
  envFile?: string,
): SpawnCommand {
  const envArgs = envFileArgs(cwd, envFile)
  const env = { NODE_ENV: 'production' }

  switch (runtime) {
    case 'bun':
      return { command: 'bun', args: [...envArgs, entry], env }
    case 'deno':
      return { command: 'deno', args: ['run', ...envArgs, '--allow-all', '--sloppy-imports', entry], env }
    case 'node':
      return { command: 'node', args: [...envArgs, '--enable-source-maps', distEntry], env }
  }
}

export function resolveCommandEnv(cmd: SpawnCommand, env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const merged = { ...env }
  for (const [key, value] of Object.entries(cmd.env ?? {})) {
    if (merged[key] === undefined) merged[key] = value
  }
  return merged
}
