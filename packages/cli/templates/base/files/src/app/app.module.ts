import { ConfigModule } from '@miiajs/config'
import { Module } from '@miiajs/core'
import { envSchema } from '../env.schema.js'
import { AppController } from './app.controller.js'
import { AppService } from './app.service.js'

@Module({
  imports: [ConfigModule.configure({ schema: envSchema }, { global: true })],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
