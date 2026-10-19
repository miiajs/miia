import type { ZodLike } from '@miiajs/core'

export function parseEnv<T>(schema: ZodLike<T>, env: Record<string, string | undefined>, label?: string): T {
  const result = schema.safeParse(env)
  if (result.success) {
    return result.data
  }
  const messages = result.error.issues
    .map((i) => `  - ${i.path?.map(String).join('.') ?? '?'}: ${i.message}`)
    .join('\n')
  const subject = label === undefined ? '' : ` for '${label}'`
  throw new Error(`[Miia] Config validation failed${subject}:\n${messages}`)
}
