import { defineCommand } from 'citty'
import { execa } from 'execa'
import { action, CliError } from '../utils/errors.js'
import { logger } from '../utils/logger.js'
import { requireTypeScript } from '../utils/preflight.js'

export default defineCommand({
  meta: {
    name: 'check',
    description: 'Type-check the project (tsc --noEmit)',
  },
  run: action(async () => {
    const cwd = process.cwd()
    const tsc = requireTypeScript(cwd)
    logger.info('Type-checking...')

    const result = await execa(tsc, ['--noEmit'], { cwd, stdio: 'inherit', reject: false })
    if (result.exitCode !== 0) throw new CliError('Type-check failed')

    logger.success('No type errors found')
  }),
})
