import { afterEach, describe, expect, it } from 'bun:test'
import { action, CliError } from '../src/utils/errors.js'

afterEach(() => {
  // A leftover exit code would fail the whole `bun test` run
  process.exitCode = 0
})

describe('CliError', () => {
  it('defaults to exit code 1', () => {
    const err = new CliError('boom')
    expect(err.exitCode).toBe(1)
    expect(err.name).toBe('CliError')
    expect(new CliError('cancelled', 0).exitCode).toBe(0)
  })
})

describe('action', () => {
  it('turns a CliError into an exit code', async () => {
    await action(() => {
      throw new CliError('nope', 3)
    })({})
    expect(process.exitCode).toBe(3)
  })

  it('rethrows other errors', async () => {
    const run = action(async () => {
      throw new TypeError('bug')
    })
    await expect(run({})).rejects.toThrow(TypeError)
  })

  it('passes the context through and leaves the exit code alone on success', async () => {
    let seen: unknown
    await action((ctx: { args: string[] }) => {
      seen = ctx.args
    })({ args: ['a'] })
    expect(seen).toEqual(['a'])
    expect(process.exitCode).toBe(0)
  })
})
