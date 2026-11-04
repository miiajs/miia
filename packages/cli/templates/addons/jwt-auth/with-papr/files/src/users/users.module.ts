import { Module } from '@miiajs/core'
import { PaprModule } from '@miiajs/papr'
import { UsersModel } from './users.model.js'
import { UsersService } from './users.service.js'

@Module({
  imports: [PaprModule.register([UsersModel])],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
