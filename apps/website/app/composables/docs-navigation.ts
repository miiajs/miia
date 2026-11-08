import type { ContentNavigationItem } from '@nuxt/content'

type NavItem = ContentNavigationItem & {
  defaultOpen?: boolean
  exact?: boolean
  status?: string
}

function containsRoute(item: NavItem, path: string): boolean {
  if (path === item.path || path.startsWith(`${item.path}/`)) return true
  return item.children?.some(child => containsRoute(child, path)) ?? false
}

function expandActiveBranch(items: NavItem[] | undefined, path: string): NavItem[] | undefined {
  return items?.map((item) => {
    const next: NavItem = { ...item }
    if (next.defaultOpen === false && containsRoute(next, path)) {
      delete next.defaultOpen
    }
    if (next.status === 'experimental') {
      next.badge = EXPERIMENTAL_BADGE
    }
    if (next.children?.length) {
      next.children = expandActiveBranch(next.children as NavItem[], path)
    } else {
      // Exact matching also sets aria-current on the link of the current page
      next.exact = true
    }
    return next
  })
}

// Extra frontmatter fields reach the sidebar only when listed in queryCollectionNavigation()
export function useDocsNavigation() {
  const route = useRoute()
  const { data } = useAsyncData('navigation', () => queryCollectionNavigation('docs', ['status']), {
    transform: data => data.find(item => item.path === '/docs')?.children || []
  })

  return computed(() => expandActiveBranch(data.value as NavItem[] | undefined, route.path))
}
