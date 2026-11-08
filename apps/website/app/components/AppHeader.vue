<script setup lang="ts">
const route = useRoute()
const colorMode = useColorMode()
const { open: searchOpen } = useContentSearch()
const { miiaVersion } = useRuntimeConfig().public
const year = new Date().getFullYear()
const open = ref(false)

const mounted = ref(false)
onMounted(() => {
  mounted.value = true
})
const isDark = computed(() => mounted.value && colorMode.value === 'dark')

const items = computed(() => [
  { label: 'Home', to: '/', active: route.path === '/' },
  { label: 'Docs', to: '/docs/getting-started', active: route.path.startsWith('/docs') },
  { label: 'Benchmarks', to: '/benchmarks', active: route.path === '/benchmarks' },
  { label: 'Blog', to: '/blog', active: route.path.startsWith('/blog') }
])

const themes = [
  { label: 'Light', value: 'light', icon: 'i-lucide-sun' },
  { label: 'Dark', value: 'dark', icon: 'i-lucide-moon' },
  { label: 'System', value: 'system', icon: 'i-lucide-monitor' }
]
const preference = computed({
  get: () => colorMode.preference,
  set: (value: string) => {
    colorMode.preference = value
  }
})

const community = [
  { label: 'GitHub', to: 'https://github.com/miiajs/miia' },
  { label: 'X', to: 'https://x.com/miiaframework' },
  { label: 'LinkedIn', to: 'https://www.linkedin.com/company/miiajs/' }
]

const iconButton = 'size-11 justify-center rounded-md text-highlighted'

watch(searchOpen, (value) => {
  if (value) open.value = false
})
</script>

<template>
  <UHeader
    v-model:open="open"
    title="MiiaJS"
    :ui="{
      root: 'bg-default',
      left: 'lg:flex-none',
      center: 'gap-1',
      right: 'lg:flex-none gap-0.5 -me-2.5 lg:me-0',
      title: 'font-normal text-[19px] lg:text-[21px] min-h-11 items-center',
      header: 'px-4',
      body: 'flex-1 flex flex-col p-0 sm:p-0'
    }"
  >
    <template #title>
      <AppLogo />
    </template>

    <nav
      aria-label="Main"
      class="flex items-center gap-1 font-mono"
    >
      <NuxtLink
        v-for="item in items"
        :key="item.to"
        :to="item.to"
        :aria-current="item.active ? 'page' : undefined"
        class="p-3 text-sm transition-colors"
        :class="item.active
          ? 'font-medium text-highlighted underline decoration-primary decoration-2 underline-offset-[7px]'
          : 'text-toned hover:text-highlighted'"
      >
        {{ item.label }}
      </NuxtLink>
    </nav>

    <template #right>
      <UContentSearchButton
        label="Search docs"
        :class="iconButton"
        :ui="{ leadingIcon: 'size-[19px]' }"
      />
      <UButton
        color="neutral"
        variant="ghost"
        :aria-label="isDark ? 'Switch to light theme' : 'Switch to dark theme'"
        :class="[iconButton, 'hidden lg:inline-flex']"
        @click="colorMode.preference = isDark ? 'light' : 'dark'"
      >
        <UIcon
          name="i-lucide-moon"
          class="size-[19px] dark:hidden"
        />
        <UIcon
          name="i-lucide-sun"
          class="size-[19px] hidden dark:inline-block"
        />
      </UButton>
      <UButton
        to="https://github.com/miiajs/miia"
        target="_blank"
        icon="i-simple-icons-github"
        aria-label="MiiaJS on GitHub"
        color="neutral"
        variant="ghost"
        :class="[iconButton, 'hidden lg:inline-flex']"
      />
    </template>

    <template #toggle="{ open: isOpen, toggle }">
      <UButton
        color="neutral"
        variant="ghost"
        :icon="isOpen ? 'i-lucide-x' : 'i-lucide-menu'"
        :aria-label="isOpen ? 'Close site menu' : 'Open site menu'"
        :aria-expanded="isOpen"
        :class="[iconButton, 'lg:hidden']"
        @click="toggle"
      />
    </template>

    <template #body>
      <nav
        aria-label="Main"
        class="flex flex-col px-4 pt-2"
      >
        <NuxtLink
          v-for="item in items"
          :key="item.to"
          :to="item.to"
          :aria-current="item.active ? 'page' : undefined"
          class="flex min-h-14 items-center justify-between border-b border-default text-[19px] font-medium text-highlighted"
        >
          {{ item.label }}
          <UIcon
            name="i-lucide-chevron-right"
            class="size-[18px] text-dimmed"
          />
        </NuxtLink>
      </nav>

      <div class="flex flex-col gap-2.5 px-4 pt-7">
        <p class="font-mono text-xs text-muted">
          theme
        </p>
        <div
          role="group"
          aria-label="Theme"
          class="flex rounded-lg border border-accented bg-elevated p-[3px]"
        >
          <button
            v-for="theme in themes"
            :key="theme.value"
            type="button"
            :aria-pressed="preference === theme.value"
            class="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-md text-sm"
            :class="preference === theme.value ? 'bg-inverted font-medium text-inverted' : 'text-toned'"
            @click="preference = theme.value"
          >
            <UIcon
              :name="theme.icon"
              class="size-[15px]"
            />
            {{ theme.label }}
          </button>
        </div>
      </div>

      <div class="flex flex-col px-4 pt-7">
        <p class="mb-1 font-mono text-xs text-muted">
          community
        </p>
        <NuxtLink
          v-for="link in community"
          :key="link.label"
          :to="link.to"
          target="_blank"
          class="flex min-h-12 items-center justify-between border-b border-muted text-base text-highlighted last:border-b-0"
        >
          {{ link.label }}
          <UIcon
            name="i-lucide-arrow-up-right"
            class="size-[15px] text-dimmed"
          />
        </NuxtLink>
      </div>

      <div class="mt-auto flex justify-between border-t border-default p-4 font-mono text-xs text-muted">
        <span>&copy; 2026{{ year > 2026 ? `-${year}` : '' }} MiiaJS</span>
        <span>v{{ miiaVersion }}</span>
      </div>
    </template>
  </UHeader>
</template>
