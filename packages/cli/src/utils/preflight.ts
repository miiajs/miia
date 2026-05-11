import { execaSync } from 'execa'
import { logger } from './logger.js'
import type { Runtime } from '../runtime/types.js'

function hasCommand(cmd: string): boolean {
  try {
    execaSync('which', [cmd])
    return true
  } catch {
    return false
  }
}

export function preflight(runtime: Runtime, command: 'dev' | 'build' | 'start' | 'check'): boolean {
  if (command !== 'start' && !hasCommand('tsc')) {
    logger.error('TypeScript compiler (tsc) not found. Install typescript:\n  npm install -D typescript')
    return false
  }

  if (runtime === 'node' && command === 'dev') {
    try {
      execaSync('node', ['--import', 'tsx', '-e', '""'])
    } catch {
      logger.error('tsx not found. Install it for Node.js dev mode:\n  npm install -D tsx')
      return false
    }
  }

  if (runtime !== 'node' && !hasCommand(runtime)) {
    logger.error(`Runtime "${runtime}" not found in PATH`)
    return false
  }

  return true
}
