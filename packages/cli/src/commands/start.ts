import { defineCommand } from 'citty'
import { execa } from 'execa'
import { createSignalPolicy, onTerminationSignals, signalExitCode } from '../dev/signals.js'
import { getStartCommand, resolveCommandEnv } from '../runtime/commands.js'
import { resolveRuntime } from '../runtime/detect.js'
import { action, CliError } from '../utils/errors.js'
import { logger } from '../utils/logger.js'
import { requireRuntime } from '../utils/preflight.js'

export default defineCommand({
  meta: {
    name: 'start',
    description: 'Start the production server',
  },
  args: {
    runtime: {
      type: 'string',
      description: 'Runtime to use (bun, deno, node)',
      alias: 'r',
    },
    entry: {
      type: 'string',
      description: 'Entry point file (source)',
      default: 'src/main.ts',
    },
    dist: {
      type: 'string',
      description: 'Compiled entry point (for Node)',
      default: 'dist/main.js',
    },
    'env-file': {
      type: 'string',
      description: 'Path to .env file',
    },
  },
  run: action(async ({ args }) => {
    const cwd = process.cwd()
    const { runtime, source } = resolveRuntime(cwd, args.runtime)
    logger.info(`Runtime: ${runtime} (${source})`)
    requireRuntime(runtime)

    const cmd = getStartCommand(runtime, args.entry, args.dist, cwd, args['env-file'])
    logger.info('Starting production server...')

    // execa would SIGKILL 5s after kill() by default - long enough to cut a graceful shutdown short
    const child = execa(cmd.command, cmd.args, {
      cwd,
      stdio: 'inherit',
      env: resolveCommandEnv(cmd),
      reject: false,
      forceKillAfterDelay: false,
    })

    const policy = createSignalPolicy()
    const stopListening = onTerminationSignals((signal) => {
      const decision = policy(signal)
      if (decision === 'forward') child.kill('SIGTERM')
      else if (decision === 'kill') child.kill('SIGKILL')
    })

    const result = await child.finally(stopListening)
    if (result.failed && result.exitCode === undefined && !result.signal)
      throw new CliError(result.shortMessage ?? `Failed to start ${cmd.command}`)
    process.exitCode = result.signal ? signalExitCode(result.signal) : (result.exitCode ?? 1)
  }),
})
