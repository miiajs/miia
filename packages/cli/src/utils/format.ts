import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { execa } from 'execa'

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

function detectFormatter(cwd: string): FormatterChoice | null {
  if (BIOME_CONFIGS.some((f) => existsSync(join(cwd, f)))) {
    const bin = join(cwd, 'node_modules', '.bin', 'biome')
    if (existsSync(bin)) return { bin, args: (files) => ['format', '--write', ...files] }
    return null
  }
  if (PRETTIER_CONFIGS.some((f) => existsSync(join(cwd, f)))) {
    const bin = join(cwd, 'node_modules', '.bin', 'prettier')
    if (existsSync(bin)) return { bin, args: (files) => ['--write', ...files] }
    return null
  }
  return null
}

export async function formatFiles(filePaths: string[], cwd: string): Promise<void> {
  if (filePaths.length === 0) return
  const formatter = detectFormatter(cwd)
  if (!formatter) return

  try {
    await execa(formatter.bin, formatter.args(filePaths), {
      cwd,
      stdio: 'pipe',
    })
  } catch {
    // formatter installed but failed - skip silently
  }
}
