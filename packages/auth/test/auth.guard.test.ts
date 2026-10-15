import { describe, expect, it } from 'bun:test'
import type { CanActivate, Guard, RequestContext } from '@miiajs/core'
import { ForbiddenException, GUARD_RESPONSES, Injectable, Miia, UnauthorizedException } from '@miiajs/core'
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

function buildGuard(GuardCtor: Guard, ...providers: Array<new () => AuthProvider>): CanActivate {
  return new Miia({ logger: false }).provide(...providers, GuardCtor).get(GuardCtor)
}

describe('AuthGuard', () => {
  it('single provider success → sets ctx.user, returns true', async () => {
    const guard = buildGuard(AuthGuard(SuccessProvider), SuccessProvider)
    const ctx = makeCtx()

    const result = await guard.canActivate(ctx)

    expect(result).toBe(true)
    expect(ctx.user).toEqual({ id: 1, name: 'alice' })
  })

  it('single provider throws UnauthorizedException → guard rethrows it', async () => {
    const guard = buildGuard(AuthGuard(UnauthorizedProvider), UnauthorizedProvider)
    const ctx = makeCtx()

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException)
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

    const guard = buildGuard(AuthGuard(SuccessProvider, TrackingProvider), SuccessProvider, TrackingProvider)
    const ctx = makeCtx()

    await guard.canActivate(ctx)

    expect(ctx.user).toEqual({ id: 1, name: 'alice' })
    expect(secondCalled).toBe(false)
  })

  it('multi-provider: first throws HttpException, second succeeds → ctx.user from second', async () => {
    const guard = buildGuard(
      AuthGuard(UnauthorizedProvider, OtherSuccessProvider),
      UnauthorizedProvider,
      OtherSuccessProvider,
    )
    const ctx = makeCtx()

    await guard.canActivate(ctx)

    expect(ctx.user).toEqual({ id: 2, name: 'bob' })
  })

  it('multi-provider: all throw HttpException → last error rethrown', async () => {
    const guard = buildGuard(
      AuthGuard(UnauthorizedProvider, ForbiddenProvider),
      UnauthorizedProvider,
      ForbiddenProvider,
    )
    const ctx = makeCtx()

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('canActivate works after the active container context is gone (request-time invocation)', async () => {
    // Repro for the production bug: guard is constructed inside container context
    // (at route registration), but canActivate runs later during request handling
    // when there is no active container. inject() must NOT be called in canActivate.
    // Construct guard inside container context (this is what the framework does).
    const guard = buildGuard(AuthGuard(SuccessProvider), SuccessProvider)

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

    const guard = buildGuard(AuthGuard(BuggyProvider, ShouldNotBeCalled), BuggyProvider, ShouldNotBeCalled)
    const ctx = makeCtx()

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(TypeError)

    expect(secondCalled).toBe(false)
  })

  it('declares 401 via GUARD_RESPONSES', () => {
    const GuardCtor = AuthGuard(SuccessProvider)

    expect((GuardCtor as any)[GUARD_RESPONSES]).toEqual([401])
  })
})
