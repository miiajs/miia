/**
 * One pass over an RFC 7231 parameter list - `; name=value` repeated, the value
 * bare or quoted. `Content-Type` and `Content-Disposition` are read with the
 * same walk, so a defect fixed here is fixed for both.
 *
 * A parameter name ends at the nearest `;`, never at an `=` further along: a
 * valueless `foo` between two real parameters is skipped instead of swallowing
 * the name that follows it. `visit` returning `false` ends the walk.
 */
export function scanParams(input: string, start: number, visit: (name: string, value: string) => boolean | void): void {
  let i = start

  while (i < input.length) {
    const semi = input.indexOf(';', i)
    const eq = input.indexOf('=', i)
    if (eq === -1 || (semi !== -1 && semi < eq)) {
      if (semi === -1) return
      i = semi + 1
      continue
    }

    const name = input.slice(i, eq).trim().toLowerCase()
    let j = eq + 1
    while (j < input.length && (input[j] === ' ' || input[j] === '\t')) j++

    let value = ''
    if (input[j] === '"') {
      j++
      while (j < input.length && input[j] !== '"') {
        if (input[j] === '\\' && j + 1 < input.length) j++
        value += input[j]
        j++
      }
      const next = input.indexOf(';', j)
      i = next === -1 ? input.length : next + 1
    } else {
      const next = input.indexOf(';', j)
      const end = next === -1 ? input.length : next
      value = input.slice(j, end).trim()
      i = next === -1 ? input.length : next + 1
    }

    if (visit(name, value) === false) return
  }
}
