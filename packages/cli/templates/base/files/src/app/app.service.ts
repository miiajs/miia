import { Injectable } from '@miiajs/core'

@Injectable()
export class AppService {
  getHello(): string {
    return 'Hello, Miia!'
  }
}
