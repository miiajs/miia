import type { Feature } from '../types.js'

export const corsFeature: Feature = {
  id: 'cors',
  label: 'CORS',
  hint: 'cross-origin resource sharing',
  group: 'extras',
  packages: {},
  mainSetup: {
    imports: [`import { cors } from '@miiajs/core'`],
    code: [
      `app.use(
  cors({
    origin: '*',
    credentials: false,
  }),
)`,
    ],
  },
}
