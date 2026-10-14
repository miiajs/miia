import { describe, expect, it } from 'bun:test'
import type { RequestContext } from '../src/index.js'
import { Container, Controller, Get, inject, Injectable, Miia, Module } from '../src/index.js'

function get(app: Miia, path: string): Promise<Response> {
  return Promise.resolve(app.fetch(new Request(`http://localhost${path}`)))
}

describe('request scope', () => {
  it('keeps one instance per request across concurrent requests', async () => {
    let seq = 0
    @Injectable({ scope: 'request' })
    class RequestState {
      id = ++seq
    }

    let arrived = 0
    let release!: () => void
    const allArrived = new Promise<void>((resolve) => {
      release = resolve
    })

    @Controller('/state')
    class StateController {
      @Get('/')
      async read(ctx: RequestContext) {
        const first = ctx.resolve(RequestState)
        if (++arrived === 3) release()
        await allArrived
        const second = ctx.resolve(RequestState)
        return { first: first.id, second: second.id }
      }
    }

    @Module({ controllers: [StateController], providers: [RequestState] })
    class AppModule {}

    const app = new Miia({ logger: false }).register(AppModule)
    const results = (await Promise.all([1, 2, 3].map(() => get(app, '/state/').then((res) => res.json())))) as Array<{
      first: number
      second: number
    }>

    for (const { first, second } of results) expect(second).toBe(first)
    expect(new Set(results.map((r) => r.first)).size).toBe(3)
  })

  it('shares a request-scoped dependency of a request-scoped provider within one request', async () => {
    @Injectable({ scope: 'request' })
    class RequestUser {}

    @Injectable({ scope: 'request' })
    class RequestAudit {
      user = inject(RequestUser)
    }

    @Controller('/audit')
    class AuditController {
      @Get('/')
      read(ctx: RequestContext) {
        return { same: ctx.resolve(RequestAudit).user === ctx.resolve(RequestUser) }
      }
    }

    @Module({ controllers: [AuditController], providers: [RequestUser, RequestAudit] })
    class AppModule {}

    const app = new Miia({ logger: false }).register(AppModule)
    expect(await (await get(app, '/audit/')).json()).toEqual({ same: true })
  })

  it('resolves singletons and transients through ctx.resolve()', async () => {
    @Injectable()
    class Clock {}

    @Injectable({ scope: 'transient' })
    class Draft {}

    @Controller('/mixed')
    class MixedController {
      private clock = inject(Clock)

      @Get('/')
      read(ctx: RequestContext) {
        const draft = ctx.resolve(Draft)
        return {
          singleton: ctx.resolve(Clock) === this.clock,
          transient: draft instanceof Draft && ctx.resolve(Draft) !== draft,
        }
      }
    }

    @Module({ controllers: [MixedController], providers: [Clock, Draft] })
    class AppModule {}

    const app = new Miia({ logger: false }).register(AppModule)
    expect(await (await get(app, '/mixed/')).json()).toEqual({ singleton: true, transient: true })
  })

  it('rejects a singleton that injects a request-scoped provider at init', async () => {
    @Injectable({ scope: 'request' })
    class RequestState {}

    @Injectable()
    class Reporter {
      state = inject(RequestState)
    }

    @Module({ providers: [RequestState, Reporter] })
    class AppModule {}

    const app = new Miia({ logger: false }).register(AppModule)
    await expect(app.init()).rejects.toThrow(
      '[Miia] Reporter (singleton) injects request-scoped RequestState - resolve it with ctx.resolve() in the handler, or make Reporter request-scoped',
    )
  })

  it('rejects a transient that injects a request-scoped provider, even inside a request', () => {
    const c = new Container()
    class RequestState {}
    class Draft {
      state = inject(RequestState)
    }
    c.registerClass(RequestState, 'request')
    c.registerClass(Draft, 'transient')

    expect(() => c.resolveInRequest(Draft, new Map())).toThrow(/Draft \(transient\) injects request-scoped/)
  })

  it('rejects app.get() of a request-scoped provider', () => {
    @Injectable({ scope: 'request' })
    class RequestState {}

    @Module({ providers: [RequestState] })
    class AppModule {}

    const app = new Miia({ logger: false }).register(AppModule)
    expect(() => app.get(RequestState)).toThrow(
      '[Miia] Request-scoped RequestState can only be resolved inside a request (ctx.resolve)',
    )
  })
})
