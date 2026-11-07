<script setup lang="ts">
const colorMode = useColorMode()

const color = computed(() => colorMode.value === 'dark' ? BRAND_COLORS.paperDark : BRAND_COLORS.paper)

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
</script>

<template>
  <UApp>
    <NuxtLoadingIndicator
      color="var(--ui-primary)"
      :height="3"
      :throttle="150"
    />

    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>

    <AppSearch />
  </UApp>
</template>
