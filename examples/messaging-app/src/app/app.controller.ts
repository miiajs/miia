import { Controller, Get, inject } from '@miiajs/core'
import { AppService } from './app.service.js'

@Controller()
export class AppController {
  private appService = inject(AppService)

  @Get('/')
  hello() {
    return { message: this.appService.getHello() }
  }
}
