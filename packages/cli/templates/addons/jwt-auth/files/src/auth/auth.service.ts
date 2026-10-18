import { ConflictException, Injectable, inject } from '@miiajs/core'
import { JwtService } from '@miiajs/jwt'
import { type User, UsersService } from '../users/users.service.js'
import type { RegisterInput } from './auth.schemas.js'
import { hashPassword } from './password.js'

@Injectable()
export class AuthService {
  private readonly usersService = inject(UsersService)
  private readonly jwtService = inject(JwtService)

  async register({ email, password }: RegisterInput) {
    if (await this.usersService.findByEmail(email)) {
      throw new ConflictException('Email is already registered')
    }
    const user = await this.usersService.create({ email, passwordHash: await hashPassword(password) })
    return this.issueTokenFor(user)
  }

  async issueTokenFor(user: User) {
    return { accessToken: await this.jwtService.sign({ sub: String(user.id), email: user.email }) }
  }
}
