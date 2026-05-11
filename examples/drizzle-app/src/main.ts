import { Miia } from '@miiajs/core'
import { ConfigService } from '@miiajs/config'
import { AppModule } from './app.module'
import type { Env } from './env.schema'

const app = new Miia().register(AppModule)

const config = app.get<ConfigService<Env>>(ConfigService)
const port = Number(config.get('PORT'))
const host = config.getOrThrow('HOST')

if ('Bun' in globalThis || 'Deno' in globalThis) {
  await app.listen(port, host)
} else {
  const { serve } = await import('@miiajs/node-server')
  await app.listen(port, host, serve)
}
