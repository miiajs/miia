<script setup lang="ts">
// Text on the left, a code panel, a table or a list on the right: one split, so the panels line up across pages
// The lg gap gives way to a classic scrollbar at 1024 (40 instead of 56), so the columns keep 432 / 472
const props = withDefaults(defineProps<{
  align?: 'start' | 'center'
  // Below lg the text column dissolves into the row, so a child with order-last lands below the panel
  flow?: boolean
  // Replaces the default gap of the text column instead of merging with it
  textClass?: string
}>(), {
  align: 'center',
  flow: false,
  textClass: 'gap-4 lg:gap-[18px]'
})
</script>

<template>
  <UContainer
    class="flex flex-col lg:flex-row lg:gap-x-[clamp(2.5rem,calc(100%-56.5rem),3.5rem)]"
    :class="props.align === 'start' ? 'lg:items-start' : 'lg:items-center'"
  >
    <div :class="[props.flow ? 'contents lg:flex' : 'flex', 'min-w-0 flex-col lg:flex-[11_1_432px]', props.textClass]">
      <slot name="text" />
    </div>
    <div
      v-if="$slots.panel"
      class="min-w-0 lg:flex-[21_1_472px]"
    >
      <slot name="panel" />
    </div>
  </UContainer>
</template>
