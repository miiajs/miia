import { defineCommand } from 'citty'
import { tryResolveRuntime } from '../runtime/detect.js'
import { startDev } from '../dev/orchestrator.js'
import { preflight } from '../utils/preflight.js'
import { logger } from '../utils/logger.js'

export default defineCommand({
  meta: {
    name: 'dev',
    description: 'Start development server with hot reload and type checking',
  },
  args: {
    runtime: {
      type: 'string',
      description: 'Runtime to use (bun, deno, node)',
      alias: 'r',
    },
    entry: {
      type: 'string',
      description: 'Entry point file',
      default: 'src/main.ts',
    },
    'env-file': {
      type: 'string',
      description: 'Path to .env file',
    },
  },
  run({ args }) {
    const cwd = process.cwd()
    const { runtime, source } = tryResolveRuntime(cwd, args.runtime)
    logger.info(`Detected runtime: ${runtime} (${source})`)

    if (!preflight(runtime, 'dev')) {
      process.exit(1)
    }

    return startDev({
      runtime,
      cwd,
      entry: args.entry,
      envFile: args['env-file'],
    })
  },
})
