import { cors, type ListenAdapter, Miia } from '@miiajs/core'
import { AppModule } from './app.module.js'
import { ConfigService } from '@miiajs/config'
import type { Env } from './env.schema.js'
import { serveStatic } from '@miiajs/serve-static'
import { requestId, requestLogger, responseTime } from './common/middleware/index.js'
import { rateLimit, RateLimitGuard } from '@miiajs/rate-limit'

const app = new Miia().register(AppModule)

const configService = app.get<ConfigService<Env>>(ConfigService)
const corsOrigin = configService.get('CORS_ORIGIN')

app.useGuard(RateLimitGuard)

app.use(
  requestId(),
  requestLogger(),
  responseTime(),
  // Perimeter rate limit: independent of the guard/decorator layer (@SkipRateLimit and
  // replacement do not apply here) and the only layer that covers 404s/unmatched routes.
  rateLimit({ limit: 100, window: '10s', message: 'Slow down' }),
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

// Server adapter selection. Bun/Deno are auto-detected when SERVER is unset.
// node-server / uws-server run under Node (`miia dev --runtime node`); the
// adapters are imported dynamically so the uWS native binding never loads
// under Bun (where it would fail to resolve).
const server = configService.get('SERVER')
let adapter: ListenAdapter | undefined
if (server === 'node') {
  adapter = (await import('@miiajs/node-server')).serve
} else if (server === 'uws') {
  adapter = (await import('@miiajs/uws-server')).serve
}

if (adapter) {
  await app.listen(port, host, adapter)
} else {
  await app.listen(port, host)
}
