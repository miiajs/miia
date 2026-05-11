import { Module } from '@miiajs/core'
import { ItemsModule } from './items/items.module.js'

@Module({
  imports: [ItemsModule],
})
export class AppModule {}
