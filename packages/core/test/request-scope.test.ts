import { describe, expect, it } from 'bun:test'
import type { AnyToken, Middleware, RequestContext } from '../src/index.js'
import {
  BadRequestException,
  Controller,
  createLazyProxy,
  createToken,
  Get,
  inject,
  Injectable,
  Miia,
  Module,
  provider,
  REQUEST_CONTEXT,
  Use,
} from '../src/index.js'
import { Container } from '../src/di-container.js'
import type { RequestScopeHolder } from '../src/di-container.js'

function get(app: Miia, path: string): Promise<Response> {
  return Promise.resolve(app.fetch(new Request(`http://localhost${path}`)))
}

/** Lets the onDestroy() hooks a finished request started run to the end. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function capturingLogger(errors: string[]) {
  return {
    log() {},
    error(message: string) {
      errors.push(message)
    },
    warn() {},
  }
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

    expect(() => c.resolveInRequest(Draft, { _scope: null })).toThrow(/Draft \(transient\) injects request-scoped/)
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

describe('REQUEST_CONTEXT', () => {
  it('is the context of the request in a request-scoped class and factory', async () => {
    @Injectable({ scope: 'request' })
    class RequestInfo {
      ctx = inject(REQUEST_CONTEXT)
    }

    const FROM_FACTORY = createToken<{ ctx: RequestContext }>('FromFactory')

    @Controller('/info')
    class InfoController {
      @Get('/')
      read(ctx: RequestContext) {
        return {
          injected: ctx.resolve(RequestInfo).ctx === ctx,
          factory: ctx.resolve(FROM_FACTORY).ctx === ctx,
          direct: ctx.resolve(REQUEST_CONTEXT) === ctx,
        }
      }
    }

    @Module({
      controllers: [InfoController],
      providers: [
        RequestInfo,
        provider(FROM_FACTORY, (resolve) => ({ ctx: resolve(REQUEST_CONTEXT) }), { scope: 'request' }),
      ],
    })
    class AppModule {}

    const app = new Miia({ logger: false }).register(AppModule)
    expect(await (await get(app, '/info/')).json()).toEqual({ injected: true, factory: true, direct: true })
  })

  it('rejects a singleton that injects it at init', async () => {
    @Injectable()
    class Reporter {
      ctx = inject(REQUEST_CONTEXT)
    }

    @Module({ providers: [Reporter] })
    class AppModule {}

    const app = new Miia({ logger: false }).register(AppModule)
    await expect(app.init()).rejects.toThrow(
      '[Miia] Reporter (singleton) injects request-scoped RequestContext - resolve it with ctx.resolve() in the handler, or make Reporter request-scoped',
    )
  })

  it('rejects app.get()', () => {
    const app = new Miia({ logger: false })
    expect(() => app.get(REQUEST_CONTEXT)).toThrow(
      '[Miia] Request-scoped RequestContext can only be resolved inside a request (ctx.resolve)',
    )
  })

  it('rejects a module that declares it in providers, naming the module', async () => {
    @Module({ providers: [provider(REQUEST_CONTEXT, () => ({}) as RequestContext)] })
    class AppModule {}

    const app = new Miia({ logger: false }).register(AppModule)
    await expect(app.init()).rejects.toThrow(
      '[Miia] AppModule declares REQUEST_CONTEXT in providers - it is built in and seeded by every request, so it takes no provider; remove it from providers',
    )
  })

  it('names the host of a configure() result that declares it', async () => {
    @Module({})
    class ContextModule {
      static configure() {
        return { module: ContextModule, providers: [provider(REQUEST_CONTEXT, () => ({}) as RequestContext)] }
      }
    }

    @Module({ imports: [ContextModule.configure()] })
    class AppModule {}

    const app = new Miia({ logger: false }).register(AppModule)
    await expect(app.init()).rejects.toThrow(
      '[Miia] ContextModule in AppModule declares REQUEST_CONTEXT in providers - it is built in and seeded by every request, so it takes no provider; remove it from providers',
    )
  })
})

describe('the end of a request', () => {
  function trackingApp(events: string[]): Miia {
    @Injectable({ scope: 'request' })
    class Tracked {
      onDestroy() {
        events.push('destroyed')
      }
    }

    const touch: Middleware = async (ctx, next) => {
      ctx.resolve(Tracked)
      await next()
    }

    @Controller('/')
    class PathsController {
      @Get('sync')
      sync(ctx: RequestContext) {
        ctx.resolve(Tracked)
        return { ok: true }
      }

      @Get('built')
      built(ctx: RequestContext) {
        ctx.resolve(Tracked)
        ctx.res.header('X-Built', '1')
        return { ok: true }
      }

      @Get('async')
      async async(ctx: RequestContext) {
        await null
        ctx.resolve(Tracked)
        return { ok: true }
      }

      @Get('throws')
      throws(ctx: RequestContext) {
        ctx.resolve(Tracked)
        throw new BadRequestException('no')
      }

      @Get('rejects')
      async rejects(ctx: RequestContext) {
        ctx.resolve(Tracked)
        throw new BadRequestException('no')
      }

      @Get('middleware')
      @Use(touch)
      middleware() {
        return { ok: true }
      }

      @Get('middleware-throws')
      @Use(touch)
      middlewareThrows() {
        throw new BadRequestException('no')
      }
    }

    @Module({ controllers: [PathsController], providers: [Tracked] })
    class AppModule {}

    return new Miia({ logger: false }).register(AppModule)
  }

  const paths = [
    ['sync', 200],
    ['built', 200],
    ['async', 200],
    ['throws', 400],
    ['rejects', 400],
    ['middleware', 200],
    ['middleware-throws', 400],
  ] as const

  for (const [path, status] of paths) {
    it(`destroys request-scoped instances after the response: /${path}`, async () => {
      const events: string[] = []
      const app = trackingApp(events)
      const res = await get(app, `/${path}`)
      expect(res.status).toBe(status)
      await settle()
      expect(events).toEqual(['destroyed'])
    })
  }

  it('destroys them behind global middleware, also when it stops early', async () => {
    const events: string[] = []

    @Injectable({ scope: 'request' })
    class Tracked {
      onDestroy() {
        events.push('destroyed')
      }
    }

    @Controller('/')
    class PingController {
      @Get('ping')
      ping(ctx: RequestContext) {
        ctx.resolve(Tracked)
        return { ok: true }
      }

      @Get('fails')
      fails(ctx: RequestContext) {
        ctx.resolve(Tracked)
        throw new BadRequestException('no')
      }
    }

    @Module({ controllers: [PingController], providers: [Tracked] })
    class AppModule {}

    const app = new Miia({ logger: false })
      .use((ctx, next) => {
        if (ctx.req.headers.get('x-stop') === null) return next()
        ctx.resolve(Tracked)
        ctx.res.status(204)
      })
      .register(AppModule)

    expect((await get(app, '/ping')).status).toBe(200)
    expect((await get(app, '/fails')).status).toBe(400)
    const stopped = await app.fetch(new Request('http://localhost/ping', { headers: { 'x-stop': '1' } }))
    expect(stopped.status).toBe(204)
    await settle()
    expect(events).toEqual(['destroyed', 'destroyed', 'destroyed'])
  })

  it('runs the hooks after fetch() returns, not inside it', async () => {
    const events: string[] = []
    const app = trackingApp(events)
    await app.init()
    const res = app.fetch(new Request('http://localhost/sync'))
    expect(res).toBeInstanceOf(Response)
    expect(events).toEqual([])
    await settle()
    expect(events).toEqual(['destroyed'])
  })

  it('does not change data the handler returned', async () => {
    @Injectable({ scope: 'request' })
    class State {
      data = { status: 'fresh' }

      onDestroy() {
        this.data.status = 'destroyed'
      }
    }

    @Controller('/')
    class StateController {
      @Get('sync')
      sync(ctx: RequestContext) {
        return ctx.resolve(State).data
      }

      @Get('built')
      built(ctx: RequestContext) {
        ctx.res.header('X-Built', '1')
        return ctx.resolve(State).data
      }

      @Get('async')
      async async(ctx: RequestContext) {
        await null
        return ctx.resolve(State).data
      }

      @Get('middleware')
      @Use((_ctx, next) => next())
      middleware(ctx: RequestContext) {
        return ctx.resolve(State).data
      }
    }

    @Module({ controllers: [StateController], providers: [State] })
    class AppModule {}

    const app = new Miia({ logger: false }).register(AppModule)
    for (const path of ['sync', 'built', 'async', 'middleware']) {
      expect(await (await get(app, `/${path}`)).json()).toEqual({ status: 'fresh' })
    }
  })

  it('destroys the dependent before its dependency, an instance under two tokens once', async () => {
    const events: string[] = []

    @Injectable({ scope: 'request' })
    class Session {
      onDestroy() {
        events.push('Session')
      }
    }

    @Injectable({ scope: 'request' })
    class Audit {
      session = inject(Session)

      onDestroy() {
        events.push('Audit')
      }
    }

    const CURRENT_AUDIT = createToken<Audit>('CurrentAudit')

    @Controller('/')
    class AuditController {
      @Get('audit')
      read(ctx: RequestContext) {
        return { same: ctx.resolve(CURRENT_AUDIT) === ctx.resolve(Audit) }
      }
    }

    @Module({
      controllers: [AuditController],
      providers: [Session, Audit, provider(CURRENT_AUDIT, (resolve) => resolve(Audit), { scope: 'request' })],
    })
    class AppModule {}

    const app = new Miia({ logger: false }).register(AppModule)
    expect(await (await get(app, '/audit')).json()).toEqual({ same: true })
    await settle()
    expect(events).toEqual(['Audit', 'Session'])
  })

  it('logs a hook that throws and runs the rest, the response stays', async () => {
    const events: string[] = []
    const errors: string[] = []

    @Injectable({ scope: 'request' })
    class First {
      onDestroy() {
        events.push('First')
      }
    }

    @Injectable({ scope: 'request' })
    class Broken {
      async onDestroy() {
        throw new Error('cannot close')
      }
    }

    @Controller('/')
    class BrokenController {
      @Get('broken')
      read(ctx: RequestContext) {
        ctx.resolve(First)
        ctx.resolve(Broken)
        return { ok: true }
      }
    }

    @Module({ controllers: [BrokenController], providers: [First, Broken] })
    class AppModule {}

    const app = new Miia({ logger: capturingLogger(errors) }).register(AppModule)
    const res = await get(app, '/broken')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    await settle()
    expect(events).toEqual(['First'])
    expect(errors).toEqual(['Broken.onDestroy() failed at the end of a request'])
  })

  it('runs sync hooks in one microtask, newest first, past one that throws', async () => {
    const events: string[] = []
    const errors: string[] = []

    @Injectable({ scope: 'request' })
    class First {
      onDestroy() {
        events.push('First')
      }
    }

    @Injectable({ scope: 'request' })
    class Throws {
      onDestroy() {
        throw new Error('cannot close')
      }
    }

    @Injectable({ scope: 'request' })
    class Last {
      onDestroy() {
        events.push('Last')
      }
    }

    @Controller('/')
    class SyncController {
      @Get('sync')
      read(ctx: RequestContext) {
        ctx.resolve(First)
        ctx.resolve(Throws)
        ctx.resolve(Last)
        return { ok: true }
      }
    }

    @Module({ controllers: [SyncController], providers: [First, Throws, Last] })
    class AppModule {}

    const app = new Miia({ logger: capturingLogger(errors) }).register(AppModule)
    await app.init()
    const res = app.fetch(new Request('http://localhost/sync'))
    expect(res).toBeInstanceOf(Response)
    expect(events).toEqual([])
    await null
    expect(events).toEqual(['Last', 'First'])
    expect(errors).toEqual(['Throws.onDestroy() failed at the end of a request'])
  })

  it('waits for an async hook before the next one, past one that rejects', async () => {
    const events: string[] = []
    const errors: string[] = []
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })

    @Injectable({ scope: 'request' })
    class First {
      onDestroy() {
        events.push('First')
      }
    }

    @Injectable({ scope: 'request' })
    class Rejects {
      async onDestroy() {
        events.push('Rejects')
        throw new Error('cannot close')
      }
    }

    @Injectable({ scope: 'request' })
    class Slow {
      async onDestroy() {
        events.push('Slow:start')
        await gate
        events.push('Slow:end')
      }
    }

    @Injectable({ scope: 'request' })
    class Last {
      onDestroy() {
        events.push('Last')
      }
    }

    @Controller('/')
    class MixedController {
      @Get('mixed')
      read(ctx: RequestContext) {
        ctx.resolve(First)
        ctx.resolve(Rejects)
        ctx.resolve(Slow)
        ctx.resolve(Last)
        return { ok: true }
      }
    }

    @Module({ controllers: [MixedController], providers: [First, Rejects, Slow, Last] })
    class AppModule {}

    const app = new Miia({ logger: capturingLogger(errors) }).register(AppModule)
    expect((await get(app, '/mixed')).status).toBe(200)
    await settle()
    expect(events).toEqual(['Last', 'Slow:start'])
    release()
    await settle()
    expect(events).toEqual(['Last', 'Slow:start', 'Slow:end', 'Rejects', 'First'])
    expect(errors).toEqual(['Rejects.onDestroy() failed at the end of a request'])
  })

  it('keeps going when the logger itself throws', async () => {
    const events: string[] = []

    @Injectable({ scope: 'request' })
    class First {
      onDestroy() {
        events.push('First')
      }
    }

    @Injectable({ scope: 'request' })
    class Throws {
      onDestroy() {
        throw new Error('cannot close')
      }
    }

    @Controller('/')
    class LoggerController {
      @Get('logger')
      read(ctx: RequestContext) {
        ctx.resolve(First)
        ctx.resolve(Throws)
        return { ok: true }
      }
    }

    @Module({ controllers: [LoggerController], providers: [First, Throws] })
    class AppModule {}

    const logger = {
      log() {},
      error(): never {
        throw new Error('logger is down')
      },
      warn() {},
    }
    const app = new Miia({ logger }).register(AppModule)
    expect((await get(app, '/logger')).status).toBe(200)
    await settle()
    expect(events).toEqual(['First'])
  })

  it('does not destroy a singleton a request factory returns, a lazy proxy or the context itself', async () => {
    const events: string[] = []

    @Injectable()
    class UserRepo {
      onDestroy() {
        events.push('UserRepo')
      }
    }

    class Connection {
      ping() {
        return 'pong'
      }

      onDestroy() {
        events.push('Connection')
      }
    }

    const CURRENT_REPO = createToken<UserRepo>('CurrentRepo')
    const LAZY_CONNECTION = createToken<Connection>('LazyConnection')
    const CONTEXT_ALIAS = createToken<RequestContext>('ContextAlias')

    @Controller('/')
    class OwnedController {
      @Get('owned')
      read(ctx: RequestContext) {
        Object.assign(ctx, { onDestroy: () => events.push('context') })
        return {
          repo: ctx.resolve(CURRENT_REPO) instanceof UserRepo,
          ping: ctx.resolve(LAZY_CONNECTION).ping(),
          alias: ctx.resolve(CONTEXT_ALIAS) === ctx,
        }
      }
    }

    @Module({
      controllers: [OwnedController],
      providers: [
        UserRepo,
        provider(CURRENT_REPO, (resolve) => resolve(UserRepo), { scope: 'request' }),
        provider(LAZY_CONNECTION, () => createLazyProxy(() => new Connection()), { scope: 'request' }),
        provider(CONTEXT_ALIAS, (resolve) => resolve(REQUEST_CONTEXT), { scope: 'request' }),
      ],
    })
    class AppModule {}

    const app = new Miia({ logger: false }).register(AppModule)
    expect(await (await get(app, '/owned')).json()).toEqual({ repo: true, ping: 'pong', alias: true })
    await settle()
    expect(events).toEqual([])
    await app.destroy()
    expect(events).toEqual(['UserRepo'])
  })

  it('rejects a request-scoped resolve on a finished request, singletons still resolve', async () => {
    @Injectable({ scope: 'request' })
    class RequestState {}

    @Injectable()
    class Clock {}

    let captured: RequestContext | undefined

    @Controller('/')
    class CaptureController {
      @Get('capture')
      read(ctx: RequestContext) {
        captured = ctx
        return { ok: true }
      }
    }

    @Module({ controllers: [CaptureController], providers: [RequestState, Clock] })
    class AppModule {}

    const app = new Miia({ logger: false }).register(AppModule)
    expect((await get(app, '/capture')).status).toBe(200)
    expect(() => captured!.resolve(RequestState)).toThrow(
      '[Miia] Request-scoped RequestState was resolved after its request finished (e.g. from a streaming response) - resolve it in the handler before returning',
    )
    expect(captured!.resolve(Clock)).toBe(app.get(Clock))
  })

  it('creates no scope for singletons and transients', async () => {
    @Injectable()
    class Clock {}

    @Injectable({ scope: 'transient' })
    class Draft {}

    let during: unknown = 'unset'
    let captured: RequestContext | undefined

    @Controller('/')
    class ScopeController {
      @Get('scope')
      read(ctx: RequestContext) {
        ctx.resolve(Clock)
        ctx.resolve(Draft)
        during = (ctx as unknown as { _scope: unknown })._scope
        captured = ctx
        return { ok: true }
      }
    }

    @Module({ controllers: [ScopeController], providers: [Clock, Draft] })
    class AppModule {}

    const app = new Miia({ logger: false }).register(AppModule)
    expect((await get(app, '/scope')).status).toBe(200)
    expect(during).toBeNull()
    expect(typeof (captured as unknown as { _scope: unknown })._scope).toBe('symbol')
  })
})

describe('app.destroy() after requests', () => {
  function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  function singletonHooks(events: string[]) {
    @Injectable()
    class Pool {
      onShutdown() {
        events.push('Pool.onShutdown')
      }

      onDestroy() {
        events.push('Pool.onDestroy')
      }
    }
    return Pool
  }

  it('waits for an async onDestroy() of a finished request before the singleton hooks', async () => {
    const events: string[] = []
    const Pool = singletonHooks(events)

    @Injectable({ scope: 'request' })
    class Session {
      pool = inject(Pool)

      async onDestroy() {
        await delay(20)
        events.push('Session.onDestroy')
      }
    }

    @Controller('/')
    class SessionController {
      @Get('session')
      read(ctx: RequestContext) {
        ctx.resolve(Session)
        return { ok: true }
      }
    }

    @Module({ controllers: [SessionController], providers: [Pool, Session] })
    class AppModule {}

    const app = new Miia({ logger: false }).register(AppModule)
    await app.init()
    expect((await app.fetch(new Request('http://localhost/session'))).status).toBe(200)
    await app.destroy()
    events.push('destroy() returned')
    expect(events).toEqual(['Session.onDestroy', 'Pool.onShutdown', 'Pool.onDestroy', 'destroy() returned'])
  })

  it('waits for a chain of async onDestroy() hooks, newest first', async () => {
    const events: string[] = []
    const Pool = singletonHooks(events)

    @Injectable({ scope: 'request' })
    class Transaction {
      async onDestroy() {
        await delay(10)
        events.push('Transaction.onDestroy')
      }
    }

    @Injectable({ scope: 'request' })
    class UnitOfWork {
      tx = inject(Transaction)

      async onDestroy() {
        await delay(10)
        events.push('UnitOfWork.onDestroy')
      }
    }

    @Controller('/')
    class WorkController {
      @Get('work')
      read(ctx: RequestContext) {
        ctx.resolve(UnitOfWork)
        return { ok: true }
      }
    }

    @Module({ controllers: [WorkController], providers: [Pool, Transaction, UnitOfWork] })
    class AppModule {}

    const app = new Miia({ logger: false }).register(AppModule)
    expect((await get(app, '/work')).status).toBe(200)
    await app.destroy()
    expect(events).toEqual(['UnitOfWork.onDestroy', 'Transaction.onDestroy', 'Pool.onShutdown', 'Pool.onDestroy'])
  })

  it('waits for every hook of a chain of three async onDestroy() hooks', async () => {
    const events: string[] = []
    const Pool = singletonHooks(events)

    const step = (name: string) => {
      @Injectable({ scope: 'request' })
      class Step {
        async onDestroy() {
          await delay(5)
          events.push(`${name}.onDestroy`)
        }
      }
      return Step
    }
    const First = step('First')
    const Second = step('Second')
    const Third = step('Third')

    @Controller('/')
    class StepsController {
      @Get('steps')
      read(ctx: RequestContext) {
        ctx.resolve(First)
        ctx.resolve(Second)
        ctx.resolve(Third)
        return { ok: true }
      }
    }

    @Module({ controllers: [StepsController], providers: [Pool, First, Second, Third] })
    class AppModule {}

    const app = new Miia({ logger: false }).register(AppModule)
    expect((await get(app, '/steps')).status).toBe(200)
    await app.destroy()
    expect(events).toEqual([
      'Third.onDestroy',
      'Second.onDestroy',
      'First.onDestroy',
      'Pool.onShutdown',
      'Pool.onDestroy',
    ])
  })

  it('runs the hooks of a request that ended in the same tick as a direct destroyAll()', async () => {
    const events: string[] = []
    const c = new Container()

    class Pool {
      onShutdown() {
        events.push('Pool.onShutdown')
      }
    }

    class Session {
      async onDestroy() {
        await delay(10)
        events.push('Session.onDestroy')
      }
    }

    c.registerClass(Pool)
    c.registerClass(Session, 'request')
    c.constructAll()
    const holder: RequestScopeHolder = { _scope: null }
    c.resolveInRequest(Session, holder)
    // What the context does when the pipeline has finished, then shutdown in the same tick
    c.destroyRequestScope(holder._scope as Map<AnyToken, unknown>, holder)
    await c.destroyAll()
    expect(events).toEqual(['Session.onDestroy', 'Pool.onShutdown'])
  })

  it('does not wait for a request that finishes after destroy() has started', async () => {
    const events: string[] = []
    const Pool = singletonHooks(events)
    const early = Promise.withResolvers<void>()
    const late = Promise.withResolvers<void>()

    @Injectable({ scope: 'request' })
    class Early {
      async onDestroy() {
        await early.promise
        events.push('Early.onDestroy')
      }
    }

    @Injectable({ scope: 'request' })
    class Late {
      async onDestroy() {
        await late.promise
        events.push('Late.onDestroy')
      }
    }

    @Controller('/')
    class HooksController {
      @Get('early')
      early(ctx: RequestContext) {
        ctx.resolve(Early)
        return { ok: true }
      }

      @Get('late')
      late(ctx: RequestContext) {
        ctx.resolve(Late)
        return { ok: true }
      }
    }

    @Module({ controllers: [HooksController], providers: [Pool, Early, Late] })
    class AppModule {}

    const app = new Miia({ logger: false }).register(AppModule)
    await app.init()
    expect((await get(app, '/early')).status).toBe(200)
    const destroyed = app.destroy().then(() => {
      events.push('destroy() returned')
    })
    await settle()
    // No server to close, e.g. serverless app.fetch: a request still comes in while destroy() waits for Early
    expect((await get(app, '/late')).status).toBe(200)
    await settle()
    early.resolve()
    await Promise.race([destroyed, delay(50)])
    expect(events).toEqual(['Early.onDestroy', 'Pool.onShutdown', 'Pool.onDestroy', 'destroy() returned'])

    late.resolve()
    await destroyed
    await settle()
    expect(events.at(-1)).toBe('Late.onDestroy')
  })

  it('regression: a sync onDestroy() has run when destroy() follows the request at once', async () => {
    const events: string[] = []
    const Pool = singletonHooks(events)

    @Injectable({ scope: 'request' })
    class Session {
      onDestroy() {
        events.push('Session.onDestroy')
      }
    }

    @Controller('/')
    class SessionController {
      @Get('session')
      read(ctx: RequestContext) {
        ctx.resolve(Session)
        return { ok: true }
      }
    }

    @Module({ controllers: [SessionController], providers: [Pool, Session] })
    class AppModule {}

    const app = new Miia({ logger: false }).register(AppModule)
    await app.init()
    expect((await app.fetch(new Request('http://localhost/session'))).status).toBe(200)
    await app.destroy()
    expect(events).toEqual(['Session.onDestroy', 'Pool.onShutdown', 'Pool.onDestroy'])
  })

  it('regression: logs a request hook that rejects under RequestScope, destroy() resolves', async () => {
    const events: string[] = []
    const logged: [string, string | undefined][] = []
    const Pool = singletonHooks(events)

    @Injectable({ scope: 'request' })
    class First {
      onDestroy() {
        events.push('First.onDestroy')
      }
    }

    @Injectable({ scope: 'request' })
    class Rejects {
      async onDestroy() {
        throw new Error('cannot close')
      }
    }

    @Controller('/')
    class RejectsController {
      @Get('rejects')
      read(ctx: RequestContext) {
        ctx.resolve(First)
        ctx.resolve(Rejects)
        return { ok: true }
      }
    }

    @Module({ controllers: [RejectsController], providers: [Pool, First, Rejects] })
    class AppModule {}

    const logger = {
      log() {},
      error(message: string, _trace?: string, context?: string) {
        logged.push([message, context])
      },
      warn() {},
    }
    const app = new Miia({ logger }).register(AppModule)
    expect((await get(app, '/rejects')).status).toBe(200)
    await app.destroy()
    expect(events).toEqual(['First.onDestroy', 'Pool.onShutdown', 'Pool.onDestroy'])
    expect(logged).toEqual([['Rejects.onDestroy() failed at the end of a request', 'RequestScope']])
  })
})
