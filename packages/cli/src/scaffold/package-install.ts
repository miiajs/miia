import { execa } from 'execa'
import { logger } from '../utils/logger.js'
import type { PackageManager } from './prompts.js'

export async function installDependencies(cwd: string, pm: PackageManager): Promise<void> {
  logger.info(`Installing dependencies with ${pm}...`)

  const result = await execa(pm, ['install'], {
    cwd,
    stdio: 'inherit',
    reject: false,
  })

  if (result.exitCode !== 0) {
    logger.warn('Dependency installation failed. Run install manually.')
  } else {
    logger.success('Dependencies installed')
  }
}
