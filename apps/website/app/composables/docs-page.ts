// One handler for the page and the docs layout, so both share the entry of the same key;
// `defer` makes the second caller wait for a fetch in flight instead of cancelling it
export function useDocsPage(path: string) {
  return useAsyncData(path, () => queryCollection('docs').path(path).first(), { dedupe: 'defer' })
}
