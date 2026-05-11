import { execa } from 'execa'
import type { ResultPromise } from 'execa'
import { getDevServerCommand } from '../runtime/commands.js'
import { pipeTsc } from './tsc-pipe.js'
import { logger } from '../utils/logger.js'
import type { Runtime } from '../runtime/types.js'

export interface DevOptions {
  runtime: Runtime
  cwd: string
  entry: string
  envFile?: string
}

const CRASH_WINDOW_MS = 10_000
const CRASH_CAP = 5
const RESTART_DELAY_MS = 500

export async function startDev(options: DevOptions): Promise<void> {
  const { runtime, cwd, entry, envFile } = options

  let isShuttingDown = false
  const crashTimestamps: number[] = []
  let serverProcess: ResultPromise | null = null
  let restartTimer: NodeJS.Timeout | null = null

  const spawnServer = () => {
    const serverCmd = getDevServerCommand(runtime, entry, cwd, envFile)
    const proc = execa(serverCmd.command, serverCmd.args, {
      cwd,
      reject: false,
      stdio: 'inherit',
      env: { ...process.env, NODE_ENV: 'development' },
    })
    serverProcess = proc

    proc.on('exit', (code, signal) => {
      if (isShuttingDown || signal) return
      if (proc !== serverProcess) return

      const now = Date.now()
      crashTimestamps.push(now)
      while (crashTimestamps.length > 0 && now - crashTimestamps[0] > CRASH_WINDOW_MS) {
        crashTimestamps.shift()
      }

      if (crashTimestamps.length >= CRASH_CAP) {
        logger.error(`Server crashed ${CRASH_CAP} times in ${CRASH_WINDOW_MS / 1000}s, giving up`)
        cleanup()
        return
      }

      logger.warn(`Server exited (code ${code}), restarting...`)
      restartTimer = setTimeout(() => {
        restartTimer = null
        if (!isShuttingDown) spawnServer()
      }, RESTART_DELAY_MS)
    })
  }

  const tscProcess = execa('tsc', ['--noEmit', '--watch', '--preserveWatchOutput'], {
    cwd,
    reject: false,
    stdout: 'pipe',
    stderr: 'pipe',
  })

  pipeTsc(tscProcess)

  const cleanup = () => {
    if (isShuttingDown) return
    isShuttingDown = true
    logger.info('Shutting down...')
    if (restartTimer) {
      clearTimeout(restartTimer)
      restartTimer = null
    }
    tscProcess.kill('SIGTERM')
    serverProcess?.kill('SIGTERM')

    setTimeout(() => {
      tscProcess.kill('SIGKILL')
      serverProcess?.kill('SIGKILL')
    }, 5000).unref()
  }

  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)
  process.on('SIGHUP', cleanup)
  process.on('exit', cleanup)

  spawnServer()

  const tscResult = await tscProcess
  if (!isShuttingDown && tscResult.exitCode !== 0 && !tscResult.isTerminated) {
    logger.error('tsc watch exited unexpectedly')
  }
  cleanup()
}
