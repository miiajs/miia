import { execa } from 'execa'
import { getDevServerCommand, resolveCommandEnv } from '../runtime/commands.js'
import type { Runtime } from '../runtime/types.js'
import { CliError } from '../utils/errors.js'
import { logger } from '../utils/logger.js'
import { childExitCode, createSignalPolicy, onTerminationSignals } from './signals.js'
import { pipeTsc } from './tsc-pipe.js'

export interface DevOptions {
  runtime: Runtime
  cwd: string
  entry: string
  envFile?: string
  /** Path to the tsc binary */
  tsc: string
}

const FORCE_KILL_AFTER_MS = 10_000

/**
 * Runs the runtime's own watcher and `tsc --watch` side by side. The watcher owns the lifetime:
 * its exit stops tsc and becomes the exit code. A crashed app is the watcher's business (it waits
 * for the next file change), so there is no restart loop here.
 */
export async function startDev(options: DevOptions): Promise<number> {
  const { runtime, cwd, entry, envFile } = options

  const serverCmd = getDevServerCommand(runtime, entry, cwd, envFile)
  // `node --watch` runs the app as its own child: a process group lets SIGKILL reach the app too,
  // instead of leaving it behind with the port
  const group = process.platform !== 'win32'
  const server = execa(serverCmd.command, serverCmd.args, {
    cwd,
    reject: false,
    stdio: 'inherit',
    env: resolveCommandEnv(serverCmd),
    forceKillAfterDelay: false,
    detached: group,
  })
  const killServer = (signal: NodeJS.Signals) => {
    if (group && server.pid !== undefined) {
      try {
        process.kill(-server.pid, signal)
        return
      } catch {
        // the group is gone
      }
    }
    server.kill(signal)
  }

  // Non-pretty output: TS 6 pretty mode drops the ' - ' separator after the timestamp even when piped
  const tsc = execa(options.tsc, ['--noEmit', '--watch', '--preserveWatchOutput', '--pretty', 'false'], {
    cwd,
    reject: false,
    stdout: 'pipe',
    stderr: 'pipe',
    forceKillAfterDelay: false,
  })
  pipeTsc(tsc)

  let signalled = null as NodeJS.Signals | null
  let serverExited = false
  let forceKillTimer: NodeJS.Timeout | undefined

  const policy = createSignalPolicy()
  const stopListening = onTerminationSignals((signal) => {
    const decision = policy(signal)
    if (decision === 'forward') {
      signalled = signal
      logger.info('Shutting down...')
      killServer('SIGTERM')
      tsc.kill('SIGTERM')
      forceKillTimer = setTimeout(() => {
        killServer('SIGKILL')
        tsc.kill('SIGKILL')
      }, FORCE_KILL_AFTER_MS)
      forceKillTimer.unref()
    } else if (decision === 'kill') {
      killServer('SIGKILL')
      tsc.kill('SIGKILL')
    }
  })

  tsc.then((result) => {
    if (serverExited || signalled) return
    logger.warn(`Type-checking stopped (tsc exited with ${result.exitCode ?? result.signal})`)
  })

  try {
    const result = await server
    serverExited = true
    // An app the watcher left behind goes with it
    if (group && server.pid !== undefined) {
      try {
        process.kill(-server.pid, 'SIGTERM')
      } catch {
        // nothing left in the group
      }
    }
    tsc.kill('SIGTERM')
    await tsc

    if (result.failed && result.exitCode === undefined && !result.signal) {
      throw new CliError(result.shortMessage ?? `Failed to start ${serverCmd.command}`)
    }
    return childExitCode(result, signalled)
  } finally {
    clearTimeout(forceKillTimer)
    stopListening()
  }
}
