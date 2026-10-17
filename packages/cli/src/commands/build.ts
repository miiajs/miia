import { defineCommand } from 'citty'
import { execa } from 'execa'
import { getBuildCommand } from '../runtime/commands.js'
import { resolveRuntime } from '../runtime/detect.js'
import { action, CliError } from '../utils/errors.js'
import { logger } from '../utils/logger.js'
import { requireTypeScript } from '../utils/preflight.js'

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
  run: action(async ({ args }) => {
    const cwd = process.cwd()
    const { runtime, source } = resolveRuntime(cwd, args.runtime)
    logger.info(`Runtime: ${runtime} (${source})`)

    const cmd = getBuildCommand(runtime, cwd, requireTypeScript(cwd))
    logger.info(runtime === 'node' ? 'Compiling TypeScript...' : 'Type-checking...')

    const result = await execa(cmd.command, cmd.args, { cwd, stdio: 'inherit', reject: false })
    if (result.exitCode !== 0) throw new CliError('Build failed')

    logger.success('Build complete')
  }),
})
