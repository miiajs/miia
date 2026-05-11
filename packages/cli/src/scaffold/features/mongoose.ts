import type { Feature } from '../types.js'

export const mongooseFeature: Feature = {
  id: 'mongoose',
  label: 'Mongoose + MongoDB',
  hint: '',
  group: 'database',
  requires: ['config'],
  packages: {
    '@miiajs/mongoose': '^0.1.0',
    mongoose: '^8.14.0',
  },
  moduleImport: {
    statement: `import { MongooseModule } from '@miiajs/mongoose'`,
    entries: [
      `MongooseModule.configure((resolve) => ({
      uri: resolve(ConfigService).getOrThrow('MONGODB_URL'),
    }))`,
    ],
  },
  envVars: {
    MONGODB_URL: 'mongodb://localhost:27017/myapp',
  },
}
