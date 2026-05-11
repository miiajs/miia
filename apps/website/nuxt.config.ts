// https://nuxt.com/docs/api/configuration/nuxt-config

export default defineNuxtConfig({
  modules: [
    '@nuxt/eslint',
    '@nuxt/image',
    '@nuxt/ui',
    '@nuxt/content',
    '@nuxtjs/seo'
  ],

  site: {
    url: 'https://miiajs.com',
    name: 'MiiaJS',
    description: 'Decorator-driven HTTP framework for TypeScript. Build structured APIs with DI, middleware, and Web Standards - deploy to Bun, Deno, Node.js, or any edge platform.',
    defaultLocale: 'en'
  },

  devtools: {
    enabled: true
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
        // Fonts: non-blocking preconnect + stylesheet
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        {
          rel: 'stylesheet',
          href: 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap'
        }
      ],
      script: process.env.NODE_ENV === 'production'
        ? [
            {
              // Public Cloudflare Web Analytics beacon token - safe to commit
              src: 'https://static.cloudflareinsights.com/beacon.min.js',
              defer: true,
              'data-cf-beacon': '{"token": "21ec522796be4410b761746f0eb3e107"}'
            }
          ]
        : []
    }
  },

  css: ['~/assets/css/main.css'],

  mdc: {
    highlight: {
      noApiRoute: false
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
        '/robots.txt'
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

  sitemap: {
    xsl: false
  },

  eslint: {
    config: {
      stylistic: {
        commaDangle: 'never',
        braceStyle: '1tbs'
      }
    }
  }
})
