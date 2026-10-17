import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { execa } from 'execa'
import { logger } from './logger.js'
import { findLocalBin } from './which.js'

const BIOME_CONFIGS = ['biome.json', 'biome.jsonc']
const PRETTIER_CONFIGS = [
  '.prettierrc',
  '.prettierrc.json',
  '.prettierrc.yaml',
  '.prettierrc.yml',
  'prettier.config.js',
]

interface FormatterChoice {
  bin: string
  args: (files: string[]) => string[]
}

// Project-local binaries only: a global formatter may not match the project's config
function detectFormatter(cwd: string): FormatterChoice | null {
  if (BIOME_CONFIGS.some((f) => existsSync(join(cwd, f)))) {
    const bin = findLocalBin(cwd, 'biome')
    return bin ? { bin, args: (files) => ['format', '--write', '--no-errors-on-unmatched', ...files] } : null
  }
  if (PRETTIER_CONFIGS.some((f) => existsSync(join(cwd, f)))) {
    const bin = findLocalBin(cwd, 'prettier')
    return bin ? { bin, args: (files) => ['--write', ...files] } : null
  }
  return null
}

export async function formatFiles(filePaths: string[], cwd: string): Promise<void> {
  if (filePaths.length === 0) return
  const formatter = detectFormatter(cwd)
  if (!formatter) return

  const result = await execa(formatter.bin, formatter.args(filePaths), { cwd, stdio: 'pipe', reject: false })
  if (result.exitCode !== 0) {
    const output = [result.stderr, result.stdout, result.shortMessage].map((s) => String(s ?? '')).join('\n')
    const firstLine = output.split('\n').find((line) => line.trim()) ?? 'unknown error'
    logger.warn(`Formatting failed: ${firstLine.trim()}`)
  }
}
