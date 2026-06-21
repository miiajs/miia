import { Module } from '@miiajs/core'
import { LimitsClassController } from './limits-class.controller.js'
import { LimitsController } from './limits.controller.js'

@Module({
  controllers: [LimitsController, LimitsClassController],
})
export class LimitsModule {}
