import { constants } from 'node:os'

export type SignalDecision = 'forward' | 'ignore' | 'kill'

/**
 * First signal: forward (callers send SIGTERM - the child may already have SIGINT from the TTY or the
 * script runner, and core exits on a second identical signal mid-shutdown). A repeat within the window
 * is the duplicate from `bun run` / `npm run` and is ignored. A later one force-kills.
 */
export function createSignalPolicy(
  opts: { duplicateWindowMs?: number; now?: () => number } = {},
): (signal: NodeJS.Signals) => SignalDecision {
  const { duplicateWindowMs = 1000, now = Date.now } = opts
  let first: number | null = null

  return () => {
    const time = now()
    if (first === null) {
      first = time
      return 'forward'
    }
    return time - first <= duplicateWindowMs ? 'ignore' : 'kill'
  }
}

/** Listens for termination signals until the returned function is called. */
export function onTerminationSignals(handler: (signal: NodeJS.Signals) => void): () => void {
  const signals: NodeJS.Signals[] =
    process.platform === 'win32' ? ['SIGINT', 'SIGTERM'] : ['SIGINT', 'SIGTERM', 'SIGHUP']
  for (const signal of signals) process.on(signal, handler)
  // bun-types narrows Process.off/removeListener to its own events; the EventEmitter signature is the real one
  const emitter: NodeJS.EventEmitter = process
  return () => {
    for (const signal of signals) emitter.off(signal, handler)
  }
}

export function signalExitCode(signal: NodeJS.Signals): number {
  return 128 + (constants.signals[signal] ?? 0)
}

/** The app's own exit code when it exited by itself, 128 + n when a signal ended it. */
export function childExitCode(result: { exitCode?: number; signal?: string }): number {
  if (result.signal) return signalExitCode(result.signal as NodeJS.Signals)
  return result.exitCode ?? 1
}
