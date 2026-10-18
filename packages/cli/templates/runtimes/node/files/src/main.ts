import { ConfigService } from '@miiajs/config'
import { Miia } from '@miiajs/core'
import { serve } from '@miiajs/node-server'
import { AppModule } from './app/app.module.js'
import type { Env } from './env.schema.js'

const app = new Miia().register(AppModule)
const config = app.get<ConfigService<Env>>(ConfigService)

await app.listen(config.get('PORT'), config.get('HOST'), serve)
