import type { Feature } from '../types.js'

export const serveStaticFeature: Feature = {
  id: 'serve-static',
  label: 'Serve Static',
  hint: 'static file serving',
  group: 'extras',
  packages: {
    '@miiajs/serve-static': '^0.1.0',
  },
  mainSetup: {
    imports: [`import { serveStatic } from '@miiajs/serve-static'`],
    code: [`serveStatic(app, '/static', './public')`],
  },
  files: () => ({
    'public/.gitkeep': '',
  }),
}
