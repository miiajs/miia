import { ConflictException, inject, Injectable } from '@miiajs/core'
import { hash } from '@node-rs/argon2'
import type { RegisterInput } from './schemas/register.schema.js'
import { UsersService } from '../users/users.service.js'
import { JwtService } from '@miiajs/jwt'

@Injectable()
export class AuthService {
  private usersService = inject(UsersService)
  private jwtService = inject(JwtService)

  public async register(input: RegisterInput) {
    const existsUser = await this.usersService.findByEmail(input.email)

    if (existsUser) {
      throw new ConflictException('User with this email already exists')
    }

    const passwordHash = await hash(input.password)

    const newUser = await this.usersService.create({
      email: input.email,
      passwordHash,
    })

    const accessToken = await this.issueTokenFor(newUser)
    return { accessToken }
  }

  public async issueTokenFor(user: { id: number; email: string }) {
    return this.jwtService.sign({ sub: user.id, email: user.email })
  }
}
