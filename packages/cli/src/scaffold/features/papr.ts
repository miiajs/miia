import type { Feature } from '../types.js'

export const paprFeature: Feature = {
  id: 'papr',
  label: 'Papr + MongoDB',
  hint: '',
  group: 'database',
  requires: ['config'],
  packages: {
    '@miiajs/papr': '^0.1.0',
    papr: '^17.0.0',
    mongodb: '^6.13.0',
  },
  moduleImport: {
    statement: `import { PaprModule } from '@miiajs/papr'`,
    entries: [
      `PaprModule.configure((resolve) => ({
      connection: { url: resolve(ConfigService).getOrThrow('MONGODB_URL') },
    }))`,
    ],
  },
  envVars: {
    MONGODB_URL: 'mongodb://localhost:27017/myapp',
  },
}
