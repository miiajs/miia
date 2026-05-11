import { defineCommand } from 'citty'
import { execa } from 'execa'
import { tryResolveRuntime } from '../runtime/detect.js'
import { getBuildCommand } from '../runtime/commands.js'
import { preflight } from '../utils/preflight.js'
import { logger } from '../utils/logger.js'

export default defineCommand({
  meta: {
    name: 'build',
    description: 'Build the project (type-check for Bun/Deno, compile for Node)',
  },
  args: {
    runtime: {
      type: 'string',
      description: 'Runtime to use (bun, deno, node)',
      alias: 'r',
    },
  },
  async run({ args }) {
    const { runtime, source } = tryResolveRuntime(process.cwd(), args.runtime)
    logger.info(`Runtime: ${runtime} (${source})`)

    if (!preflight(runtime, 'build')) {
      process.exit(1)
    }

    const cmd = getBuildCommand(runtime)
    logger.info(runtime === 'node' ? 'Compiling TypeScript...' : 'Type-checking...')

    const result = await execa(cmd.command, cmd.args, {
      cwd: process.cwd(),
      stdio: 'inherit',
      reject: false,
    })

    if (result.exitCode !== 0) {
      logger.error('Build failed')
      process.exit(1)
    }

    logger.success('Build complete')
  },
})
