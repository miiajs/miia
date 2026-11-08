export function useCopy(resetAfter = 1800) {
  const copied = ref(false)
  let timer: ReturnType<typeof setTimeout> | undefined

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      return
    }
    copied.value = true
    clearTimeout(timer)
    timer = setTimeout(() => {
      copied.value = false
    }, resetAfter)
  }

  onScopeDispose(() => clearTimeout(timer))

  return { copied, copy }
}
