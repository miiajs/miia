import { afterEach } from 'bun:test'
import type { LoggerService } from '@miiajs/core'
import { Redis, type RedisOptions } from 'ioredis'
import type { RedisStreamsTransport } from '../src/redis-streams-transport.js'

const REDIS_URL = process.env.REDIS_TEST_URL

const open: Redis[] = []

/**
 * Closes every client `testClient()` handed out, after each test - so a failing assertion leaks nothing, and a test
 * cannot forget to close what it never has to name. Call it once at the top of a test file: the runner shares a single
 * instance of this module across the files of a run, so a hook registered here on import would belong to whichever
 * file imported it first and every other file would keep its clients until the process exits.
 */
export function closeClientsAfterEach(): void {
  afterEach(async () => {
    const clients = open.splice(0)
    // `quit()` rejects on a socket that is already gone, which the shutdown tests leave behind on purpose.
    await Promise.all(clients.map((client) => client.quit().catch(() => client.disconnect())))
  })
}

/** A client closed for the test that opened it. Clients a transport builds for itself remain its own to close. */
export function testClient(options?: RedisOptions): Redis {
  const client = new Redis(REDIS_URL!, options ?? {})
  open.push(client)
  return client
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * Poll until `check` holds. Everything under test is driven by a Redis round trip on a timer, so the arrival time is
 * a range rather than a number - polling keeps the assertion about behaviour and the failure message about what never
 * happened. The timeout sits below bun's per-test default so a failure reports this message and not `test timed out`.
 */
export async function waitFor(check: () => boolean | Promise<boolean>, label: string, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await check()) return
    await wait(10)
  }
  throw new Error(`timed out after ${timeoutMs}ms waiting for ${label}`)
}

export interface CapturedLogs {
  errors: string[]
  /** Second argument of each `error()` call, by the same index: the cause a failure line carries. */
  errorDetails: string[]
  warns: string[]
  logs: string[]
}

/** `dlq: false` drops the message; the log line is the only trace it leaves, so the test has to read the logger. */
export function captureLogs(transport: RedisStreamsTransport): CapturedLogs {
  const captured: CapturedLogs = { errors: [], errorDetails: [], warns: [], logs: [] }
  const recorder: LoggerService = {
    log: (message) => {
      captured.logs.push(message)
    },
    warn: (message) => {
      captured.warns.push(message)
    },
    error: (message, trace) => {
      captured.errors.push(message)
      captured.errorDetails.push(trace ?? '')
    },
    debug: () => {},
  }
  ;(transport as unknown as { logger: LoggerService }).logger = recorder
  return captured
}
