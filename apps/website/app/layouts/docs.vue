<script setup lang="ts">
const route = useRoute()
const navigation = useDocsNavigation()
</script>

<template>
  <div>
    <AppHeader />

    <DocsMobileBar :key="route.path" />

    <UMain>
      <UContainer class="py-page">
        <UPage
          :ui="{
            root: SIDEBAR_COLUMNS,
            left: 'lg:col-span-1',
            center: 'lg:col-span-1'
          }"
        >
          <template #left>
            <UPageAside
              :ui="{
                top: 'top-0 mt-0',
                topHeader: 'h-0',
                topFooter: 'h-[22px]'
              }"
            >
              <template #top>
                <UContentSearchButton
                  :collapsed="false"
                  label="Search docs"
                  class="min-h-11 w-full gap-2.5 rounded-md bg-elevated ps-3 pe-2.5 text-small font-normal text-muted ring-accented hover:bg-elevated hover:text-default focus-visible:outline-offset-[-3px]"
                  :ui="{ leadingIcon: 'size-4' }"
                >
                  <template #trailing>
                    <span class="rounded-[4px] border border-default px-1.5 py-px font-mono text-caption/4">⌘K</span>
                  </template>
                </UContentSearchButton>
              </template>

              <nav
                aria-label="Documentation"
                class="flex flex-col gap-[22px]"
              >
                <div
                  v-for="group in navigation"
                  :key="group.path"
                >
                  <p class="mb-1.5 px-2.5 font-mono text-caption text-muted lowercase">
                    {{ group.title }}
                  </p>
                  <UContentNavigation
                    as="div"
                    :navigation="group.children"
                    color="neutral"
                    trailing-icon="i-lucide-chevron-right"
                  >
                    <template #link-leading="{ active }">
                      <span
                        v-if="active"
                        class="size-1.5 shrink-0 bg-primary"
                      />
                    </template>
                  </UContentNavigation>
                </div>
              </nav>
            </UPageAside>
          </template>

          <slot />
        </UPage>
      </UContainer>
    </UMain>

    <AppFooter />
  </div>
</template>
