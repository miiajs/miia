import { Module } from '@miiajs/core'
import { PaprModule } from '@miiajs/papr'
import { UserController } from './user.controller'
import { UserService } from './user.service'
import { User } from './user.schema'

@Module({
  imports: [PaprModule.register([User])],
  controllers: [UserController],
  providers: [UserService],
})
export class UserModule {}
