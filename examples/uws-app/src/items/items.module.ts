import { Module } from '@miiajs/core'
import { ItemsController } from './items.controller.js'
import { ItemsService } from './items.service.js'

@Module({
  controllers: [ItemsController],
  providers: [ItemsService],
})
export class ItemsModule {}
