import { Module } from '@miiajs/core'
import { UsersController } from './users.controller.js'
import { UsersService } from './users.service.js'
import { UsersPolicy } from './users.policy.js'

@Module({
  controllers: [UsersController],
  providers: [UsersService, UsersPolicy],
})
export class UsersModule {}
