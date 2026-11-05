import { Controller, Get, Miia, Module } from '@miiajs/core'

@Controller('/hello')
class HelloController {
  @Get()
  hello() {
    return { hello: true }
  }
}

@Module({ controllers: [HelloController] })
class AppModule {}

const app = new Miia({ logger: false, shutdownHooks: false }).register(AppModule)
const res = await app.fetch(new Request('http://localhost/hello'))
console.log(res.status)
