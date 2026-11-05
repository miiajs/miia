import { describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const entry = join(import.meta.dir, 'fixtures', 'bundled-app.ts')

describe('a bundled app', () => {
  // In a process of its own: core loaded here has already set Symbol.metadata for this one
  it('keeps the Symbol.metadata polyfill, so its routes are found', async () => {
    const outdir = mkdtempSync(join(tmpdir(), 'miia-bundle-'))
    try {
      const build = await Bun.build({ entrypoints: [entry], outdir, target: 'bun' })
      expect(build.success).toBe(true)
      const run = Bun.spawnSync([process.execPath, build.outputs[0].path])
      expect(run.stderr.toString()).toBe('')
      expect(run.stdout.toString().trim()).toBe('200')
    } finally {
      rmSync(outdir, { recursive: true, force: true })
    }
  })
})
