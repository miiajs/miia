<script setup lang="ts">
// Replaces Nuxt UI's ProsePre: a header row with the file name or the language and a copy button
const props = defineProps<{
  code?: string
  language?: string
  filename?: string
  highlights?: number[]
  meta?: string
  // Set by ProseCodeGroup: its tabs take the place of the header, and the copy button sits on them
  hideHeader?: boolean
  class?: unknown
}>()

const { copied, copy } = useCopy()
const pre = useTemplateRef('pre')
// MDC reports a block without a language as `text`: plain text gets no header, as in the design
const label = computed(() => props.filename || (props.language === 'text' ? undefined : props.language))

function copyCode() {
  copy(props.code ?? pre.value?.textContent ?? '')
}
</script>

<template>
  <div
    class="relative my-5 rounded-[8px] border border-default bg-elevated"
    :class="hideHeader && 'rounded-t-none border-t-(--ui-border-muted)'"
  >
    <div
      v-if="label && !hideHeader"
      class="flex min-h-11 items-center border-b border-muted ps-3.5 pe-12 font-mono text-caption text-muted sm:ps-[18px]"
    >
      <span class="truncate">{{ label }}</span>
    </div>
    <UButton
      v-if="label"
      color="neutral"
      variant="ghost"
      :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
      :aria-label="copied ? 'Copied' : 'Copy code'"
      class="absolute end-0.5 top-0 size-11 justify-center rounded-sm text-muted hover:text-highlighted sm:end-1"
      :class="hideHeader && 'top-px end-px rounded-tr-[7px] bg-elevated'"
      :ui="{ leadingIcon: 'size-[15px]' }"
      @click="copyCode"
    />

    <pre
      ref="pre"
      class="m-0 overflow-x-auto p-3.5 font-mono text-code whitespace-pre text-highlighted sm:p-[18px] **:[.line]:block **:[.line.highlight]:bg-accented"
      :class="props.class"
    ><slot /></pre>
  </div>
</template>
