import { Logger } from '@miiajs/core'
import type { DrizzleModuleOptions } from './types.js'
import { createConnection, closeConnection } from './connection.js'
import { DEFAULT_RETRY_ATTEMPTS, DEFAULT_RETRY_DELAY, LOGGER_CONTEXT, RETRYABLE_CODES } from './constants.js'

/**
 * Internal lifecycle owner for a DrizzleModule connection. NOT exported from the
 * package index. Users interact with @miiajs/drizzle through `inject(db)` where
 * `db = drizzleDb<TDb>()`.
 */
export class DrizzleService {
  private logger = new Logger(LOGGER_CONTEXT)
  private client: any = null
  private _db: any = null

  constructor(private readonly options: DrizzleModuleOptions) {}

  get db(): any {
    if (!this._db) {
      throw new Error('[Miia/Drizzle] Not connected. Ensure app.init() was called.')
    }
    return this._db
  }

  async onInit(): Promise<void> {
    const attempts = this.options.connection.retry?.attempts ?? DEFAULT_RETRY_ATTEMPTS
    const delay = this.options.connection.retry?.delay ?? DEFAULT_RETRY_DELAY

    for (let i = 1; i <= attempts; i++) {
      let client: any = null
      try {
        const conn = await createConnection(
          this.options.dialect,
          this.options.connection.url,
          this.logger,
          this.options.casing,
          this.options.connection.pool,
        )
        client = conn.client
        const db = conn.createDb(this.options.schema ?? {})
        this.client = client
        this._db = db
        return
      } catch (error: any) {
        // Resource leak fix: close client if connect succeeded but a later
        // step (createDb, etc) failed.
        if (client) {
          try {
            await closeConnection(this.options.dialect, client)
          } catch {
            // swallow - we're already in an error path
          }
          this.client = null
          this._db = null
        }

        const code = error?.code ?? error?.cause?.code
        const retryable = code && RETRYABLE_CODES.has(code)

        if (!retryable || i === attempts) {
          this.logger.error(
            retryable ? `Failed to connect after ${attempts} attempts` : `Connection failed: ${error.message}`,
            error.stack,
          )
          throw error
        }
        this.logger.error(`Database connection failed. Retrying (${i}/${attempts})...`)
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
  }

  async onDestroy(): Promise<void> {
    this.logger.log('Disconnecting from database...')
    if (this.client) {
      await closeConnection(this.options.dialect, this.client)
    }
    this._db = null
    this.client = null
    this.logger.log('Disconnected from database')
  }
}
