import { Module } from '@miiajs/core'
import { __Name__Controller } from './__file__.controller.js'
import { __Name__Service } from './__file__.service.js'

@Module({
  controllers: [__Name__Controller],
  providers: [__Name__Service],
  exports: [__Name__Service],
})
export class __Name__Module {}
