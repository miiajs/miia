import { GUARD_FACTORY, HttpException, UnauthorizedException, inject } from '@miiajs/core'
import type { CanActivate, Constructor, Guard, RequestContext } from '@miiajs/core'
import type { AuthProvider } from './provider.js'

/**
 * Build a guard that authenticates the request using one or more
 * `AuthProvider` classes. Providers are tried in order - the first one that
 * resolves without throwing wins, and its result is assigned to `ctx.user`.
 *
 * **OR semantics:** if a provider throws an `HttpException`, the guard moves
 * on to the next provider. Any other error (TypeError, ReferenceError, etc.)
 * is treated as a programming bug and rethrown immediately so it is not
 * silently masked by a later provider.
 *
 * If every provider throws an `HttpException`, the last error is rethrown.
 *
 * For AND semantics, stack guards instead: `@UseGuard(AuthGuard(JwtAuth), Roles('admin'))`.
 */
export function AuthGuard(first: Constructor<AuthProvider>, ...rest: Constructor<AuthProvider>[]): Guard {
  const providerCtors = [first, ...rest]

  class AuthenticationGuard implements CanActivate {
    // Eagerly resolve providers in the field initializer - this runs during
    // guard construction, which the framework performs inside an active
    // container context. `canActivate()` runs later during request handling
    // and would not have access to the active container.
    private providers = providerCtors.map((P) => inject(P))

    async canActivate(ctx: RequestContext & { user?: unknown }): Promise<boolean> {
      let lastError: HttpException | undefined
      for (const provider of this.providers) {
        try {
          ctx.user = await provider.authenticate(ctx)
          return true
        } catch (error) {
          if (error instanceof HttpException) {
            lastError = error
            continue
          }
          throw error
        }
      }
      throw lastError ?? new UnauthorizedException('Unauthorized')
    }
  }

  ;(AuthenticationGuard as any)[GUARD_FACTORY] = AuthGuard
  return AuthenticationGuard
}
