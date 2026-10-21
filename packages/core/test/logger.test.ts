import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { ConsoleLogger } from '../src/index.js'

const ESC = '\x1b['

function lines(method: 'log' | 'error', write: () => void): string[] {
  const spy = spyOn(console, method).mockImplementation(() => {})
  try {
    write()
    return spy.mock.calls.map((call) => String(call[0]))
  } finally {
    spy.mockRestore()
  }
}

describe('ConsoleLogger colors', () => {
  let saved: string | undefined

  beforeEach(() => {
    saved = process.env.NO_COLOR
    delete process.env.NO_COLOR
  })

  afterEach(() => {
    if (saved === undefined) delete process.env.NO_COLOR
    else process.env.NO_COLOR = saved
  })

  it('colors the text format by default', () => {
    const [line] = lines('log', () => new ConsoleLogger().log('hello', 'Ctx'))
    expect(line).toContain(ESC)
  })

  it("writes plain text with 'colors: false'", () => {
    const [line] = lines('log', () => new ConsoleLogger({ colors: false }).log('hello', 'Ctx'))
    expect(line).not.toContain(ESC)
    expect(line).toStartWith('[Miia] ')
    expect(line).toContain(' LOG   [Ctx] hello +')
  })

  it("writes an error and its trace without colors under 'colors: false'", () => {
    const written = lines('error', () =>
      new ConsoleLogger({ colors: false }).error('boom', 'Error: boom\n    at x', 'Ctx'),
    )
    expect(written).toHaveLength(2)
    for (const line of written) expect(line).not.toContain(ESC)
    expect(written[1]).toBe('Error: boom\n    at x')
  })

  it('turns colors off when NO_COLOR is set', () => {
    process.env.NO_COLOR = '1'
    const [line] = lines('log', () => new ConsoleLogger().log('hello'))
    expect(line).not.toContain(ESC)
  })

  it('keeps colors when NO_COLOR is empty', () => {
    process.env.NO_COLOR = ''
    const [line] = lines('log', () => new ConsoleLogger().log('hello'))
    expect(line).toContain(ESC)
  })

  it("lets 'colors: true' win over NO_COLOR", () => {
    process.env.NO_COLOR = '1'
    const [line] = lines('log', () => new ConsoleLogger({ colors: true }).log('hello'))
    expect(line).toContain(ESC)
  })
})
