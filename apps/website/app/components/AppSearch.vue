<script setup lang="ts">
const navigation = useDocsNavigation()
const { data: files } = useLazyAsyncData('search', () => queryCollectionSearchSections('docs'), {
  server: false
})

const links = [{
  label: 'Docs',
  icon: 'i-lucide-book',
  to: '/docs/getting-started'
}]
</script>

<template>
  <ClientOnly>
    <LazyUContentSearch
      :files="files"
      shortcut="meta_k"
      :navigation="navigation"
      :links="links"
      :fuse="{ resultLimit: 42 }"
    />
  </ClientOnly>
</template>
