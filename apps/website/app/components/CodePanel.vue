<script setup lang="ts">
// A highlighted code block outside Markdown: the frame, the header and the copy button come from ProsePre
const props = defineProps<{
  file?: string
  lang: string
  code: string
}>()

const markdown = computed(() => `\`\`\`${props.lang}${props.file ? ` [${props.file}]` : ''}\n${props.code}\n\`\`\``)
</script>

<template>
  <MDC
    :value="markdown"
    tag="div"
    class="*:my-0"
  />
</template>
