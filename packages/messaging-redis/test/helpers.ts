import { afterEach } from 'bun:test'
import { Redis } from 'ioredis'

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
export function testClient(): Redis {
  const client = new Redis(REDIS_URL!)
  open.push(client)
  return client
}
