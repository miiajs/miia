import { type AuthProvider, fromHeader } from '@miiajs/auth'
import { Injectable, inject, type RequestContext, UnauthorizedException } from '@miiajs/core'
import { JwtService } from '@miiajs/jwt'
import { UsersService } from '../../users/users.service.js'

@Injectable()
export class JwtAuth implements AuthProvider {
  private readonly jwtService = inject(JwtService)
  private readonly usersService = inject(UsersService)
  private readonly extract = fromHeader()

  async authenticate(ctx: RequestContext) {
    const token = this.extract(ctx)
    if (!token) {
      throw new UnauthorizedException('Missing token')
    }
    const payload = await this.jwtService.verify<{ sub: string }>(token).catch(() => {
      throw new UnauthorizedException('Invalid token')
    })

    const user = await this.usersService.findById(payload.sub)
    if (!user) throw new UnauthorizedException('User not found')
    return user
  }
}
