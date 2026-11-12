<script setup lang="ts">
const { miiaVersion } = useRuntimeConfig().public
const year = new Date().getFullYear()

const github = { label: 'GitHub', to: 'https://github.com/miiajs/miia', target: '_blank' }
const x = { label: 'X', to: 'https://x.com/miiaframework', target: '_blank' }
const linkedin = { label: 'LinkedIn', to: 'https://www.linkedin.com/company/miiajs/', target: '_blank' }

const columns: { label: string, links: { label: string, to: string, target?: string }[] }[] = [
  {
    label: 'documentation',
    links: [
      { label: 'Getting Started', to: '/docs/getting-started' },
      { label: 'Core Concepts', to: '/docs/core-concepts' },
      { label: 'Packages', to: '/docs/packages' },
      { label: 'Roadmap', to: '/docs/roadmap' }
    ]
  },
  {
    label: 'project',
    links: [
      { label: 'Benchmarks', to: '/benchmarks' },
      { label: 'Blog', to: '/blog' },
      { label: 'MIT License', to: 'https://github.com/miiajs/miia/blob/main/LICENSE', target: '_blank' }
    ]
  },
  {
    label: 'community',
    links: [
      github,
      { label: 'Issues', to: 'https://github.com/miiajs/miia/issues', target: '_blank' },
      x,
      linkedin
    ]
  }
]
</script>

<template>
  <footer class="border-t border-default bg-accented">
    <UContainer class="flex flex-col gap-7 pt-10 pb-7 lg:gap-10 lg:pt-14 lg:pb-5">
      <div class="flex flex-col gap-7 lg:flex-row lg:flex-wrap lg:justify-between lg:gap-x-14 lg:gap-y-10">
        <div class="flex flex-col gap-3 lg:max-w-[340px] lg:flex-[1_1_280px] lg:gap-3.5">
          <NuxtLink
            to="/"
            aria-label="MiiaJS home"
            class="flex min-h-11 items-center self-start text-[19px] lg:text-xl"
          >
            <AppLogo />
          </NuxtLink>
          <p class="text-ui text-toned">
            Structured TypeScript APIs on Web Standards. Open source, MIT licensed.
          </p>
        </div>

        <nav
          aria-label="Footer"
          class="grid grid-cols-2 gap-x-4 gap-y-6 lg:flex lg:flex-[2_1_520px] lg:flex-wrap lg:gap-x-14 lg:gap-y-8"
        >
          <div
            v-for="column in columns"
            :key="column.label"
            class="flex flex-col lg:flex-[1_1_140px] lg:gap-1"
          >
            <p class="mb-1 font-mono text-caption text-muted lg:mb-2">
              {{ column.label }}
            </p>
            <NuxtLink
              v-for="link in column.links"
              :key="link.label"
              :to="link.to"
              :target="link.target"
              class="py-2.5 text-ui text-highlighted hover:text-toned lg:py-1.5"
            >
              {{ link.label }}
            </NuxtLink>
          </div>
        </nav>
      </div>

      <div class="flex flex-wrap justify-between gap-3 border-t border-default pt-7 font-mono text-meta text-muted lg:pt-5">
        <span>&copy; 2026{{ year > 2026 ? `-${year}` : '' }} MiiaJS</span>
        <NuxtLink
          to="https://github.com/miiajs/miia/tags"
          target="_blank"
          class="hover:text-highlighted"
        >
          v{{ miiaVersion }}
        </NuxtLink>
      </div>
    </UContainer>
  </footer>
</template>
