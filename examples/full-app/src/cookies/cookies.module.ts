import { Module } from '@miiajs/core'
import { CookiesController } from './cookies.controller.js'

@Module({
  controllers: [CookiesController],
})
export class CookiesModule {}
