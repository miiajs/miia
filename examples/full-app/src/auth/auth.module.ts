import { Module } from '@miiajs/core'
import { AuthController } from './auth.controller.js'
import { AuthService } from './auth.service.js'
import { JwtAuth, LocalAuth } from './providers/index.js'

@Module({
  controllers: [AuthController],
  providers: [AuthService, LocalAuth, JwtAuth],
})
export class AuthModule {}
