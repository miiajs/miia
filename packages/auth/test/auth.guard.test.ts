import { describe, expect, it } from 'bun:test'
import type { RequestContext } from '@miiajs/core'
import { Container, ForbiddenException, Injectable, runInContainerContext, UnauthorizedException } from '@miiajs/core'
import { AuthGuard } from '../src/index.js'
import type { AuthProvider } from '../src/provider.js'

// `user` is intentionally not declared on RequestContext by this package -
// applications augment it via `declare module '@miiajs/core'`. Tests need a
// local augmentation to read/write `ctx.user` in assertions. The root
// tsconfig.json excludes `examples/`, `apps/`, and `benchmarks/`, so this
// declaration cannot collide with downstream augmentations from those scopes.
declare module '@miiajs/core' {
  interface RequestContext {
    user?: unknown
  }
}

function makeCtx(): RequestContext {
  return {} as RequestContext
}

@Injectable()
class SuccessProvider implements AuthProvider {
  authenticate() {
    return { id: 1, name: 'alice' }
  }
}

@Injectable()
class OtherSuccessProvider implements AuthProvider {
  authenticate() {
    return { id: 2, name: 'bob' }
  }
}

@Injectable()
class UnauthorizedProvider implements AuthProvider {
  authenticate(): never {
    throw new UnauthorizedException('nope')
  }
}

@Injectable()
class ForbiddenProvider implements AuthProvider {
  authenticate(): never {
    throw new ForbiddenException('forbidden')
  }
}

@Injectable()
class BuggyProvider implements AuthProvider {
  authenticate(): never {
    throw new TypeError('programming bug')
  }
}

function setupContainer(...providers: Array<new () => AuthProvider>): Container {
  const container = new Container()
  for (const P of providers) container.register(P, () => new P(), 'singleton')
  return container
}

describe('AuthGuard', () => {
  it('single provider success → sets ctx.user, returns true', async () => {
    const container = setupContainer(SuccessProvider)
    const GuardCtor = AuthGuard(SuccessProvider)
    const ctx = makeCtx()

    const result = await runInContainerContext(container, async () => {
      const guard = new GuardCtor()
      return guard.canActivate(ctx)
    })

    expect(result).toBe(true)
    expect(ctx.user).toEqual({ id: 1, name: 'alice' })
  })

  it('single provider throws UnauthorizedException → guard rethrows it', async () => {
    const container = setupContainer(UnauthorizedProvider)
    const GuardCtor = AuthGuard(UnauthorizedProvider)
    const ctx = makeCtx()

    await runInContainerContext(container, async () => {
      const guard = new GuardCtor()
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException)
    })
  })

  it('multi-provider: first succeeds → second is never invoked', async () => {
    let secondCalled = false

    @Injectable()
    class TrackingProvider implements AuthProvider {
      authenticate() {
        secondCalled = true
        return { id: 99 }
      }
    }

    const container = setupContainer(SuccessProvider, TrackingProvider)
    const GuardCtor = AuthGuard(SuccessProvider, TrackingProvider)
    const ctx = makeCtx()

    await runInContainerContext(container, async () => {
      const guard = new GuardCtor()
      await guard.canActivate(ctx)
    })

    expect(ctx.user).toEqual({ id: 1, name: 'alice' })
    expect(secondCalled).toBe(false)
  })

  it('multi-provider: first throws HttpException, second succeeds → ctx.user from second', async () => {
    const container = setupContainer(UnauthorizedProvider, OtherSuccessProvider)
    const GuardCtor = AuthGuard(UnauthorizedProvider, OtherSuccessProvider)
    const ctx = makeCtx()

    await runInContainerContext(container, async () => {
      const guard = new GuardCtor()
      await guard.canActivate(ctx)
    })

    expect(ctx.user).toEqual({ id: 2, name: 'bob' })
  })

  it('multi-provider: all throw HttpException → last error rethrown', async () => {
    const container = setupContainer(UnauthorizedProvider, ForbiddenProvider)
    const GuardCtor = AuthGuard(UnauthorizedProvider, ForbiddenProvider)
    const ctx = makeCtx()

    await runInContainerContext(container, async () => {
      const guard = new GuardCtor()
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException)
    })
  })

  it('canActivate works after the active container context is gone (request-time invocation)', async () => {
    // Repro for the production bug: guard is constructed inside container context
    // (at route registration), but canActivate runs later during request handling
    // when there is no active container. inject() must NOT be called in canActivate.
    const container = setupContainer(SuccessProvider)
    const GuardCtor = AuthGuard(SuccessProvider)

    // Construct guard inside container context (this is what the framework does).
    const guard = runInContainerContext(container, () => new GuardCtor())

    // Now invoke canActivate OUTSIDE any container context.
    const ctx = makeCtx()
    const result = await guard.canActivate(ctx)

    expect(result).toBe(true)
    expect(ctx.user).toEqual({ id: 1, name: 'alice' })
  })

  it('multi-provider: first throws non-HttpException → rethrown immediately, second NOT called', async () => {
    let secondCalled = false
    @Injectable()
    class ShouldNotBeCalled implements AuthProvider {
      authenticate() {
        secondCalled = true
        return { id: 0 }
      }
    }

    const container = setupContainer(BuggyProvider, ShouldNotBeCalled)
    const GuardCtor = AuthGuard(BuggyProvider, ShouldNotBeCalled)
    const ctx = makeCtx()

    await runInContainerContext(container, async () => {
      const guard = new GuardCtor()
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(TypeError)
    })

    expect(secondCalled).toBe(false)
  })
})
