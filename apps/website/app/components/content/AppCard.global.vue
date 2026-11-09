<script setup lang="ts">
// `::app-card` in a post: an app the reader can run, its packages, runtimes, needs and the commands to start it
const props = defineProps<{
  name: string
  description: string
  // @miiajs packages; after the first one the scope is dropped
  packages: string[]
  runtimes: string[]
  // `code` in backticks renders as code
  needs?: string
  // Path in the miiajs/miia repository, e.g. examples/messaging-app
  path: string
  commands: string[]
}>()

const { copied, copy } = useCopy()

const source = computed(() => `https://github.com/miiajs/miia/tree/main/${props.path.replace(/^\/+/, '')}`)
const packages = computed(() => props.packages.map((name, index) => index ? name.replace(/^@miiajs\//, '') : name).join(' · '))
const needs = computed(() => props.needs?.split('`').map((text, index) => ({ text, code: index % 2 === 1 })) ?? [])

const row = 'flex flex-col gap-0.5 px-3.5 py-2.5 not-first:border-t not-first:border-muted sm:grid sm:grid-cols-[96px_minmax(0,1fr)] sm:gap-0 sm:px-0 sm:py-0'
const label = 'font-mono text-xs text-muted sm:py-2.5 sm:ps-[18px] sm:text-[12.5px]'
const value = 'sm:py-2.5 sm:pe-[18px]'
</script>

<template>
  <aside
    aria-label="App"
    class="my-5 overflow-hidden rounded-[8px] border border-default bg-elevated lg:my-[22px]"
  >
    <div class="flex flex-col gap-1.5 border-b border-muted p-3.5 sm:px-[18px] sm:py-4">
      <div class="flex items-center justify-between gap-3 font-mono text-xs text-muted">
        <span class="inline-flex items-center gap-2">
          <span
            aria-hidden="true"
            class="size-1.5 bg-primary"
          />
          app
        </span>
        <NuxtLink
          :to="source"
          target="_blank"
          class="inline-flex min-h-11 items-center gap-1.5 text-primary hover:underline sm:min-h-8"
        >
          source
          <UIcon
            name="i-lucide-arrow-up-right"
            class="size-3"
          />
        </NuxtLink>
      </div>
      <p class="text-[17px] font-semibold text-highlighted sm:text-lg">
        {{ props.name }}
      </p>
      <p class="text-[14.5px] leading-[1.55] text-toned sm:text-[15px]">
        {{ props.description }}
      </p>
    </div>

    <div class="text-sm leading-[1.5]">
      <div :class="row">
        <span :class="label">packages</span>
        <span :class="[value, 'font-mono text-[12.5px] sm:text-[13px]']">{{ packages }}</span>
      </div>
      <div :class="row">
        <span :class="label">runtimes</span>
        <span :class="value">{{ props.runtimes.join(' · ') }}</span>
      </div>
      <div
        v-if="needs.length"
        :class="row"
      >
        <span :class="label">needs</span>
        <span :class="value">
          <component
            :is="part.code ? 'code' : 'span'"
            v-for="(part, index) in needs"
            :key="index"
            :class="part.code && 'font-mono text-[0.9em]'"
          >{{ part.text }}</component>
        </span>
      </div>
    </div>

    <div class="border-t border-muted bg-default/50">
      <div class="flex items-center justify-between py-0.5 ps-3.5 pe-0.5 font-mono text-xs text-muted sm:ps-[18px] sm:pe-1.5">
        <span>run it</span>
        <UButton
          color="neutral"
          variant="ghost"
          :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
          :aria-label="copied ? 'Copied' : 'Copy commands'"
          class="size-11 justify-center rounded-sm text-muted hover:text-highlighted sm:size-10"
          :ui="{ leadingIcon: 'size-[15px]' }"
          @click="copy(props.commands.join('\n'))"
        />
      </div>
      <pre class="m-0 overflow-x-auto px-3.5 pb-3.5 font-mono text-[12.5px] leading-[1.75] whitespace-pre text-highlighted sm:px-[18px] sm:pb-4 sm:text-[13.5px]">{{ props.commands.join('\n') }}</pre>
    </div>
  </aside>
</template>
