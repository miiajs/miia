<script setup lang="ts">
import type { ContentNavigationItem } from '@nuxt/content'

const rawNavigation = inject<Ref<ContentNavigationItem[]>>('navigation')
const route = useRoute()

type NavItem = ContentNavigationItem & {
  defaultOpen?: boolean
  status?: PackageStatus
}

function containsRoute(item: NavItem, path: string): boolean {
  if (path === item.path || path.startsWith(`${item.path}/`)) return true
  return item.children?.some((child) => containsRoute(child, path)) ?? false
}

function expandActiveBranch(items: NavItem[] | undefined, path: string): NavItem[] | undefined {
  return items?.map((item) => {
    const next: NavItem = { ...item }
    if (next.defaultOpen === false && containsRoute(next, path)) {
      delete next.defaultOpen
    }
    if (next.status) {
      next.badge = { label: next.status, color: statusColor(next.status) }
    }
    if (next.children?.length) {
      next.children = expandActiveBranch(next.children as NavItem[], path)
    }
    return next
  })
}

const navigation = computed(() => expandActiveBranch(rawNavigation?.value as NavItem[] | undefined, route.path))
</script>

<template>
  <div>
    <AppHeader />

    <UMain>
      <UContainer>
        <UPage>
          <template #left>
            <UPageAside>
              <template #top>
                <UContentSearchButton :collapsed="false" />
              </template>

              <UContentNavigation
                :navigation="navigation"
                highlight
              />
            </UPageAside>
          </template>

          <slot />
        </UPage>
      </UContainer>
    </UMain>

    <AppFooter />
  </div>
</template>
