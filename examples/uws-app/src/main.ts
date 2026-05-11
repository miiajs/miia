import { Miia } from '@miiajs/core'
import { serve } from '@miiajs/uws-server'
import { AppModule } from './app.module.js'

const app = new Miia().register(AppModule)

await app.listen(3000, '0.0.0.0', serve)
