import { Logger } from '@miiajs/core'
import type mongoose from 'mongoose'
import type { MongooseModuleOptions } from './types.js'
import type { ModelToken } from './define-model.js'
import { closeConnection, createConnection } from './connection.js'
import { DEFAULT_RETRY_ATTEMPTS, DEFAULT_RETRY_DELAY, LOGGER_CONTEXT, RETRYABLE_CODES } from './constants.js'

/**
 * Internal lifecycle owner for a MongooseModule connection. NOT exported from
 * the package index. Users interact with @miiajs/mongoose through `inject(User)`
 * / `inject(mongooseConnection())` only.
 */
export class MongooseService {
  private logger = new Logger(LOGGER_CONTEXT)
  private _connection: mongoose.Connection | null = null
  private _models = new Map<ModelToken<any>, mongoose.Model<any>>()

  constructor(
    private readonly options: MongooseModuleOptions,
    private readonly registry: Map<ModelToken<any>, ModelToken<any>>,
  ) {}

  get connection(): mongoose.Connection {
    if (!this._connection) {
      throw new Error('[Miia/Mongoose] Not connected. Ensure app.init() was called.')
    }
    return this._connection
  }

  getModel(token: ModelToken<any>): mongoose.Model<any> {
    const m = this._models.get(token)
    if (!m) {
      throw new Error(
        `[Miia/Mongoose] Model "${token.modelName}" not initialized. ` +
          `Did you forget to register it with MongooseModule.register([${token.name}])?`,
      )
    }
    return m
  }

  async onInit(): Promise<void> {
    this.assertNoModelNameCollision()

    const attempts = this.options.retry?.attempts ?? DEFAULT_RETRY_ATTEMPTS
    const delay = this.options.retry?.delay ?? DEFAULT_RETRY_DELAY

    for (let i = 1; i <= attempts; i++) {
      let connection: mongoose.Connection | null = null
      try {
        connection = await createConnection(this.options.uri, this.logger, this.options.connectionOptions)
        this._connection = connection

        for (const token of this.registry.values()) {
          const compiled = connection.model(token.modelName, token.schema)
          this._models.set(token, compiled)
        }

        this.logger.log('Connected to MongoDB')
        return
      } catch (error: any) {
        // Resource leak fix: close connection if it succeeded but a later
        // step (model compilation) failed.
        if (connection) {
          try {
            await closeConnection(connection)
          } catch {
            // swallow - we're already in an error path
          }
          this._connection = null
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
        this.logger.error(`MongoDB connection failed. Retrying (${i}/${attempts})...`)
        await new Promise((r) => setTimeout(r, delay))
      }
    }
  }

  async onDestroy(): Promise<void> {
    this.logger.log('Disconnecting from MongoDB...')
    if (this._connection) {
      await closeConnection(this._connection)
    }
    this._connection = null
    this._models.clear()
    this.logger.log('Disconnected from MongoDB')
  }

  private assertNoModelNameCollision(): void {
    const seen = new Map<string, ModelToken<any>>()
    for (const token of this.registry.values()) {
      const previous = seen.get(token.modelName)
      if (previous && previous !== token) {
        throw new Error(
          `[Miia/Mongoose] Two distinct ModelToken-s registered for the same model name ` +
            `"${token.modelName}" on the same connection. ` +
            `Each model must be defined once per connection.`,
        )
      }
      seen.set(token.modelName, token)
    }
  }
}
