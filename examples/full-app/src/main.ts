import { cors, Miia } from '@miiajs/core'
import { AppModule } from './app.module.js'
import { ConfigService } from '@miiajs/config'
import type { Env } from './env.schema.js'
import { serveStatic } from '@miiajs/serve-static'
import { requestId, requestLogger, responseTime } from './common/middleware/index.js'

const app = new Miia().register(AppModule)

const configService = app.get<ConfigService<Env>>(ConfigService)
const corsOrigin = configService.get('CORS_ORIGIN')

app.use(
  requestId(),
  requestLogger(),
  responseTime(),
  cors({
    origin: corsOrigin,
    credentials: corsOrigin !== '*',
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposedHeaders: ['X-Response-Time', 'X-Request-Id'],
  }),
)

serveStatic(app, '/static', './public')
app.addRoute('GET', '/', () => Response.redirect('/static', 302))

const port = configService.get('PORT')
const host = configService.get('HOST')

await app.listen(port, host)
