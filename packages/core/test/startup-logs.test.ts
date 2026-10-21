import { afterEach, describe, expect, it } from 'bun:test'
import type { ConfiguredModule, LoggerService, RequestContext, Token } from '../src/index.js'
import {
  Controller,
  createToken,
  Get,
  inject,
  Injectable,
  Logger,
  Miia,
  Module,
  provider,
  Router,
} from '../src/index.js'

const initial = Logger.getLogger()

afterEach(() => {
  Logger.setLogger(initial)
})

function capture(): { logger: LoggerService; lines: string[] } {
  const lines: string[] = []
  const logger: LoggerService = {
    log(message, context) {
      lines.push(`[${context}] ${message}`)
    },
    error() {},
    warn() {},
  }
  return { logger, lines }
}

describe('start-up route logs', () => {
  it('list every route the router registers, at the path it is served at', async () => {
    @Controller('/users')
    class UsersController {
      @Get('/:id')
      show(_ctx: RequestContext) {}
    }

    @Injectable()
    class DocsRoutes {
      private router = inject(Router)

      onReady() {
        this.router.add('GET', '/docs/json', () => ({}), { skipGlobalPrefix: true })
      }
    }

    @Module({ controllers: [UsersController], providers: [DocsRoutes] })
    class AppModule {}

    const { logger, lines } = capture()
    const app = new Miia({ logger, globalPrefix: '/api' }).register(AppModule)
    app.addRoute('GET', '/health', () => ({ ok: true }))
    app.addRoute('GET', '/ping', () => 'pong', { skipGlobalPrefix: true })
    await app.init()

    expect(lines.filter((line) => line.includes('Mapped'))).toEqual([
      '[Router] Mapped {/api/health, GET} route',
      '[Router] Mapped {/ping, GET} route',
      '[Router] Mapped {/api/users/:id, GET} route',
      '[Router] Mapped {/docs/json, GET} route',
    ])
  })

  it('skip a route that conflicts with a registered one', () => {
    const { logger, lines } = capture()
    Logger.setLogger(logger)
    const router = new Router()

    router.add('GET', '/users/:id', () => {})
    expect(() => router.add('GET', '/users/:userId', () => {})).toThrow('conflicts with')

    expect(lines).toEqual(['[Router] Mapped {/users/:id, GET} route'])
  })
})

describe('start-up module logs', () => {
  it('name each configuration of a module class', async () => {
    const MAIN = createToken<string>('MAIN')
    const LOGS = createToken<string>('LOGS')

    class DatabaseModule {
      static configure(token: Token<string>, name: string): ConfiguredModule {
        return { module: DatabaseModule, providers: [provider(token, () => name)], exports: [token], name }
      }
    }

    @Module({ imports: [DatabaseModule.configure(MAIN, 'main'), DatabaseModule.configure(LOGS, 'logs')] })
    class AppModule {}

    const { logger, lines } = capture()
    await new Miia({ logger }).register(AppModule).init()

    expect(lines.filter((line) => line.includes('dependencies initialized'))).toEqual([
      "[ModuleLoader] DatabaseModule (name 'main') dependencies initialized",
      "[ModuleLoader] DatabaseModule (name 'logs') dependencies initialized",
      '[ModuleLoader] AppModule dependencies initialized',
    ])
  })
})
