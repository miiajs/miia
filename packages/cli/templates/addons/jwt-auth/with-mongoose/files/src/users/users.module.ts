import { Module } from '@miiajs/core'
import { MongooseModule } from '@miiajs/mongoose'
import { UsersModel } from './users.model.js'
import { UsersService } from './users.service.js'

@Module({
  imports: [MongooseModule.register([UsersModel])],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
