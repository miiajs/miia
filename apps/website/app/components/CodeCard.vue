<script setup lang="ts">
/**
 * macOS-style code/terminal card with traffic-light dots, filename strip,
 * and plasma gradient glow. Content goes in the default slot.
 *
 * Pass `code` + `lang` to render a highlighted MDC block, OR use the default
 * slot for raw content (e.g. a hand-rolled <pre> with inline syntax spans).
 */
defineProps<{
  file: string
  code?: string
  lang?: string
}>()

// Shared with index.vue code cards - MDC prose reset so the card owns the chrome.
const mdcClass
  = 'prose prose-primary dark:prose-invert max-w-none '
    + '[&>div>pre]:!text-[13px] [&>div>pre]:!m-0 [&>div>pre]:!rounded-none '
    + '[&>div>pre]:!border-0 [&>div>pre]:!shadow-none'
</script>

<template>
  <div class="relative">
    <!-- Gradient glow -->
    <div class="absolute -inset-4 rounded-3xl gradient-plasma opacity-20 blur-2xl" />

    <div class="relative rounded-2xl glass overflow-hidden">
      <!-- Traffic lights + filename -->
      <div class="flex items-center gap-2 px-4 py-3 border-b border-[color:var(--ui-border)]">
        <span class="h-3 w-3 rounded-full bg-[#ff5f56]" />
        <span class="h-3 w-3 rounded-full bg-[#ffbd2e]" />
        <span class="h-3 w-3 rounded-full bg-[#27c93f]" />
        <span class="ml-3 font-mono text-xs text-dimmed">{{ file }}</span>
      </div>

      <!-- Content -->
      <MDC
        v-if="code"
        :value="`\`\`\`${lang ?? 'typescript'}\n${code}\n\`\`\``"
        tag="div"
        :class="mdcClass"
      />
      <slot v-else />
    </div>
  </div>
</template>
