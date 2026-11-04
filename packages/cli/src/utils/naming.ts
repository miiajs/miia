import { CliError } from './errors.js'

// Acronym runs (HTTP in HTTPServer), capitalized or lower-case words; digits stay with the word before them
const WORDS = /[A-Z]+\d*(?![a-z])|[A-Z]?[a-z]+\d*|\d+/g

export function splitWords(input: string): string[] {
  return input.match(WORDS) ?? []
}

const capitalize = (word: string) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()

/** HTTPServer -> HttpServer, user_profile -> UserProfile */
export function toPascalCase(input: string): string {
  return splitWords(input).map(capitalize).join('')
}

export function toCamelCase(input: string): string {
  const [first = '', ...rest] = splitWords(input)
  return first.toLowerCase() + rest.map(capitalize).join('')
}

/** HTTPServer -> http-server */
export function toKebabCase(input: string): string {
  return splitWords(input)
    .map((word) => word.toLowerCase())
    .join('-')
}

/** HTTPServer -> http_server, user-profile -> user_profile */
export function toSnakeCase(input: string): string {
  return splitWords(input)
    .map((word) => word.toLowerCase())
    .join('_')
}

const SEGMENT = /^[a-zA-Z][a-zA-Z0-9_-]*$/

/** 'admin/users' -> { dir: 'admin', name: 'users' }; every segment starts with a letter. */
export function validateArtifactName(raw: string): { dir: string; name: string } {
  const segments = raw.trim().split('/')
  for (const segment of segments) {
    if (!segment) throw new CliError(`Invalid name "${raw}": empty path segment`)
    if (!SEGMENT.test(segment)) {
      throw new CliError(`Invalid name "${segment}": start with a letter, then letters, digits, "-" or "_"`)
    }
  }
  return { dir: segments.slice(0, -1).join('/'), name: segments[segments.length - 1] }
}
