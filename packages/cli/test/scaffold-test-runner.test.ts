import { describe, expect, it } from 'bun:test'
import ts from 'typescript'
import { toNodeTestRunner } from '../src/scaffold/test-runner.js'
import { CliError } from '../src/utils/errors.js'

describe('toNodeTestRunner', () => {
  it('moves describe/it/test to node:test and expect to the expect package', () => {
    const text =
      "import { describe, expect, it, test } from 'bun:test'\nimport { TestApp } from '@miiajs/testing'\n\ndescribe('x', () => {})\n"
    expect(toNodeTestRunner(ts, text)).toBe(
      "import { describe, it, test } from 'node:test'\nimport { expect } from 'expect'\nimport { TestApp } from '@miiajs/testing'\n\ndescribe('x', () => {})\n",
    )
  })

  it('keeps quotes, semicolons and CRLF', () => {
    const text = 'import { it, expect } from "bun:test";\r\nit("x", () => expect(1).toBe(1));\r\n'
    expect(toNodeTestRunner(ts, text)).toBe(
      'import { it } from "node:test";\r\nimport { expect } from "expect";\r\nit("x", () => expect(1).toBe(1));\r\n',
    )
  })

  it('handles an import without expect, or with expect only', () => {
    expect(toNodeTestRunner(ts, "import { it } from 'bun:test'\n")).toBe("import { it } from 'node:test'\n")
    expect(toNodeTestRunner(ts, "import { expect } from 'bun:test'\n")).toBe("import { expect } from 'expect'\n")
  })

  it('leaves files without bun:test alone', () => {
    const text = "import { it } from 'node:test'\n"
    expect(toNodeTestRunner(ts, text)).toBe(text)
  })

  it('rejects hooks and mocks: node:test on Deno has no hooks', () => {
    expect(() => toNodeTestRunner(ts, "import { beforeAll, it } from 'bun:test'\n")).toThrow(CliError)
    expect(() => toNodeTestRunner(ts, "import { mock } from 'bun:test'\n")).toThrow('bun:test "mock"')
    expect(() => toNodeTestRunner(ts, "import * as t from 'bun:test'\n")).toThrow(CliError)
  })
})
