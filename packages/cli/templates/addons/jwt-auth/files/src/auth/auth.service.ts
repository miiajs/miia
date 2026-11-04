import { ConflictException, Injectable, inject } from '@miiajs/core'
import { JwtService } from '@miiajs/jwt'
import { UsersService } from '../users/users.service.js'
import type { User } from '../users/users.types.js'
import { PasswordService } from './password.service.js'
import type { RegisterInput } from './schemas/register.schema.js'

@Injectable()
export class AuthService {
  private readonly usersService = inject(UsersService)
  private readonly jwtService = inject(JwtService)
  private readonly passwordService = inject(PasswordService)

  async register({ email, password }: RegisterInput) {
    if (await this.usersService.findByEmail(email)) {
      throw new ConflictException('Email is already registered')
    }
    const user = await this.usersService.create({ email, passwordHash: await this.passwordService.hash(password) })
    return this.issueTokenFor(user)
  }

  async issueTokenFor(user: User) {
    return { accessToken: await this.jwtService.sign({ sub: user.id, email: user.email }) }
  }
}
