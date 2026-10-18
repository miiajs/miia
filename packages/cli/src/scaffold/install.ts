import { execa } from 'execa'
import { installArgs, type PackageManager } from '../runtime/package-manager.js'
import { CliError } from '../utils/errors.js'

export async function install(pm: PackageManager, cwd: string): Promise<void> {
  const [command, args] = installArgs(pm)
  const result = await execa(command, args, { cwd, stdio: 'inherit', reject: false })
  if (result.exitCode !== 0) {
    throw new CliError(`Files are in ${cwd}, but '${command} ${args.join(' ')}' failed. Run it manually.`)
  }
}
