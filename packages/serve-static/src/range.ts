export type RangeResult = { start: number; end: number } | 'unsatisfiable' | null

export function parseRange(header: string | null, fileSize: number): RangeResult {
  if (!header || !header.startsWith('bytes=')) return null

  const spec = header.slice(6).trim()
  if (spec.includes(',')) return null

  const dashIdx = spec.indexOf('-')
  if (dashIdx === -1) return null

  const startStr = spec.slice(0, dashIdx)
  const endStr = spec.slice(dashIdx + 1)

  let start: number
  let end: number

  if (startStr === '') {
    const suffix = parseInt(endStr, 10)
    if (Number.isNaN(suffix) || suffix <= 0) return null
    if (fileSize === 0) return 'unsatisfiable'
    if (suffix >= fileSize) {
      start = 0
      end = fileSize - 1
    } else {
      start = fileSize - suffix
      end = fileSize - 1
    }
  } else {
    start = parseInt(startStr, 10)
    if (Number.isNaN(start)) return null
    if (endStr === '') {
      end = fileSize - 1
    } else {
      end = parseInt(endStr, 10)
      if (Number.isNaN(end)) return null
    }
  }

  if (start > end) return null
  if (start >= fileSize) return 'unsatisfiable'
  if (end >= fileSize) end = fileSize - 1

  return { start, end }
}
