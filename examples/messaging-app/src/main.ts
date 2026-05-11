import { Miia } from '@miiajs/core'
import { AppModule } from './app/app.module.js'
import { ConfigService } from '@miiajs/config'
import type { Env } from './env.schema.js'

const app = new Miia().register(AppModule)

const configService = app.get(ConfigService<Env>)
const port = configService.get('PORT')
const host = configService.get('HOST')

await app.listen(port, host)
