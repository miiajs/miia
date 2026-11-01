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
    if (!args.runtime) logger.info(`Runtime: ${runtime} (${source})`)

    const cmd = getBuildCommand(runtime, cwd, requireTypeScript(cwd))
    if (runtime === 'node') await assertEmits(cmd.command, cmd.args, cwd)
    logger.info(runtime === 'node' ? 'Compiling TypeScript...' : 'Type-checking...')

    const result = await execa(cmd.command, cmd.args, { cwd, stdio: 'inherit', reject: false })
    if (result.exitCode !== 0) throw new CliError('Build failed')

    logger.success(
      runtime === 'node' ? 'Build complete' : `No type errors (${runtime} runs the sources, nothing to emit)`,
    )
  }),
})

// A config with noEmit makes tsc a type-check: "Build complete" with no dist/ for `miia start` to run
async function assertEmits(tsc: string, args: string[], cwd: string): Promise<void> {
  const shown = await execa(tsc, [...args, '--showConfig'], { cwd, reject: false })
  if (shown.exitCode !== 0) return
  const options = (JSON.parse(String(shown.stdout)) as { compilerOptions?: { noEmit?: boolean } }).compilerOptions
  if (!options?.noEmit) return
  const config = args.includes('-p') ? args[args.indexOf('-p') + 1] : 'tsconfig.json'
  throw new CliError(
    `${config} sets "noEmit": true, so tsc would emit nothing for miia start. ` +
      'Add a tsconfig.build.json that extends it with "noEmit": false and "outDir": "dist".',
  )
}
