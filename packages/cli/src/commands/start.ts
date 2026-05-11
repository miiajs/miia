import { defineCommand } from 'citty'
import { execa } from 'execa'
import { tryResolveRuntime } from '../runtime/detect.js'
import { getStartCommand } from '../runtime/commands.js'
import { preflight } from '../utils/preflight.js'
import { logger } from '../utils/logger.js'

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
  async run({ args }) {
    const cwd = process.cwd()
    const { runtime, source } = tryResolveRuntime(cwd, args.runtime)
    logger.info(`Runtime: ${runtime} (${source})`)

    if (!preflight(runtime, 'start')) {
      process.exit(1)
    }

    const cmd = getStartCommand(runtime, args.entry, args.dist, cwd, args['env-file'])
    logger.info('Starting production server...')

    await execa(cmd.command, cmd.args, {
      cwd,
      stdio: 'inherit',
      env: { ...process.env, ...cmd.env },
    })
  },
})
