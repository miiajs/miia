import { type AuthProvider, fromHeader } from '@miiajs/auth'
import { inject, Injectable, type RequestContext, UnauthorizedException } from '@miiajs/core'
import { JwtService } from '@miiajs/jwt'
import { UsersService } from '../../users/users.service.js'

@Injectable()
export class JwtAuth implements AuthProvider {
  private jwtService = inject(JwtService)
  private usersService = inject(UsersService)
  private extract = fromHeader()

  async authenticate(ctx: RequestContext) {
    const token = this.extract(ctx)
    if (!token) {
      throw new UnauthorizedException('Missing token')
    }
    const payload = await this.jwtService.verify<{ email: string }>(token).catch(() => {
      throw new UnauthorizedException('Invalid token')
    })

    const user = await this.usersService.findByEmail(payload.email)
    if (!user) throw new UnauthorizedException('User not found')
    return user
  }
}
