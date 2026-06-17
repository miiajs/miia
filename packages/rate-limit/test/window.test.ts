import { describe, expect, it } from 'bun:test'
import { parseWindow } from '../src/index.js'

describe('parseWindow', () => {
  it('passes through positive finite numbers as ms', () => {
    expect(parseWindow(1)).toBe(1)
    expect(parseWindow(60_000)).toBe(60_000)
  })

  it('parses all duration units', () => {
    expect(parseWindow('500ms')).toBe(500)
    expect(parseWindow('10s')).toBe(10_000)
    expect(parseWindow('5m')).toBe(300_000)
    expect(parseWindow('1h')).toBe(3_600_000)
    expect(parseWindow('1d')).toBe(86_400_000)
  })

  it('accepts fractional values and rounds', () => {
    expect(parseWindow('1.5s')).toBe(1500)
    expect(parseWindow('0.5m')).toBe(30_000)
  })

  it('tolerates whitespace between number and unit', () => {
    expect(parseWindow('10 s')).toBe(10_000)
    expect(parseWindow('  250ms  ')).toBe(250)
  })

  it('throws TypeError on non-positive numbers', () => {
    expect(() => parseWindow(0)).toThrow(TypeError)
    expect(() => parseWindow(-5)).toThrow(TypeError)
  })

  it('throws TypeError on non-finite numbers', () => {
    expect(() => parseWindow(Number.POSITIVE_INFINITY)).toThrow(TypeError)
    expect(() => parseWindow(Number.NaN)).toThrow(TypeError)
  })

  it('throws TypeError on invalid strings', () => {
    expect(() => parseWindow('')).toThrow(TypeError)
    expect(() => parseWindow('10')).toThrow(TypeError)
    expect(() => parseWindow('10x')).toThrow(TypeError)
    expect(() => parseWindow('abc')).toThrow(TypeError)
    expect(() => parseWindow('0s')).toThrow(TypeError)
  })
})
