import { Module } from '@miiajs/core'
import { AuthController } from './auth.controller.js'
import { AuthService } from './auth.service.js'
import { JwtAuth, JwtCookieAuth, LocalAuth } from './providers/index.js'

@Module({
  controllers: [AuthController],
  providers: [AuthService, LocalAuth, JwtAuth, JwtCookieAuth],
})
export class AuthModule {}
