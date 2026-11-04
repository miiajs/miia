import type { AuthProvider } from '@miiajs/auth'
import { Injectable, inject, type RequestContext, UnauthorizedException } from '@miiajs/core'
import { UsersService } from '../../users/users.service.js'
import { PasswordService } from '../password.service.js'
import { LoginSchema } from '../schemas/login.schema.js'

@Injectable()
export class LocalAuth implements AuthProvider {
  private readonly usersService = inject(UsersService)
  private readonly passwordService = inject(PasswordService)

  async authenticate(ctx: RequestContext) {
    const parsed = LoginSchema.safeParse(await ctx.json().catch(() => null))
    if (!parsed.success) {
      throw new UnauthorizedException('Invalid credentials payload')
    }
    const { email, password } = parsed.data

    const found = await this.usersService.findByEmailForAuth(email)
    if (!found || !(await this.passwordService.verify(password, found.passwordHash))) {
      throw new UnauthorizedException('Invalid credentials')
    }
    return { id: found.id, email: found.email }
  }
}
