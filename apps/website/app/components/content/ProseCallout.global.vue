<script setup lang="ts">
// Replaces Nuxt UI's ProseCallout and frames ProseNote, ProseTip, ProseWarning and ProseCaution:
// a header row with a marker, the type label and the optional title, the body below.
// The label and the marker shape tell the types apart, not only the color
const props = withDefaults(defineProps<{
  type?: 'note' | 'tip' | 'warning' | 'caution'
  title?: string
}>(), {
  type: 'note',
  title: undefined
})

const markers = {
  note: 'size-1.5 bg-primary',
  tip: 'size-1.5 rounded-full bg-primary',
  warning: 'size-2 bg-warning [clip-path:polygon(50%_0,100%_100%,0_100%)]',
  caution: 'size-[5px] rotate-45 bg-error'
}
</script>

<template>
  <aside class="my-5 rounded-[8px] border border-default bg-elevated lg:my-[22px]">
    <div class="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-b border-muted px-3.5 py-2.5 sm:px-[18px]">
      <span
        aria-hidden="true"
        class="shrink-0"
        :class="markers[props.type]"
      />
      <span class="font-mono text-xs text-muted">{{ props.type }}</span>
      <span
        v-if="props.title"
        class="text-[15px] leading-snug font-semibold text-highlighted"
      >{{ props.title }}</span>
    </div>
    <div class="px-3.5 pt-3.5 pb-4 text-[15px] leading-[1.65] text-default sm:px-[18px] sm:text-[15.5px] [&>:first-child]:mt-0 [&>:last-child]:mb-0 [&>div]:my-3.5 [&>ol]:my-3 [&>p]:my-3 [&>p]:leading-[1.65] [&>ul]:my-3">
      <slot />
    </div>
  </aside>
</template>
