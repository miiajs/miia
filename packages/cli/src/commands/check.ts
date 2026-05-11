import { defineCommand } from 'citty'
import { execa } from 'execa'
import { preflight } from '../utils/preflight.js'
import { logger } from '../utils/logger.js'

export default defineCommand({
  meta: {
    name: 'check',
    description: 'Type-check the project (tsc --noEmit)',
  },
  async run() {
    if (!preflight('node', 'check')) {
      process.exit(1)
    }

    logger.info('Type-checking...')

    const result = await execa('tsc', ['--noEmit'], {
      cwd: process.cwd(),
      stdio: 'inherit',
      reject: false,
    })

    if (result.exitCode !== 0) {
      logger.error('Type-check failed')
      process.exit(1)
    }

    logger.success('No type errors found')
  },
})
