import {
  applyDecorators,
  type CanActivate,
  ForbiddenException,
  type Guard,
  GUARD_FACTORY,
  type RequestContext,
  UnauthorizedException,
  UseGuard,
} from '@miiajs/core'
import type { User } from '../../users/users.schema.js'

type Role = User['role']

/**
 * Internal guard factory. Each call produces a dedicated guard class with
 * the allowed roles captured in closure. Tagged with `GUARD_FACTORY = Roles`
 * so `@SkipGuard(Roles)` disables every role check on a route regardless of
 * which specific `Roles(...)` instance was applied.
 */
function rolesGuard(...roles: Role[]): Guard {
  class RolesGuard implements CanActivate {
    canActivate(ctx: RequestContext): boolean {
      if (!ctx.user) throw new UnauthorizedException()
      if (!roles.includes(ctx.user.role)) {
        throw new ForbiddenException(`Requires role: ${roles.join(', ')}`)
      }
      return true
    }
  }
  ;(RolesGuard as any)[GUARD_FACTORY] = Roles
  return RolesGuard
}

/**
 * `@Roles('admin')` - restricts a route to users with one of the given roles.
 * Must be stacked under an auth decorator/guard that populates `ctx.user`.
 *
 * Composed via `applyDecorators` so the usage site stays a single decorator.
 */
export function Roles(...roles: Role[]) {
  return applyDecorators(UseGuard(rolesGuard(...roles)))
}
