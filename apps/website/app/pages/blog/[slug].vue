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

const container = 'mx-auto max-w-(--ui-container) px-4 sm:px-6 lg:px-8'
</script>

<template>
  <div v-if="post">
    <header :class="[container, 'flex flex-col gap-3.5 pt-8 lg:gap-[18px] lg:pt-16']">
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
      <h1 class="max-w-[900px] text-[29px] leading-[1.15] font-semibold tracking-[-0.02em] lg:text-[length:clamp(36px,4vw,52px)] lg:leading-[1.1] lg:tracking-[-0.025em]">
        {{ post.title }}
      </h1>
      <p class="max-w-[760px] text-[16.5px] leading-[1.6] text-toned lg:text-[19px]">
        {{ post.description }}
      </p>
      <p class="mt-0.5 font-mono text-xs text-muted lg:mt-1.5 lg:text-[13px]">
        <time :datetime="post.date">{{ formatPostDate(post.date) }}</time> · {{ post.author }}
      </p>
    </header>

    <div :class="[container, 'flex flex-col pt-[22px] pb-10 lg:flex-row lg:items-start lg:gap-16 lg:pt-10 lg:pb-[88px]']">
      <UContentToc
        v-if="toc.length"
        :links="toc"
        color="neutral"
        :ui="{
          root: 'static mx-0 px-0 sm:mx-0 sm:px-0 bg-transparent backdrop-blur-none lg:sticky lg:order-last lg:max-w-[250px] lg:min-w-0 lg:flex-[1_1_220px]',
          container: 'border-0 py-0 sm:py-0 lg:pt-8 lg:pb-8',
          trigger: 'mt-0 mb-0 min-h-12 rounded-md border border-default bg-elevated px-3.5 py-0 text-[13px] text-highlighted lg:mb-2 lg:min-h-0 lg:rounded-none lg:border-0 lg:bg-transparent lg:px-0 lg:text-xs lg:text-muted',
          trailingIcon: 'size-4',
          content: 'max-lg:px-3.5 max-lg:pt-2',
          link: 'max-lg:min-h-11 max-lg:py-0 max-lg:text-[15px] lg:py-1.5'
        }"
      >
        In this post<span class="lg:hidden"> · {{ toc.length }} {{ toc.length === 1 ? 'section' : 'sections' }}</span>
      </UContentToc>

      <article class="-mx-4 mt-6 min-w-0 border-t border-default px-4 pt-1.5 text-[16.5px] sm:-mx-6 sm:px-6 lg:mx-0 lg:mt-0 lg:px-0 lg:max-w-[720px] lg:flex-[999_1_600px] lg:pt-2.5 lg:text-[17.5px] [&_h2]:text-[23px] lg:[&_h2]:text-[28px]">
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
    </div>
  </div>
</template>
