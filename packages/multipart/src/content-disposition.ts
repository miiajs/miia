import { scanParams } from './params.js'

export interface ParsedDisposition {
  name?: string
  filename?: string
}

const EMPTY: ParsedDisposition = {}

/**
 * `Content-Disposition` reader for part headers.
 *
 * multipasta 0.2.8 reads the header with fast-content-type-parse, whose
 * quoted-string pattern stops at U+00FF: a single character above it voids the
 * whole header, so `name="файл"; filename="фото.png"` arrives as no name and no
 * filename at all. The raw header survives on `info.headers`, so the bridge
 * takes both parameters from here instead.
 *
 * RFC 7578 prescribes raw UTF-8 for these parameters and advises against
 * RFC 2231/5987 encoding, so `filename*` is ignored in favour of `filename` -
 * which is what the runtime parsers do as well.
 */
export function parseContentDisposition(header: string | string[] | undefined): ParsedDisposition {
  // A part with two `content-disposition` headers arrives as an array; the
  // engine reads nothing out of that shape either.
  if (typeof header !== 'string') return EMPTY

  const semi = header.indexOf(';')
  if (semi === -1) return EMPTY

  let name: string | undefined
  let filename: string | undefined

  scanParams(header, semi + 1, (key, value) => {
    // Last one wins, as it does in the engine and in the runtime parsers.
    if (key === 'name') name = value
    else if (key === 'filename') filename = value
  })

  return name === undefined && filename === undefined ? EMPTY : { name, filename }
}
