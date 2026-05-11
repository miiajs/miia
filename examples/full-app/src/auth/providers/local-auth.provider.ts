// src/auth/providers/local-auth.provider.ts
import { Injectable, inject, UnauthorizedException } from '@miiajs/core'
import type { RequestContext } from '@miiajs/core'
import type { AuthProvider } from '@miiajs/auth'
import { verify as verifyHash } from '@node-rs/argon2'
import { UsersService } from '../../users/users.service.js'
import { LoginSchema } from '../schemas/login.schema.js'

@Injectable()
export class LocalAuth implements AuthProvider {
  private users = inject(UsersService)

  async authenticate(ctx: RequestContext) {
    const raw = await ctx.json().catch(() => null)
    const parsed = LoginSchema.safeParse(raw)
    if (!parsed.success) {
      throw new UnauthorizedException('Invalid credentials payload')
    }
    const { email, password } = parsed.data

    const found = await this.users.findByEmailForAuth(email)
    if (!found) throw new UnauthorizedException('Invalid credentials')

    const ok = await verifyHash(found.passwordHash, password)
    if (!ok) throw new UnauthorizedException('Invalid credentials')

    const { passwordHash: _, ...user } = found
    return user
  }
}
