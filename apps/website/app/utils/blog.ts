const postDateFormat = new Intl.DateTimeFormat('en', { dateStyle: 'long', timeZone: 'UTC' })

export function formatPostDate(date: string): string {
  return postDateFormat.format(new Date(date))
}

// Nuxt Content strips `.draft` from the path but keeps it in the stem
export function isDraftPost(post: { stem?: string }): boolean {
  return post.stem?.endsWith('.draft') ?? false
}
