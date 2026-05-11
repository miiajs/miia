<script setup lang="ts">
const colorMode = useColorMode()

const color = computed(() => colorMode.value === 'dark' ? '#0a0a12' : '#ffffff')

// Plasma-gradient progress bar for the top loader
const loaderGradient
  = 'repeating-linear-gradient('
    + '90deg, '
    + '#ff4d6d 0%, '
    + '#ff4d6d 20%, '
    + '#c04bff 50%, '
    + '#7c3aed 70%, '
    + '#22d3ee 100%'
    + ')'

useHead({
  meta: [
    { charset: 'utf-8' },
    { name: 'viewport', content: 'width=device-width, initial-scale=1' },
    { key: 'theme-color', name: 'theme-color', content: color }
  ],
  htmlAttrs: {
    lang: 'en'
  }
})

useSeoMeta({
  titleTemplate: '%s - MiiaJS',
  twitterCard: 'summary_large_image',
  ogImage: '/og-image.png',
  twitterImage: '/og-image.png',
  ogImageWidth: 1200,
  ogImageHeight: 630,
  ogImageType: 'image/png'
})

const { data: navigation } = await useAsyncData('navigation', () => queryCollectionNavigation('docs', ['status']), {
  transform: data => data.find(item => item.path === '/docs')?.children || []
})
const { data: files } = useLazyAsyncData('search', () => queryCollectionSearchSections('docs'), {
  server: false
})

const links = [{
  label: 'Docs',
  icon: 'i-lucide-book',
  to: '/docs/getting-started'
}]

provide('navigation', navigation)
</script>

<template>
  <UApp>
    <NuxtLoadingIndicator
      :color="loaderGradient"
      :height="3"
      :throttle="150"
    />

    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>

    <ClientOnly>
      <LazyUContentSearch
        :files="files"
        shortcut="meta_k"
        :navigation="navigation"
        :links="links"
        :fuse="{ resultLimit: 42 }"
      />
    </ClientOnly>
  </UApp>
</template>
