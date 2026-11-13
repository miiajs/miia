// The page title and description, repeated in the Open Graph tags
export function usePageSeo(title: string | undefined, description: string | undefined, extra: Parameters<typeof useSeoMeta>[0] = {}) {
  useSeoMeta({ title, ogTitle: title, description, ogDescription: description, ...extra })
}
