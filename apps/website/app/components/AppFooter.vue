<script setup lang="ts">
const year = new Date().getFullYear()

const { data: versionData } = await useFetch<{ version: string }>(
  'https://registry.npmjs.org/@miiajs/core/latest',
  {
    key: 'miia-npm-version',
    server: false,
    default: () => ({ version: '' }),
    transform: (r: { version: string }) => ({ version: r.version })
  }
)
const version = computed(() => versionData.value?.version ?? '')

const columns = [
  {
    label: 'Documentation',
    children: [
      { label: 'Getting Started', to: '/docs/getting-started' },
      { label: 'Core Concepts',   to: '/docs/core-concepts' },
      { label: 'Benchmarks',      to: '/benchmarks' },
      { label: 'API Reference',   to: 'https://github.com/miiajs/miia', target: '_blank' }
    ]
  },
  {
    label: 'Community',
    children: [
      { label: 'GitHub',      to: 'https://github.com/miiajs/miia',               target: '_blank' },
      { label: 'Issues',      to: 'https://github.com/miiajs/miia/issues',        target: '_blank' },
      { label: 'Discussions', to: 'https://github.com/miiajs/miia/discussions',   target: '_blank' }
    ]
  },
  {
    label: 'Resources',
    children: [
      { label: 'MIT License', to: 'https://github.com/miiajs/miia/blob/main/LICENSE', target: '_blank' }
      // TODO: re-enable once we publish the first release and have a real roadmap page
      // { label: 'Changelog', to: 'https://github.com/miiajs/miia/releases', target: '_blank' },
      // { label: 'Roadmap',   to: 'https://github.com/miiajs/miia/issues',   target: '_blank' }
    ]
  }
]
</script>

<template>
  <footer class="relative mt-24 border-t border-[color:var(--ui-border)] overflow-hidden">
    <!-- Gradient hairline -->
    <div
      class="absolute inset-x-0 top-0 h-px"
      style="background: linear-gradient(90deg, transparent 0%, color-mix(in oklab, var(--color-plasma-500) 55%, transparent) 25%, color-mix(in oklab, var(--color-violet-accent) 55%, transparent) 50%, color-mix(in oklab, var(--color-cyan-accent) 55%, transparent) 75%, transparent 100%);"
    />

    <!-- Ambient glow -->
    <div
      class="pointer-events-none absolute left-1/2 top-0 h-80 w-[80%] -translate-x-1/2 blur-3xl opacity-60"
      style="background: radial-gradient(ellipse at center, rgba(124,58,237,0.18), transparent 70%);"
    />

    <div class="relative mx-auto max-w-7xl px-4 sm:px-6 py-16">
      <!-- Top: logo + columns -->
      <div class="grid gap-10 md:grid-cols-4">
        <div class="md:col-span-1">
          <AppLogo />
          <p class="mt-4 text-sm text-muted leading-relaxed max-w-xs">
            The decorator-driven HTTP framework for TypeScript. Lightweight,
            standards-first, runtime-agnostic.
          </p>

          <div class="mt-5 flex items-center gap-1.5">
            <UButton
              to="https://github.com/miiajs/miia"
              target="_blank"
              icon="i-simple-icons-github"
              aria-label="MiiaJS on GitHub"
              color="neutral"
              variant="ghost"
            />
            <UButton
              to="https://x.com/miiaframework"
              target="_blank"
              icon="i-simple-icons-x"
              aria-label="MiiaJS on X"
              color="neutral"
              variant="ghost"
            />
            <UButton
              to="https://www.linkedin.com/company/miiajs/"
              target="_blank"
              icon="i-simple-icons-linkedin"
              aria-label="MiiaJS on LinkedIn"
              color="neutral"
              variant="ghost"
            />
          </div>
        </div>

        <div
          v-for="col in columns"
          :key="col.label"
          class="md:col-span-1"
        >
          <h3 class="font-display text-sm font-semibold text-default">{{ col.label }}</h3>
          <ul class="mt-4 space-y-2.5">
            <li v-for="link in col.children" :key="link.label">
              <NuxtLink
                :to="link.to"
                :target="link.target"
                class="text-sm text-muted hover:text-[color:var(--color-plasma-500)] transition"
              >
                {{ link.label }}
              </NuxtLink>
            </li>
          </ul>
        </div>
      </div>

      <!-- Gigantic wordmark watermark -->
      <div class="relative mt-20 select-none overflow-hidden">
        <div
          class="font-display font-bold leading-none text-[clamp(5rem,20vw,16rem)] tracking-tighter text-plasma opacity-[0.12] whitespace-nowrap text-center"
        >
          MIIA/JS
        </div>
      </div>

      <!-- Bottom bar -->
      <div class="relative mt-8 flex flex-col sm:flex-row items-center justify-between gap-3 pt-6 border-t border-[color:var(--ui-border)]">
        <p class="text-xs text-dimmed">
          &copy; 2026{{ year > 2026 ? `-${year}` : '' }} MiiaJS. MIT License.
        </p>
        <NuxtLink
          v-if="version"
          to="https://github.com/miiajs/miia/releases"
          target="_blank"
          class="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--ui-border)] px-2.5 py-1 text-xs text-dimmed font-mono hover:text-[color:var(--color-plasma-500)] hover:border-[color:color-mix(in_oklab,var(--color-plasma-500)_40%,transparent)] transition"
        >
          <span
            class="size-1.5 rounded-full"
            style="background: var(--color-plasma-500); box-shadow: 0 0 8px color-mix(in oklab, var(--color-plasma-500) 60%, transparent);"
          />
          version {{ version }}
        </NuxtLink>
      </div>
    </div>
  </footer>
</template>
