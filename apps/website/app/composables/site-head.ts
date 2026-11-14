// The error page renders without app.vue, so both call this
export function useSiteHead() {
  const colorMode = useColorMode()

  const color = computed(() => colorMode.value === 'dark' ? BRAND_COLORS.paperDark : BRAND_COLORS.paper)

  useHead({
    meta: [
      { name: 'theme-color', content: color }
    ]
  })

  useSeoMeta({
    titleTemplate: '%s - MiiaJS',
    twitterCard: 'summary_large_image',
    ogImage: '/og-image.png',
    ogImageWidth: 1200,
    ogImageHeight: 630,
    ogImageType: 'image/png'
  })
}
