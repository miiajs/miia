import { Logger } from '@miiajs/core'

export interface ConnectionResult {
  client: any
  db: any
}

export async function createConnection(url: string, logger: Logger, dbName?: string): Promise<ConnectionResult> {
  const { MongoClient } = await import('mongodb')

  const client = new MongoClient(url, {
    monitorCommands: true,
  })

  client.on('commandStarted', (event: any) => {
    logger.debug(`${event.commandName} ${JSON.stringify(event.command)}`)
  })

  await client.connect()
  const db = dbName ? client.db(dbName) : client.db()
  await db.command({ ping: 1 })

  return { client, db }
}

export async function closeConnection(client: any): Promise<void> {
  await client.close()
}
