<script setup lang="ts">
definePageMeta({
  layout: 'default'
})

const { data: posts } = await useAsyncData('blog-posts', () => {
  return queryCollection('blog')
    .select('path', 'stem', 'title', 'description', 'date', 'tags')
    .order('date', 'DESC')
    .all()
})

const title = 'Blog'
const description = 'Release notes, design decisions and guides for MiiaJS.'

useSeoMeta({
  title,
  ogTitle: title,
  description,
  ogDescription: description
})
</script>

<template>
  <UContainer>
    <UPageHeader
      :title="title"
      :description="description"
    />

    <UPageBody>
      <UBlogPosts v-if="posts?.length">
        <UBlogPost
          v-for="post in posts"
          :key="post.path"
          :title="post.title"
          :description="post.description"
          :date="post.date"
          :to="post.path"
          :badge="isDraftPost(post) ? { label: 'Draft', color: 'warning', variant: 'subtle' } : undefined"
        >
          <template #date>
            {{ formatPostDate(post.date) }}
          </template>
        </UBlogPost>
      </UBlogPosts>

      <p
        v-else
        class="text-muted"
      >
        No posts yet. Subscribe to the
        <ULink
          to="/blog/rss.xml"
          target="_blank"
          class="text-primary"
        >
          RSS feed
        </ULink>
        to get the first one.
      </p>
    </UPageBody>
  </UContainer>
</template>
