<script setup lang="ts">
definePageMeta({
  layout: 'default'
})

const route = useRoute()

const { data: post } = await useAsyncData(route.path, () => queryCollection('blog').path(route.path).first())
if (!post.value) {
  throw createError({ statusCode: 404, statusMessage: 'Post not found', fatal: true })
}

const { title, description, date, author } = post.value
const tags = post.value.tags ?? []

useSeoMeta({
  title,
  ogTitle: title,
  description,
  ogDescription: description,
  ogType: 'article',
  articlePublishedTime: date,
  articleAuthor: [author],
  articleTag: tags
})

useSchemaOrg([
  defineArticle({
    headline: title,
    description,
    datePublished: date,
    author: { name: author }
  })
])

defineOgImage('MiiaPost', { title, description, date: formatPostDate(date), path: post.value.path, tag: tags[0] }, { width: 1200, height: 630 })

const url = `${useSiteConfig().url.replace(/\/$/, '')}${post.value.path}`
const actions = [
  ...(post.value.discussion ? [{ label: 'Discuss on GitHub', to: post.value.discussion }] : []),
  { label: 'Share on X', to: `https://x.com/intent/post?url=${encodeURIComponent(url)}&text=${encodeURIComponent(title)}` },
  { label: 'Share on LinkedIn', to: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}` }
]

const toc = computed(() => post.value?.body?.toc?.links ?? [])
</script>

<template>
  <UContainer
    v-if="post"
    :class="['flex flex-col pb-10 lg:grid lg:pb-[88px]', TOC_COLUMNS]"
  >
    <header class="flex max-w-[720px] flex-col gap-3.5 pt-8 pb-[22px] lg:col-start-1 lg:row-start-1 lg:gap-[18px] lg:pt-10 lg:pb-10">
      <p class="flex flex-wrap items-center gap-x-3 gap-y-1.5 font-mono text-xs text-muted lg:text-[13px]">
        <span>
          <NuxtLink
            to="/blog"
            class="hover:text-highlighted"
          >blog</NuxtLink>
          <template v-if="tags[0]"> / {{ tags[0] }}</template>
        </span>
        <UBadge
          v-if="isDraftPost(post)"
          label="Draft"
          color="warning"
          variant="subtle"
        />
      </p>
      <h1 class="text-[29px] leading-[1.15] font-semibold tracking-[-0.02em] lg:text-[length:clamp(36px,4vw,52px)] lg:leading-[1.1] lg:tracking-[-0.025em]">
        {{ post.title }}
      </h1>
      <p class="text-[16.5px] leading-[1.6] text-toned lg:text-[19px]">
        {{ post.description }}
      </p>
      <p class="mt-0.5 font-mono text-xs text-muted lg:mt-1.5 lg:text-[13px]">
        <time :datetime="post.date">{{ formatPostDate(post.date) }}</time> · {{ post.author }}
      </p>
    </header>

    <UContentToc
      v-if="toc.length"
      :links="toc"
      color="neutral"
      class="lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-start"
      :ui="{
        root: 'mx-0 px-0 sm:mx-0 sm:px-0 max-lg:static max-lg:bg-transparent max-lg:backdrop-blur-none',
        container: 'border-0 py-0 sm:py-0',
        trigger: 'max-lg:mt-0 max-lg:mb-0 max-lg:min-h-12 max-lg:rounded-md max-lg:border max-lg:border-default max-lg:bg-elevated max-lg:px-3.5 max-lg:py-0 max-lg:text-[13px] max-lg:text-highlighted',
        trailingIcon: 'size-4',
        content: 'max-lg:px-3.5 max-lg:pt-2',
        link: 'max-lg:min-h-11 max-lg:py-0 max-lg:text-[15px]'
      }"
    >
      In this post<span class="lg:hidden"> · {{ toc.length }} {{ toc.length === 1 ? 'section' : 'sections' }}</span>
      <template #link="{ link }">
        <span class="wrap-anywhere">{{ link.text }}</span>
      </template>
    </UContentToc>

    <article class="-mx-4 mt-6 min-w-0 border-t border-default px-4 pt-1.5 text-[16.5px] sm:-mx-6 sm:px-6 lg:col-start-1 lg:row-start-2 lg:mx-0 lg:mt-0 lg:max-w-[720px] lg:px-0 lg:pt-2.5 lg:text-[17.5px] [&_h2]:text-[23px] lg:[&_h2]:text-[28px]">
      <ContentRenderer
        v-if="post.body"
        :value="post"
      />

      <div class="mt-5 flex flex-col gap-1 border-t border-default pt-4 lg:mt-7 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between lg:gap-x-8 lg:gap-y-4 lg:pt-6">
        <NuxtLink
          to="/blog"
          class="inline-flex min-h-11 items-center gap-2 self-start text-[15px] font-medium text-highlighted hover:text-toned"
        >
          <UIcon
            name="i-lucide-arrow-left"
            class="size-3.5"
          />
          All posts
        </NuxtLink>
        <div class="flex flex-col font-mono text-[13px] lg:flex-row lg:flex-wrap lg:gap-x-5 lg:gap-y-1">
          <NuxtLink
            v-for="action in actions"
            :key="action.label"
            :to="action.to"
            target="_blank"
            class="flex min-h-11 items-center text-toned hover:text-highlighted lg:min-h-0 lg:py-2.5"
          >
            {{ action.label }}
          </NuxtLink>
        </div>
      </div>
    </article>
  </UContainer>
</template>
