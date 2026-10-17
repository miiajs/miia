import { readFileSync } from 'node:fs'

let version: string | undefined

// Same file from dist/utils/ and src/utils/: packages/cli/package.json
export function cliVersion(): string {
  version ??= (JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf-8')) as { version: string })
    .version
  return version
}
