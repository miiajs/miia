<script setup lang="ts">
import ProseCallout from './ProseCallout.global.vue'

defineProps<{
  title?: string
}>()
</script>

<template>
  <ProseCallout
    type="caution"
    :title="title"
  >
    <slot />
  </ProseCallout>
</template>
