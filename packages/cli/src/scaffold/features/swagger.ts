import type { Feature } from '../types.js'

export const swaggerFeature: Feature = {
  id: 'swagger',
  label: 'Swagger',
  hint: 'OpenAPI 3.1 + Swagger UI',
  group: 'core',
  packages: {
    '@miiajs/swagger': '^0.1.0',
  },
  moduleImport: {
    statement: `import { SwaggerModule } from '@miiajs/swagger'`,
    entries: [
      `SwaggerModule.configure({
      title: 'My App',
      version: '1.0.0',
      description: 'API documentation',
    })`,
    ],
  },
}
