import { Module } from '@miiajs/core'
import { MongooseModule } from '@miiajs/mongoose'
import { UserController } from './user.controller'
import { UserService } from './user.service'
import { User } from './user.model'

@Module({
  imports: [MongooseModule.register([User])],
  controllers: [UserController],
  providers: [UserService],
})
export class UserModule {}
