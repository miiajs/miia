import type { AuthProvider } from '@miiajs/auth'
import { Injectable, inject, type RequestContext, UnauthorizedException } from '@miiajs/core'
import { UsersService } from '../../users/users.service.js'
import { LoginSchema } from '../auth.schemas.js'
import { verifyPassword } from '../password.js'

@Injectable()
export class LocalAuth implements AuthProvider {
  private readonly usersService = inject(UsersService)

  async authenticate(ctx: RequestContext) {
    const parsed = LoginSchema.safeParse(await ctx.json().catch(() => null))
    if (!parsed.success) {
      throw new UnauthorizedException('Invalid credentials payload')
    }
    const { email, password } = parsed.data

    const found = await this.usersService.findByEmailForAuth(email)
    if (!found || !(await verifyPassword(password, found.passwordHash))) {
      throw new UnauthorizedException('Invalid credentials')
    }
    return { id: found.id, email: found.email }
  }
}
