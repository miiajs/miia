import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Runtime } from './types.js'

interface SpawnCommand {
  command: string
  args: string[]
  env?: Record<string, string>
}

function envFileArgs(cwd: string, envFile?: string): string[] {
  const file = envFile ?? (existsSync(resolve(cwd, '.env')) ? '.env' : null)
  return file ? [`--env-file=${file}`] : []
}

export function getDevServerCommand(runtime: Runtime, entry: string, cwd: string, envFile?: string): SpawnCommand {
  const envArgs = envFileArgs(cwd, envFile)

  switch (runtime) {
    case 'bun':
      return { command: 'bun', args: [...envArgs, '--watch', entry] }
    case 'deno':
      return { command: 'deno', args: ['run', ...envArgs, '--allow-all', '--sloppy-imports', '--watch', entry] }
    case 'node':
      return { command: 'node', args: [...envArgs, '--import', 'tsx', '--watch', entry] }
  }
}

export function getBuildCommand(runtime: Runtime): SpawnCommand {
  switch (runtime) {
    case 'bun':
    case 'deno':
      return { command: 'tsc', args: ['--noEmit'] }
    case 'node':
      return { command: 'tsc', args: [] }
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

  switch (runtime) {
    case 'bun':
      return {
        command: 'bun',
        args: [...envArgs, entry],
        env: { NODE_ENV: 'production' },
      }
    case 'deno':
      return { command: 'deno', args: ['run', ...envArgs, '--allow-all', '--sloppy-imports', entry] }
    case 'node':
      return {
        command: 'node',
        args: [...envArgs, distEntry],
        env: { NODE_ENV: 'production' },
      }
  }
}
