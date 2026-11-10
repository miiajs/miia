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
      <SplitRow
        class="gap-8 py-12 lg:py-16"
        text-class="gap-[18px] lg:gap-5"
      >
        <template #text>
          <p class="font-mono text-meta text-muted">
            {{ error.statusCode }}
          </p>
          <h1 class="text-display font-semibold text-highlighted">
            {{ notFound ? 'Page not found.' : 'Something went wrong.' }}
          </h1>
          <p class="max-w-[480px] text-lead text-toned">
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
              class="min-h-12 justify-center rounded-md px-5 text-ui font-semibold"
            />
            <UButton
              color="neutral"
              variant="outline"
              icon="i-lucide-search"
              label="Search docs"
              class="min-h-12 justify-center gap-2.5 rounded-md bg-elevated px-4 text-ui font-normal text-highlighted ring-default"
              :ui="{ leadingIcon: 'size-4' }"
              @click="searchOpen = true"
            >
              <template #trailing>
                <span class="hidden rounded-sm border border-default px-1.5 py-px font-mono text-caption/4 text-muted sm:inline">⌘K</span>
              </template>
            </UButton>
          </div>
        </template>

        <template
          v-if="notFound"
          #panel
        >
          <figure class="m-0 rounded-lg border border-default bg-elevated">
            <div class="border-b border-muted px-3.5 py-2.5 font-mono text-caption break-all text-muted lg:px-[18px] lg:py-3">
              GET {{ path }}
            </div>
            <pre class="m-0 overflow-x-auto p-3.5 font-mono text-code text-highlighted lg:p-[18px]">{
  "statusCode": <span class="text-primary">404</span>,
  "error": "Not Found",
  "message": {{ message }}
}</pre>
            <figcaption class="border-t border-muted px-3.5 py-2.5 text-small text-muted lg:px-[18px] lg:py-3">
              What a MiiaJS app answers for a route it does not have.
            </figcaption>
          </figure>
        </template>
      </SplitRow>
    </UMain>

    <AppFooter minimal-on-phones />

    <AppSearch />
  </UApp>
</template>
