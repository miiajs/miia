<script setup lang="ts">
definePageMeta({
  layout: 'default'
})

const { data: posts } = await useAsyncData('blog-posts', () => {
  return queryCollection('blog')
    .select('path', 'stem', 'title', 'description', 'date', 'tags', 'topics')
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

const latest = computed(() => posts.value?.[0])
const older = computed(() => posts.value?.slice(1) ?? [])

const container = 'mx-auto max-w-(--ui-container) px-4 sm:px-6 lg:px-8'
const tag = 'rounded-[3px] border border-default px-1.5 py-px text-xs text-toned'
</script>

<template>
  <div>
    <section :class="[container, 'flex flex-col gap-5 pt-9 pb-7 lg:flex-row lg:flex-wrap lg:items-end lg:justify-between lg:gap-x-12 lg:pt-[72px] lg:pb-10']">
      <div class="flex max-w-[680px] flex-col gap-4">
        <p class="font-mono text-xs text-muted lg:text-[13px]">
          blog
        </p>
        <h1 class="text-[40px] leading-[1.05] font-semibold tracking-[-0.025em] lg:text-[length:clamp(40px,4.6vw,56px)]">
          {{ title }}
        </h1>
        <p class="text-base leading-[1.6] text-toned lg:text-lg">
          {{ description }}
        </p>
      </div>
      <NuxtLink
        to="/blog/rss.xml"
        target="_blank"
        class="inline-flex min-h-11 items-center gap-2 self-start font-mono text-[13px] text-primary hover:underline lg:self-auto lg:text-sm"
      >
        <UIcon
          name="i-lucide-rss"
          class="size-[15px]"
        />
        RSS feed
      </NuxtLink>
    </section>

    <section
      v-if="latest"
      :class="[container, 'pb-16 lg:pb-24']"
    >
      <article class="flex flex-col gap-4 border-t border-default pt-7 pb-8 last:border-b lg:flex-row lg:gap-14 lg:pt-10 lg:pb-11">
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5 font-mono text-xs text-muted lg:w-[200px] lg:shrink-0 lg:flex-col lg:items-start lg:text-[13px]">
          <time :datetime="latest.date">{{ formatPostDate(latest.date) }}</time>
          <div
            v-if="latest.tags?.length || isDraftPost(latest)"
            class="flex flex-wrap items-center gap-1.5"
          >
            <span
              v-for="item in latest.tags"
              :key="item"
              :class="tag"
            >{{ item }}</span>
            <UBadge
              v-if="isDraftPost(latest)"
              label="Draft"
              color="warning"
              variant="subtle"
            />
          </div>
        </div>
        <div class="flex min-w-0 flex-1 flex-col gap-3 lg:gap-4">
          <h2 class="text-[26px] leading-[1.18] font-semibold tracking-[-0.02em] lg:text-[34px] lg:leading-[1.15]">
            <NuxtLink
              :to="latest.path"
              class="hover:text-toned"
            >
              {{ latest.title }}
            </NuxtLink>
          </h2>
          <p class="max-w-[720px] text-base leading-[1.65] text-toned lg:text-[17px]">
            {{ latest.description }}
          </p>
          <p
            v-if="latest.topics?.length"
            class="font-mono text-xs leading-[1.7] text-muted lg:text-[13px]"
          >
            {{ latest.topics.join(' · ') }}
          </p>
          <NuxtLink
            :to="latest.path"
            class="inline-flex min-h-11 items-center gap-2 self-start text-[15px] font-medium text-primary underline-offset-4 hover:underline lg:min-h-9"
          >
            Read the post
            <UIcon
              name="i-lucide-arrow-right"
              class="size-3.5"
            />
          </NuxtLink>
        </div>
      </article>

      <article
        v-for="post in older"
        :key="post.path"
        class="flex flex-col gap-3 border-t border-default py-6 last:border-b lg:flex-row lg:items-start lg:gap-14 lg:py-7"
      >
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5 font-mono text-xs text-muted lg:w-[200px] lg:shrink-0 lg:flex-col lg:items-start lg:gap-2 lg:text-[13px]">
          <time :datetime="post.date">{{ formatPostDate(post.date) }}</time>
          <div
            v-if="post.tags?.length || isDraftPost(post)"
            class="flex flex-wrap items-center gap-1.5"
          >
            <span
              v-for="item in post.tags"
              :key="item"
              :class="tag"
            >{{ item }}</span>
            <UBadge
              v-if="isDraftPost(post)"
              label="Draft"
              color="warning"
              variant="subtle"
            />
          </div>
        </div>
        <div class="flex min-w-0 flex-1 flex-col gap-1.5">
          <h2 class="text-xl leading-[1.25] font-semibold tracking-[-0.01em] lg:text-[22px]">
            <NuxtLink
              :to="post.path"
              class="hover:text-toned"
            >
              {{ post.title }}
            </NuxtLink>
          </h2>
          <p class="text-[15px] leading-[1.6] text-toned lg:text-[15.5px]">
            {{ post.description }}
          </p>
        </div>
      </article>
    </section>

    <section
      v-else
      :class="[container, 'pb-16 lg:pb-24']"
    >
      <p class="border-t border-default pt-7 text-muted lg:pt-10">
        No posts yet. Subscribe to the
        <NuxtLink
          to="/blog/rss.xml"
          target="_blank"
          class="text-primary hover:underline"
        >
          RSS feed
        </NuxtLink>
        to get the first one.
      </p>
    </section>
  </div>
</template>
