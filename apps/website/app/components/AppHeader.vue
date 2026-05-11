<script setup lang="ts">
const route = useRoute()
const open = ref(false)

const items = computed(() => [
  { label: 'Home',       to: '/',                  active: route.path === '/' },
  { label: 'Docs',       to: '/docs',              active: route.path.startsWith('/docs') && !route.path.startsWith('/docs/roadmap') },
  { label: 'Roadmap',    to: '/docs/roadmap',      active: route.path.startsWith('/docs/roadmap') },
  { label: 'Benchmarks', to: '/benchmarks',        active: route.path === '/benchmarks' }
])

watch(() => route.path, () => { open.value = false })
</script>

<template>
  <header class="sticky top-0 z-50">
    <div class="glass">
      <div class="mx-auto flex h-16 max-w-7xl items-center gap-6 px-4 sm:px-6 justify-between">
        <NuxtLink to="/" class="flex items-center gap-2">
          <AppLogo />
        </NuxtLink>

        <nav class="hidden md:flex items-center gap-1">
          <NuxtLink
            v-for="item in items"
            :key="item.to"
            :to="item.to"
            class="relative rounded-full px-3.5 py-1.5 text-sm font-medium transition"
            :class="item.active
              ? 'text-default'
              : 'text-muted hover:text-default'"
          >
            <span
              v-if="item.active"
              class="absolute inset-0 -z-10 rounded-full gradient-plasma-soft ring-1 ring-[color:color-mix(in_oklab,var(--color-plasma-500)_45%,transparent)]"
            />
            {{ item.label }}
          </NuxtLink>
        </nav>

        <div class="flex items-center gap-1.5">
          <!-- Search: always visible as icon (collapsed) -->
          <UContentSearchButton :collapsed="true" />
          <UColorModeButton />
          <UButton
            to="https://github.com/miiajs/miia"
            target="_blank"
            icon="i-simple-icons-github"
            aria-label="MiiaJS on GitHub"
            color="neutral"
            variant="ghost"
          />

          <button
            type="button"
            class="md:hidden inline-flex h-9 w-9 items-center justify-center rounded-full text-default hover:bg-[color:var(--ui-bg-elevated)]"
            aria-label="Toggle menu"
            @click="open = !open"
          >
            <UIcon :name="open ? 'i-lucide-x' : 'i-lucide-menu'" class="size-5" />
          </button>
        </div>
      </div>

      <!-- mobile panel: nav only — Search/GitHub stay in main header row -->
      <div
        v-if="open"
        class="md:hidden border-t border-[color:var(--ui-border)] px-4 py-3 space-y-1"
      >
        <NuxtLink
          v-for="item in items"
          :key="item.to"
          :to="item.to"
          class="block rounded-lg px-3 py-2 text-sm"
          :class="item.active ? 'gradient-plasma-soft text-default' : 'text-muted hover:bg-[color:var(--ui-bg-elevated)]'"
        >
          {{ item.label }}
        </NuxtLink>
      </div>
    </div>

    <!-- Gradient hairline under header -->
    <div
      class="h-px w-full"
      style="background: linear-gradient(90deg, transparent 0%, color-mix(in oklab, var(--color-plasma-500) 55%, transparent) 25%, color-mix(in oklab, var(--color-violet-accent) 55%, transparent) 50%, color-mix(in oklab, var(--color-cyan-accent) 55%, transparent) 75%, transparent 100%);"
    />
  </header>
</template>
