import { Module } from '@miiajs/core'
import { UsersModule } from '../users/users.module.js'
import { AuthController } from './auth.controller.js'
import { AuthService } from './auth.service.js'
import { JwtAuth, JwtCookieAuth, LocalAuth } from './providers/index.js'

// Global, so every controller can use AuthGuard(JwtAuth) without importing AuthModule
@Module({
  global: true,
  imports: [UsersModule],
  controllers: [AuthController],
  providers: [AuthService, LocalAuth, JwtAuth, JwtCookieAuth],
  exports: [JwtAuth],
})
export class AuthModule {}
