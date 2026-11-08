<script setup lang="ts">
import type { ContentNavigationItem } from '@nuxt/content'

// The docs layout mounts it per page (`:key="route.path"`), so the path below is fixed for its lifetime
const route = useRoute()
const docsNavigation = useDocsNavigation()
const { data: page } = useDocsPage(route.path)
const { open: searchOpen } = useContentSearch()

const menuOpen = ref(false)
const tocOpen = ref(false)
const toc = computed(() => page.value?.body?.toc?.links ?? [])

// The sections are the top-level triggers here, only the current one open; nested groups keep the regular trigger of the sidebar
const navigation = computed(() => docsNavigation.value?.map((item: ContentNavigationItem) => ({
  ...item,
  defaultOpen: route.path === item.path || route.path.startsWith(`${item.path}/`),
  ui: { trigger: 'font-semibold text-highlighted data-[state=open]:font-semibold' }
})))

function openSearch() {
  menuOpen.value = false
  searchOpen.value = true
}

function closeOnLink(event: MouseEvent) {
  if ((event.target as HTMLElement).closest('a')) menuOpen.value = false
}
</script>

<template>
  <div class="sticky top-(--ui-header-height) z-40 border-b border-default bg-accented lg:hidden">
    <div class="flex">
      <button
        type="button"
        aria-label="Open documentation menu"
        class="flex min-h-12 min-w-0 flex-1 items-center gap-2.5 border-e border-default ps-4 pe-3.5 text-start text-[15px] text-highlighted"
        @click="menuOpen = true"
      >
        <UIcon
          name="i-lucide-panel-left"
          class="size-[17px] shrink-0"
        />
        <span class="truncate font-semibold">{{ page?.title }}</span>
        <UIcon
          name="i-lucide-chevron-down"
          class="ms-auto size-4 shrink-0"
        />
      </button>
      <button
        v-if="toc.length"
        type="button"
        :aria-expanded="tocOpen"
        aria-controls="docs-mobile-toc"
        class="flex min-h-12 shrink-0 items-center gap-1.5 px-3.5 font-mono text-xs text-toned"
        @click="tocOpen = !tocOpen"
      >
        on this page
        <UIcon
          name="i-lucide-chevron-down"
          class="size-3.5 transition-transform"
          :class="{ 'rotate-180': tocOpen }"
        />
      </button>
    </div>

    <nav
      v-if="tocOpen"
      id="docs-mobile-toc"
      aria-label="On this page"
      class="absolute inset-x-0 top-full max-h-[calc(100dvh-var(--ui-header-height)-3rem)] overflow-y-auto border-b border-default bg-default px-4 py-2"
    >
      <ul>
        <li
          v-for="link in toc"
          :key="link.id"
        >
          <NuxtLink
            :to="`#${link.id}`"
            class="flex min-h-11 items-center text-[15px] text-toned hover:text-highlighted"
            @click="tocOpen = false"
          >
            {{ link.text }}
          </NuxtLink>
          <ul
            v-if="link.children?.length"
            class="ps-3.5"
          >
            <li
              v-for="child in link.children"
              :key="child.id"
            >
              <NuxtLink
                :to="`#${child.id}`"
                class="flex min-h-11 items-center text-[15px] text-muted hover:text-highlighted"
                @click="tocOpen = false"
              >
                {{ child.text }}
              </NuxtLink>
            </li>
          </ul>
        </li>
      </ul>
    </nav>

    <UModal
      v-model:open="menuOpen"
      title="Documentation"
      description="Pages of the MiiaJS documentation"
      fullscreen
      :overlay="false"
      :transition="false"
      :ui="{ content: 'top-(--ui-header-height) z-[45] divide-y-0 lg:hidden' }"
    >
      <template #content>
        <div class="flex items-center justify-between border-b border-default bg-accented py-0.5 ps-4 pe-0.5">
          <span class="font-mono text-xs text-muted">documentation</span>
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-x"
            aria-label="Close documentation menu"
            class="size-11 justify-center text-highlighted"
            @click="menuOpen = false"
          />
        </div>

        <div
          class="flex-1 overflow-y-auto px-2 pt-3.5 pb-6"
          @click="closeOnLink"
        >
          <button
            type="button"
            class="mx-2 mb-3 flex min-h-11 w-[calc(100%-1rem)] items-center gap-2.5 rounded-md border border-accented bg-elevated px-3 text-start text-[15px] text-muted"
            @click="openSearch"
          >
            <UIcon
              name="i-lucide-search"
              class="size-4"
            />
            Search docs
          </button>

          <UContentNavigation
            :navigation="navigation"
            aria-label="Documentation"
            color="neutral"
            trailing-icon="i-lucide-chevron-right"
            :ui="{
              listWithChildren: 'ms-3 border-s-0',
              link: 'min-h-11 px-2.5 text-[15px]',
              linkTrailingIcon: 'size-4'
            }"
          >
            <template #link-leading="{ active }">
              <span
                v-if="active"
                class="size-1.5 shrink-0 bg-primary"
              />
            </template>
          </UContentNavigation>
        </div>
      </template>
    </UModal>
  </div>
</template>
