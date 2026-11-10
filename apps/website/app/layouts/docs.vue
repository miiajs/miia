<script setup lang="ts">
const route = useRoute()
const navigation = useDocsNavigation()
</script>

<template>
  <div>
    <AppHeader />

    <DocsMobileBar :key="route.path" />

    <UMain>
      <UContainer>
        <UPage
          :ui="{
            root: 'lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-10 xl:grid-cols-[16rem_minmax(0,1fr)] xl:gap-12',
            left: 'lg:col-span-1',
            center: 'lg:col-span-1'
          }"
        >
          <template #left>
            <UPageAside
              :ui="{
                root: 'lg:py-10 lg:pe-0',
                top: '-top-10 -mt-10',
                topHeader: 'h-10',
                topFooter: 'h-[22px]'
              }"
            >
              <template #top>
                <UContentSearchButton
                  :collapsed="false"
                  label="Search docs"
                  class="min-h-11 w-full gap-2.5 rounded-md bg-elevated ps-3 pe-2.5 text-small font-normal text-muted ring-accented hover:bg-elevated hover:text-default"
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

    <AppFooter compact />
  </div>
</template>
