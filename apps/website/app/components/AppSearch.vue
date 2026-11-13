<script setup lang="ts">
const navigation = useDocsNavigation()
const { data: files } = useLazyAsyncData('search', () => queryCollectionSearchSections('docs'), {
  server: false
})

// The site links without Home
const icons: Record<string, string> = {
  Docs: 'i-lucide-book',
  Benchmarks: 'i-lucide-gauge',
  Blog: 'i-lucide-newspaper'
}
const links = SITE_NAV.filter(item => item.label in icons).map(item => ({ ...item, icon: icons[item.label] }))
</script>

<template>
  <ClientOnly>
    <LazyUContentSearch
      :files="files"
      shortcut="meta_k"
      :navigation="navigation"
      :links="links"
      :fuse="{ resultLimit: 12 }"
    />
  </ClientOnly>
</template>
