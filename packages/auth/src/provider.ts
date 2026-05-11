import type { RequestContext } from '@miiajs/core'

/**
 * An authentication provider extracts credentials from a request and returns
 * the authenticated subject (user, API client, service account, ...) or
 * throws an `HttpException` on failure.
 *
 * Providers are regular `@Injectable()` classes - register them in your
 * module's `providers` array and pass the class token to `AuthGuard(...)`.
 *
 * ```ts
 * @Injectable()
 * export class JwtAuth implements AuthProvider {
 *   private jwt = inject(JwtService)
 *   private extract = fromHeader()
 *
 *   async authenticate(ctx: RequestContext) {
 *     const token = this.extract(ctx)
 *     if (!token) throw new UnauthorizedException('Missing token')
 *     return this.jwt.verify(token)
 *   }
 * }
 * ```
 */
export interface AuthProvider {
  authenticate(ctx: RequestContext): Promise<unknown> | unknown
}
