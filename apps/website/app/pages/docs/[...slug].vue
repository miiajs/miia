<script setup lang="ts">
import { findPageBreadcrumb } from '@nuxt/content/utils'

definePageMeta({
  layout: 'docs'
})

const route = useRoute()
const navigation = useDocsNavigation()

const { data: page } = await useDocsPage(route.path)
if (!page.value) {
  throw createError({ statusCode: 404, statusMessage: 'Page not found', fatal: true })
}

const { data: surround } = await useAsyncData(`${route.path}-surround`, () => {
  return queryCollectionItemSurroundings('docs', route.path, {
    fields: ['description']
  })
})

const title = page.value.seo?.title || page.value.title
const description = page.value.seo?.description || page.value.description

useSeoMeta({
  title,
  ogTitle: title,
  description,
  ogDescription: description
})

// "core concepts / modules": the section titles from the sidebar, then the page itself
const breadcrumb = computed(() => findPageBreadcrumb(navigation.value, route.path, { current: true, indexAsChild: true })
  .map(item => item.title)
  .join(' / '))
const toc = computed(() => page.value?.body?.toc?.links ?? [])
const editUrl = computed(() => `https://github.com/miiajs/miia/edit/main/apps/website/content/${page.value?.stem}.md`)
</script>

<template>
  <UPage
    v-if="page"
    :ui="{
      root: TOC_COLUMNS,
      center: [toc.length ? 'lg:col-span-1' : 'lg:col-span-2', 'max-w-[780px]'],
      right: 'lg:col-span-1'
    }"
  >
    <UPageHeader
      :title="page.title"
      :description="page.description"
      :ui="{
        root: 'pt-6 pb-[18px] lg:pt-10 lg:pb-7',
        headline: 'mb-[18px] flex-wrap gap-x-3 gap-y-1.5 font-mono text-meta font-normal text-muted lg:mb-[22px]',
        title: 'text-title sm:text-title font-semibold',
        description: 'mt-[18px] text-lead text-toned lg:mt-[22px]'
      }"
    >
      <template #headline>
        <span class="lowercase">{{ breadcrumb }}</span>
        <UBadge
          v-if="page.status === 'experimental'"
          v-bind="EXPERIMENTAL_BADGE"
        />
      </template>
    </UPageHeader>

    <UPageBody class="mt-0 space-y-0 pb-10 text-body lg:pt-1.5 lg:pb-[72px]">
      <ContentRenderer
        v-if="page.body"
        :value="page"
      />

      <UContentSurround
        v-if="surround?.some(Boolean)"
        :surround="surround"
        :ui="{
          root: 'mt-11 gap-4 lg:mt-[50px]',
          link: 'flex flex-col gap-1 rounded-[8px] px-[18px] py-4'
        }"
      >
        <template #link="{ link }">
          <span class="font-mono text-caption text-muted">{{ link.path === surround?.[0]?.path ? 'previous' : 'next' }}</span>
          <span class="text-card-title font-semibold text-highlighted">{{ link.title }}</span>
        </template>
      </UContentSurround>

      <NuxtLink
        :to="editUrl"
        target="_blank"
        class="mt-[18px] inline-flex min-h-8 items-center gap-2 font-mono text-meta text-muted hover:text-highlighted lg:mt-[22px]"
      >
        Edit this page on GitHub
        <UIcon
          name="i-lucide-arrow-up-right"
          class="size-[13px]"
        />
      </NuxtLink>
    </UPageBody>

    <template
      v-if="toc.length"
      #right
    >
      <UContentToc
        :links="toc"
        title="On this page"
        color="neutral"
        :ui="{ root: 'hidden lg:flex' }"
      >
        <template #link="{ link }">
          <span class="wrap-anywhere">{{ link.text }}</span>
        </template>
      </UContentToc>
    </template>
  </UPage>
</template>
