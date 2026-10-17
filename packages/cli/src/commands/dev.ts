import { defineCommand } from 'citty'
import { startDev } from '../dev/orchestrator.js'
import { resolveRuntime } from '../runtime/detect.js'
import { action } from '../utils/errors.js'
import { logger } from '../utils/logger.js'
import { requireRuntime, requireTsx, requireTypeScript } from '../utils/preflight.js'

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
  run: action(async ({ args }) => {
    const cwd = process.cwd()
    const { runtime, source } = resolveRuntime(cwd, args.runtime)
    logger.info(`Detected runtime: ${runtime} (${source})`)

    requireRuntime(runtime)
    const tsc = requireTypeScript(cwd)
    if (runtime === 'node') requireTsx(cwd)

    process.exitCode = await startDev({
      runtime,
      cwd,
      entry: args.entry,
      envFile: args['env-file'],
      tsc,
    })
  }),
})
