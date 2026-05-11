export function toOpenApiPath(path: string): string {
  const normalized = path.replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '')
  const converted = normalized.replace(/:(\w+)/g, '{$1}')
  return '/' + converted
}

export function extractPathParams(path: string): string[] {
  return [...path.matchAll(/:(\w+)/g)].map((m) => m[1])
}
