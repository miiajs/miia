import corePkg from '../../packages/core/package.json' with { type: 'json' }
import { miiaDark, miiaLight } from './shiki-themes'

export default defineNuxtConfig({
  modules: [
    '@nuxt/eslint',
    '@nuxt/fonts',
    '@nuxt/ui',
    '@nuxt/content',
    '@nuxtjs/seo'
  ],

  app: {
    head: {
      link: [
        // Icons
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/favicon-32.png' },
        { rel: 'icon', type: 'image/png', sizes: '16x16', href: '/favicon-16.png' },
        { rel: 'icon', type: 'image/png', sizes: '192x192', href: '/favicon-192.png' },
        { rel: 'icon', type: 'image/png', sizes: '512x512', href: '/favicon-512.png' },
        { rel: 'apple-touch-icon', sizes: '180x180', href: '/apple-touch-icon.png' },
        { rel: 'shortcut icon', href: '/favicon.ico' },
        // Blog feed autodiscovery
        { rel: 'alternate', type: 'application/rss+xml', title: 'MiiaJS Blog', href: '/blog/rss.xml' }
      ],
      script: process.env.NODE_ENV === 'production'
        ? [
            {
              // Public Cloudflare Web Analytics beacon token - safe to commit
              'src': 'https://static.cloudflareinsights.com/beacon.min.js',
              'defer': true,
              'data-cf-beacon': '{"token": "21ec522796be4410b761746f0eb3e107"}'
            }
          ]
        : []
    }
  },

  css: ['~/assets/css/main.css'],

  site: {
    url: 'https://miiajs.com',
    name: 'MiiaJS',
    description: 'Decorator-driven HTTP framework for TypeScript. Build structured APIs with DI, middleware, and Web Standards - deploy to Bun, Deno, Node.js, or any edge platform.',
    defaultLocale: 'en'
  },

  content: {
    build: {
      markdown: {
        // Content passes this to @nuxtjs/mdc too, so <MDC> renders with the same themes.
        // `light` replaces the third theme Nuxt UI sets by default
        highlight: {
          theme: { default: miiaLight, light: miiaLight, dark: miiaDark }
        }
      }
    },
    experimental: {
      sqliteConnector: 'native'
    }
  },

  mdc: {
    highlight: {
      noApiRoute: false
    }
  },

  runtimeConfig: {
    public: {
      miiaVersion: corePkg.version
    }
  },

  routeRules: {
    '/docs': { redirect: '/docs/getting-started', prerender: false },
    '/docs/core-concepts/static-files': { redirect: '/docs/packages/serve-static' }
  },

  compatibilityDate: '2024-07-11',

  nitro: {
    prerender: {
      routes: [
        '/',
        '/robots.txt',
        '/sitemap.xml',
        '/blog/rss.xml'
      ],
      crawlLinks: true,
      ignore: [
        '/favicon.svg',
        '/favicon.ico',
        '/favicon-16.png',
        '/favicon-32.png',
        '/favicon-192.png',
        '/favicon-512.png',
        '/apple-touch-icon.png',
        '/og-image.png'
      ]
    }
  },

  vite: {
    // Lightning CSS (Tailwind v4) uses cssTarget for autoprefix decisions.
    // Vite defaults include safari14 which forces `-webkit-backdrop-filter`
    // and drops the unprefixed `backdrop-filter` from prod - Firefox then
    // renders no blur (it doesn't recognize the -webkit- prefix). Bump to
    // browsers that support both forms so both declarations survive.
    build: {
      cssTarget: ['chrome110', 'edge110', 'firefox115', 'safari16']
    }
  },

  aiReady: false,

  eslint: {
    config: {
      stylistic: {
        commaDangle: 'never',
        braceStyle: '1tbs'
      }
    }
  },

  // `global: true` also hands the families to the OG image template: nuxt-og-image takes its fonts from @nuxt/fonts
  fonts: {
    families: [
      { name: 'IBM Plex Sans', weights: [400, 500, 600], global: true },
      { name: 'IBM Plex Mono', weights: [400, 500], global: true }
    ]
  },

  // X takes the image from og:image; twitter:card comes from useSiteHead()
  ogImage: {
    includeTwitter: false
  },

  sitemap: {
    xsl: false
  },

  skewProtection: false
})
