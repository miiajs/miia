import { Module } from '@miiajs/core'
import { UserController } from './user.controller'
import { UserService } from './user.service'

@Module({
  controllers: [UserController],
  providers: [UserService],
})
export class UserModule {}
