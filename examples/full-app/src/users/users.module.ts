import { Module } from '@miiajs/core'
import { ConfigModule } from '@miiajs/config'
import { UsersController } from './users.controller.js'
import { UsersService } from './users.service.js'
import { UsersPolicy } from './users.policy.js'
import { usersConfig } from './users.config.js'

@Module({
  imports: [ConfigModule.register(usersConfig)],
  controllers: [UsersController],
  providers: [UsersService, UsersPolicy],
  exports: [UsersService],
})
export class UsersModule {}
