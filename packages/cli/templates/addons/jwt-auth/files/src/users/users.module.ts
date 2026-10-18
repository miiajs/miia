import { Module } from '@miiajs/core'
import { UsersService } from './users.service.js'

@Module({
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
