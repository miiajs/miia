import type { Logger } from '@miiajs/core'
import type mongoose from 'mongoose'

export async function createConnection(
  uri: string,
  logger: Logger,
  options?: mongoose.ConnectOptions,
): Promise<mongoose.Connection> {
  const { createConnection: create } = await import('mongoose')
  const connection = create(uri, options)

  connection.on('error', (err) => {
    logger.error(`Connection error: ${err.message}`, err.stack)
  })

  await connection.asPromise()
  return connection
}

export async function closeConnection(connection: mongoose.Connection): Promise<void> {
  await connection.close()
}
