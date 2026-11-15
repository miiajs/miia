<script setup lang="ts">
const navigation = useDocsNavigation()
const { open } = useContentSearch()

// A Content query in the browser runs on wasm SQLite with the docs dump, so it starts when the search opens
const { data: files, status, execute } = useLazyAsyncData('search', () => queryCollectionSearchSections('docs'), {
  server: false,
  immediate: false
})

watch(open, (value) => {
  if (value && status.value === 'idle') execute()
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
      :loading="status === 'pending'"
      shortcut="meta_k"
      :navigation="navigation"
      :links="links"
      :fuse="{ resultLimit: 12 }"
    >
      <template
        v-if="status === 'pending' || status === 'error'"
        #empty
      >
        <p>
          {{ status === 'pending' ? 'Loading the search index...' : 'The search index failed to load. Reload the page to try again.' }}
        </p>
      </template>
    </LazyUContentSearch>
  </ClientOnly>
</template>
