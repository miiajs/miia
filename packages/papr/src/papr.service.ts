import { Logger } from '@miiajs/core'
import type { Db, MongoClient } from 'mongodb'
import type Papr from 'papr'
import type { Model } from 'papr'
import type { PaprModuleOptions } from './types.js'
import type { ModelToken } from './define-model.js'
import { createConnection, closeConnection } from './connection.js'
import { DEFAULT_RETRY_ATTEMPTS, DEFAULT_RETRY_DELAY, LOGGER_CONTEXT, RETRYABLE_CODES } from './constants.js'

/**
 * Internal lifecycle owner for a PaprModule connection. NOT exported from the
 * package index. Users interact with @miiajs/papr through `inject(User)` /
 * `inject(paprDb())` only.
 *
 * Holds the MongoClient, mongodb Db, Papr instance, and the per-token
 * Model<TDoc, TOpts> map. Resolved by per-model providers in PaprModule.register()
 * and the db-token provider in PaprModule.configure().
 */
export class PaprService {
  private logger = new Logger(LOGGER_CONTEXT)
  private client: MongoClient | null = null
  private _db: Db | null = null
  private _papr: Papr | null = null
  private _models = new Map<ModelToken<any, any>, Model<any, any>>()

  constructor(
    private readonly options: PaprModuleOptions,
    private readonly registry: Map<ModelToken<any, any>, ModelToken<any, any>>,
  ) {}

  get db(): Db {
    if (!this._db) {
      throw new Error('[Miia/Papr] Not connected. Ensure app.init() was called.')
    }
    return this._db
  }

  getModel(token: ModelToken<any, any>): Model<any, any> {
    const m = this._models.get(token)
    if (!m) {
      throw new Error(
        `[Miia/Papr] Model "${token.collectionName}" not initialized. ` +
          `Did you forget to register it with PaprModule.register([${token.name}])?`,
      )
    }
    return m
  }

  async onInit(): Promise<void> {
    this.assertNoCollectionCollision()

    const attempts = this.options.connection.retry?.attempts ?? DEFAULT_RETRY_ATTEMPTS
    const delay = this.options.connection.retry?.delay ?? DEFAULT_RETRY_DELAY

    for (let i = 1; i <= attempts; i++) {
      let client: MongoClient | null = null
      try {
        const conn = await createConnection(this.options.connection.url, this.logger, this.options.connection.dbName)
        client = conn.client
        this.client = conn.client
        this._db = conn.db

        const PaprDefault = (await import('papr')).default
        const papr = new PaprDefault()

        for (const token of this.registry.values()) {
          const model = papr.model(token.collectionName, token.schema)
          this._models.set(token, model)
        }

        papr.initialize(conn.db)
        await papr.updateSchemas()
        this._papr = papr
        return
      } catch (error: any) {
        // Resource leak fix: close client if connect succeeded but a later
        // step (model creation, updateSchemas, etc) failed.
        if (client) {
          try {
            await closeConnection(client)
          } catch {
            // swallow - we're already in an error path
          }
          this.client = null
          this._db = null
          this._models.clear()
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
    this.logger.log('Disconnecting from MongoDB...')
    if (this.client) {
      await closeConnection(this.client)
    }
    this._db = null
    this._papr = null
    this._models.clear()
    this.client = null
    this.logger.log('Disconnected from MongoDB')
  }

  private assertNoCollectionCollision(): void {
    const seen = new Map<string, ModelToken<any, any>>()
    for (const token of this.registry.values()) {
      const previous = seen.get(token.collectionName)
      if (previous && previous !== token) {
        throw new Error(
          `[Miia/Papr] Two distinct ModelToken-s registered for the same collection ` +
            `"${token.collectionName}" on the same connection. ` +
            `Each collection must be defined once per connection.`,
        )
      }
      seen.set(token.collectionName, token)
    }
  }
}
