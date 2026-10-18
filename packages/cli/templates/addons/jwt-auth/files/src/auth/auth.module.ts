import { Module } from '@miiajs/core'
import { UsersModule } from '../users/users.module.js'
import { AuthController } from './auth.controller.js'
import { AuthService } from './auth.service.js'
import { JwtAuth } from './providers/jwt-auth.provider.js'
import { LocalAuth } from './providers/local-auth.provider.js'

// Global, so every controller can use AuthGuard(JwtAuth) without importing AuthModule
@Module({
  global: true,
  imports: [UsersModule],
  controllers: [AuthController],
  providers: [AuthService, LocalAuth, JwtAuth],
  exports: [JwtAuth],
})
export class AuthModule {}
