<script setup lang="ts">
import type { NuxtError } from '#app'

const props = defineProps<{
  error: NuxtError
}>()

const route = useRoute()
const { open: searchOpen } = useContentSearch()

const notFound = computed(() => props.error.statusCode === 404)
const path = computed(() => route.path)
const message = computed(() => JSON.stringify(`Cannot GET ${path.value}`))

useHead({
  htmlAttrs: {
    lang: 'en'
  }
})

useSeoMeta({
  title: () => notFound.value ? 'Page not found' : 'Something went wrong',
  description: () => notFound.value ? 'We are sorry but this page could not be found.' : 'We are sorry but this page could not be loaded.'
})
</script>

<template>
  <UApp>
    <AppHeader />

    <UMain class="flex items-center">
      <div class="mx-auto flex w-full max-w-(--ui-container) flex-wrap items-center gap-x-16 gap-y-8 px-4 py-12 sm:px-6 lg:gap-y-10 lg:px-8 lg:py-16">
        <div class="flex min-w-0 flex-[1_1_420px] flex-col gap-[18px] lg:gap-5">
          <p class="font-mono text-xs text-muted lg:text-[13px]">
            {{ error.statusCode }}
          </p>
          <h1 class="text-4xl leading-[1.08] font-semibold tracking-[-0.025em] text-highlighted lg:text-[clamp(40px,4.6vw,60px)] lg:leading-[1.05]">
            {{ notFound ? 'Page not found.' : 'Something went wrong.' }}
          </h1>
          <p class="max-w-[480px] text-[16.5px] leading-relaxed text-toned lg:text-lg">
            <template v-if="notFound">
              Nothing is served at <code class="font-mono text-[0.88em] break-all text-highlighted">{{ path }}</code>. The page may have moved, or the link has a typo.
            </template>
            <template v-else>
              The request for <code class="font-mono text-[0.88em] break-all text-highlighted">{{ path }}</code> failed. Try again in a moment.
            </template>
          </p>
          <div class="flex flex-col gap-2.5 pt-1 sm:flex-row sm:flex-wrap sm:gap-3">
            <UButton
              to="/"
              label="Back to home"
              color="neutral"
              class="min-h-12 justify-center rounded-md px-5 text-[15px] font-semibold"
            />
            <UButton
              color="neutral"
              variant="outline"
              icon="i-lucide-search"
              label="Search docs"
              class="min-h-12 justify-center gap-2.5 rounded-md bg-elevated px-4 text-[15px] font-normal text-highlighted ring-default"
              :ui="{ leadingIcon: 'size-4' }"
              @click="searchOpen = true"
            >
              <template #trailing>
                <span class="hidden rounded-sm border border-default px-1.5 py-px font-mono text-xs text-muted sm:inline">⌘K</span>
              </template>
            </UButton>
          </div>
        </div>

        <figure
          v-if="notFound"
          class="m-0 min-w-0 flex-[1_1_480px] rounded-lg border border-default bg-elevated"
        >
          <div class="border-b border-muted px-3.5 py-2.5 font-mono text-[11.5px] break-all text-muted lg:px-[18px] lg:py-3 lg:text-xs">
            GET {{ path }}
          </div>
          <pre class="m-0 overflow-x-auto p-3.5 font-mono text-[12.5px] leading-[1.75] text-highlighted lg:p-[18px] lg:text-sm">{
  "statusCode": <span class="text-primary">404</span>,
  "error": "Not Found",
  "message": {{ message }}
}</pre>
          <figcaption class="border-t border-muted px-3.5 py-2.5 text-[13.5px] leading-normal text-muted lg:px-[18px] lg:py-3 lg:text-sm">
            What a MiiaJS app answers for a route it does not have.
          </figcaption>
        </figure>
      </div>
    </UMain>

    <AppFooter minimal-on-phones />

    <AppSearch />
  </UApp>
</template>
