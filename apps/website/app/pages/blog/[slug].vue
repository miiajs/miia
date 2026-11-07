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

defineOgImage('MiiaPost', { title, description, date: formatPostDate(date) }, { width: 1200, height: 630 })
</script>

<template>
  <UContainer v-if="post">
    <UPage>
      <UPageHeader
        :title="post.title"
        :description="post.description"
      >
        <template #headline>
          <div class="flex flex-wrap items-center gap-2">
            <time :datetime="post.date">
              {{ formatPostDate(post.date) }}
            </time>
            <UBadge
              v-for="tag in tags"
              :key="tag"
              :label="tag"
              color="neutral"
              variant="subtle"
            />
            <UBadge
              v-if="isDraftPost(post)"
              label="Draft"
              color="warning"
              variant="subtle"
            />
          </div>
        </template>
      </UPageHeader>

      <UPageBody>
        <ContentRenderer
          v-if="post.body"
          :value="post"
        />

        <USeparator />

        <UButton
          to="/blog"
          label="All posts"
          icon="i-lucide-arrow-left"
          color="neutral"
          variant="link"
        />
      </UPageBody>

      <template
        v-if="post.body?.toc?.links?.length"
        #right
      >
        <UContentToc :links="post.body.toc.links" />
      </template>
    </UPage>
  </UContainer>
</template>
