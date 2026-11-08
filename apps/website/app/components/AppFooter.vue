<script setup lang="ts">
defineProps<{
  compact?: boolean
  // Phones get only the copyright and the version, as on the error page
  minimalOnPhones?: boolean
}>()

const { miiaVersion } = useRuntimeConfig().public
const year = new Date().getFullYear()

const github = { label: 'GitHub', to: 'https://github.com/miiajs/miia', target: '_blank' }
const x = { label: 'X', to: 'https://x.com/miiaframework', target: '_blank' }
const linkedin = { label: 'LinkedIn', to: 'https://www.linkedin.com/company/miiajs/', target: '_blank' }
const social = [github, x, linkedin]

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
  <footer
    v-if="compact"
    class="border-t border-default bg-accented"
  >
    <div class="mx-auto flex max-w-(--ui-container) flex-wrap items-center justify-between gap-x-8 gap-y-3 px-4 py-[22px] font-mono text-[13px] text-muted sm:px-6 lg:px-8">
      <span>&copy; 2026{{ year > 2026 ? `-${year}` : '' }} MiiaJS · MIT License</span>
      <div class="flex flex-wrap gap-x-5 gap-y-1">
        <NuxtLink
          v-for="link in social"
          :key="link.label"
          :to="link.to"
          :target="link.target"
          class="py-1.5 text-toned hover:text-highlighted"
        >
          {{ link.label }}
        </NuxtLink>
        <NuxtLink
          to="https://github.com/miiajs/miia/tags"
          target="_blank"
          class="py-1.5 hover:text-highlighted"
        >
          v{{ miiaVersion }}
        </NuxtLink>
      </div>
    </div>
  </footer>

  <footer
    v-else
    class="border-t border-default bg-accented"
  >
    <div
      class="mx-auto flex max-w-(--ui-container) flex-col gap-7 px-4 sm:px-6 lg:gap-10 lg:px-8 lg:pt-14 lg:pb-8"
      :class="minimalOnPhones ? 'py-7' : 'pt-10 pb-7'"
    >
      <div
        class="flex flex-col gap-7 lg:flex-row lg:flex-wrap lg:justify-between lg:gap-x-14 lg:gap-y-10"
        :class="minimalOnPhones && 'max-lg:hidden'"
      >
        <div class="flex flex-col gap-3 lg:max-w-[340px] lg:flex-[1_1_280px] lg:gap-3.5">
          <NuxtLink
            to="/"
            aria-label="MiiaJS home"
            class="flex min-h-11 items-center self-start text-[19px] lg:text-xl"
          >
            <AppLogo />
          </NuxtLink>
          <p class="text-[15px] leading-relaxed text-toned">
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
            <p class="mb-1 font-mono text-xs text-muted lg:mb-2">
              {{ column.label }}
            </p>
            <NuxtLink
              v-for="link in column.links"
              :key="link.label"
              :to="link.to"
              :target="link.target"
              class="py-2.5 text-[15px] text-highlighted hover:text-toned lg:py-1.5"
            >
              {{ link.label }}
            </NuxtLink>
          </div>
        </nav>
      </div>

      <div
        class="flex flex-wrap justify-between gap-3 border-default font-mono text-xs text-muted lg:border-t lg:pt-5 lg:text-[13px]"
        :class="!minimalOnPhones && 'border-t pt-4'"
      >
        <span>&copy; 2026{{ year > 2026 ? `-${year}` : '' }} MiiaJS</span>
        <NuxtLink
          to="https://github.com/miiajs/miia/tags"
          target="_blank"
          class="hover:text-highlighted"
        >
          v{{ miiaVersion }}
        </NuxtLink>
      </div>
    </div>
  </footer>
</template>
