import { logger } from './logger.js'

export class CliError extends Error {
  readonly exitCode: number

  constructor(message: string, exitCode = 1) {
    super(message)
    this.name = 'CliError'
    this.exitCode = exitCode
  }
}

// Command boundary: CliError -> message + exit code, anything else propagates to citty (stack trace).
export function action<T>(fn: (ctx: T) => void | Promise<void>): (ctx: T) => Promise<void> {
  return async (ctx) => {
    try {
      await fn(ctx)
    } catch (err) {
      if (!(err instanceof CliError)) throw err
      logger.error(err.message)
      process.exitCode = err.exitCode
    }
  }
}
