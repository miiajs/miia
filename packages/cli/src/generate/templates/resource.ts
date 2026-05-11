import type { GenerateContext } from '../types.js'
import { lowerFirst } from '../../utils/naming.js'

export function resourceModuleTemplate(ctx: GenerateContext): string {
  return `import { Module } from '@miiajs/core'
import { ${ctx.className}Controller } from './${ctx.fileName}.controller.js'
import { ${ctx.className}Service } from './${ctx.fileName}.service.js'

@Module({
  controllers: [${ctx.className}Controller],
  providers: [${ctx.className}Service],
})
export class ${ctx.className}Module {}
`
}

export function resourceControllerTemplate(ctx: GenerateContext): string {
  const serviceVar = `${lowerFirst(ctx.className)}Service`
  return `import { Controller, Delete, Get, Patch, Post, inject } from '@miiajs/core'
import type { RequestContext } from '@miiajs/core'
import { ${ctx.className}Service } from './${ctx.fileName}.service.js'

@Controller('/${ctx.fileName}')
export class ${ctx.className}Controller {
  private ${serviceVar} = inject(${ctx.className}Service)

  @Post()
  create() {
    return this.${serviceVar}.create()
  }

  @Get()
  findAll() {
    return this.${serviceVar}.findAll()
  }

  @Get(':id')
  findOne(ctx: RequestContext) {
    return this.${serviceVar}.findOne(ctx.params.id)
  }

  @Patch(':id')
  update(ctx: RequestContext) {
    return this.${serviceVar}.update(ctx.params.id)
  }

  @Delete(':id')
  remove(ctx: RequestContext) {
    return this.${serviceVar}.remove(ctx.params.id)
  }
}
`
}

export function resourceServiceTemplate(ctx: GenerateContext): string {
  return `import { Injectable } from '@miiajs/core'

@Injectable()
export class ${ctx.className}Service {
  create() {
    return 'This action adds a new ${ctx.fileName}'
  }

  findAll() {
    return []
  }

  findOne(id: string) {
    return \`This action returns ${ctx.fileName} #\${id}\`
  }

  update(id: string) {
    return \`This action updates ${ctx.fileName} #\${id}\`
  }

  remove(id: string) {
    return \`This action removes ${ctx.fileName} #\${id}\`
  }
}
`
}
