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

usePageSeo(title, description, { ogType: 'article', articlePublishedTime: date, articleAuthor: [author], articleTag: tags })

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
const discussion = post.value.discussion ? [{ label: 'Discuss on GitHub', to: post.value.discussion }] : []
const shares = [
  { label: 'Share on X', to: `https://x.com/intent/post?url=${encodeURIComponent(url)}&text=${encodeURIComponent(title)}` },
  { label: 'Share on LinkedIn', to: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}` }
]

const toc = computed(() => post.value?.body?.toc?.links ?? [])
</script>

<template>
  <UContainer
    v-if="post"
    class="py-page"
  >
    <UPage
      :ui="{
        root: SIDEBAR_COLUMNS,
        left: 'lg:col-span-1',
        center: 'lg:col-span-1'
      }"
    >
      <template #left>
        <UPageAside :ui="{ root: 'lg:overflow-visible' }">
          <div class="flex flex-col gap-[22px]">
            <NuxtLink
              to="/blog"
              class="-my-1 inline-flex min-h-8 items-center gap-2 self-start text-ui font-medium text-highlighted hover:text-toned"
            >
              <UIcon
                name="i-lucide-arrow-left"
                class="size-3.5"
              />
              All posts
            </NuxtLink>
            <dl class="flex flex-col gap-[22px]">
              <div>
                <dt class="mb-1.5 font-mono text-caption text-muted">
                  published
                </dt>
                <dd class="text-small text-highlighted">
                  <time :datetime="post.date">{{ formatPostDate(post.date) }}</time>
                </dd>
              </div>
              <div>
                <dt class="mb-1.5 font-mono text-caption text-muted">
                  author
                </dt>
                <dd class="text-small text-highlighted">
                  {{ post.author }}
                </dd>
              </div>
            </dl>
            <div
              v-if="discussion.length"
              class="flex flex-col"
            >
              <p class="mb-1.5 font-mono text-caption text-muted">
                discussion
              </p>
              <NuxtLink
                v-for="action in discussion"
                :key="action.label"
                :to="action.to"
                target="_blank"
                class="py-1 font-mono text-meta text-toned hover:text-highlighted"
              >
                {{ action.label }}
              </NuxtLink>
            </div>
            <div class="flex flex-col">
              <p class="mb-1.5 font-mono text-caption text-muted">
                share
              </p>
              <NuxtLink
                v-for="action in shares"
                :key="action.label"
                :to="action.to"
                target="_blank"
                class="py-1 font-mono text-meta text-toned hover:text-highlighted"
              >
                {{ action.label }}
              </NuxtLink>
            </div>
          </div>
        </UPageAside>
      </template>

      <div :class="['flex flex-col lg:grid', TOC_COLUMNS]">
        <header
          class="flex flex-col gap-3.5 pb-[22px] lg:col-start-1 lg:row-start-1 lg:max-w-reading lg:gap-[18px] lg:pb-10"
          :class="!toc.length && 'lg:col-span-2'"
        >
          <p class="flex flex-wrap items-center gap-x-3 gap-y-1.5 font-mono text-meta text-muted">
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
          <h1 class="text-title font-semibold">
            {{ post.title }}
          </h1>
          <p class="text-lead text-toned">
            {{ post.description }}
          </p>
          <p class="mt-0.5 font-mono text-meta text-muted lg:hidden">
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
            trigger: 'max-lg:mt-0 max-lg:mb-0 max-lg:min-h-12 max-lg:rounded-md max-lg:border max-lg:border-default max-lg:bg-elevated max-lg:px-3.5 max-lg:py-0 max-lg:text-small max-lg:text-highlighted',
            trailingIcon: 'size-4',
            content: 'max-lg:px-3.5 max-lg:pt-2',
            link: 'max-lg:min-h-11 max-lg:py-0 max-lg:text-ui'
          }"
        >
          In this post<span class="lg:hidden"> · {{ toc.length }} {{ toc.length === 1 ? 'section' : 'sections' }}</span>
          <template #link="{ link }">
            <span class="wrap-anywhere">{{ link.text }}</span>
          </template>
        </UContentToc>

        <article
          class="-mx-4 mt-6 min-w-0 border-t border-default px-4 pt-1.5 text-body-lg sm:-mx-6 sm:px-6 lg:col-start-1 lg:row-start-2 lg:mx-0 lg:mt-0 lg:max-w-reading lg:px-0 lg:pt-2.5"
          :class="!toc.length && 'lg:col-span-2'"
        >
          <ContentRenderer
            v-if="post.body"
            :value="post"
            class="[&>:nth-last-child(1_of_:not(style))]:mb-0"
          />

          <div class="mt-5 flex flex-col gap-1 border-t border-default pt-4 lg:hidden">
            <NuxtLink
              to="/blog"
              class="inline-flex min-h-11 items-center gap-2 self-start text-ui font-medium text-highlighted hover:text-toned"
            >
              <UIcon
                name="i-lucide-arrow-left"
                class="size-3.5"
              />
              All posts
            </NuxtLink>
            <div class="flex flex-col font-mono text-meta">
              <NuxtLink
                v-for="action in [...discussion, ...shares]"
                :key="action.label"
                :to="action.to"
                target="_blank"
                class="flex min-h-11 items-center text-toned hover:text-highlighted"
              >
                {{ action.label }}
              </NuxtLink>
            </div>
          </div>
        </article>
      </div>
    </UPage>
  </UContainer>
</template>
